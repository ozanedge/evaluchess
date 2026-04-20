import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

interface MatchData {
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
  myUsername?: string
  opponentUsername?: string
}

const DISCONNECT_GRACE_MS = 5000
const HEARTBEAT_TTL_SECONDS = 15

async function fetchMatch(playerId: string): Promise<MatchData | null> {
  return (await redis.get(`evaluchess:match:${playerId}`)) as MatchData | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('move')

  try {
    if (!await checkRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    if (req.method === 'POST') {
      const { gameId, san, resign, playerId, token, remainingMs } = req.body as {
        gameId: string; san?: string; resign?: boolean; playerId: string; token: string;
        remainingMs?: number
      }
      if (!gameId || !playerId || !token) { return res.status(400).json({ error: 'missing fields' }) }

      const match = await fetchMatch(playerId)
      const username = match?.myUsername ?? null
      const opponentUsername = match?.opponentUsername ?? null

      span.setAttributes({
        'game.id': gameId,
        'player.id': playerId,
        'move.resign': !!resign,
        ...(username ? { 'player.username': username } : {}),
      })

      if (!match || match.gameId !== gameId || match.token !== token) {
        log('warn', 'unauthorized move attempt', { gameId, playerId, username, san: san ?? null, resign: !!resign })
        span.setAttribute('auth.failed', true)
        return res.status(403).json({ error: 'unauthorized' })
      }

      if (resign) {
        await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
        metric('chess.resignations', 1, { gameId })
        log('info', 'player resigned', { gameId, playerId, username, opponentUsername })
        span.setAttribute('move.type', 'resign')
        return res.json({ ok: true })
      }

      if (!san) { return res.status(400).json({ error: 'missing san' }) }

      span.setAttribute('move.san', san)

      const fen = await redis.get(`evaluchess:fen:${gameId}`) as string | null
      if (!fen) {
        log('warn', 'game not found', { gameId, playerId, username, san })
        return res.status(410).json({ error: 'game not found' })
      }

      const chess = new Chess(fen)
      let move
      try { move = chess.move(san) } catch { move = null }
      if (!move) {
        metric('chess.illegal_moves', 1, { gameId })
        log('warn', 'illegal move attempted', { gameId, playerId, username, san, fen })
        span.setAttribute('move.illegal', true)
        return res.status(400).json({ error: 'illegal move' })
      }

      const newFen = chess.fen()
      const isCheckmate = chess.isCheckmate()
      const isDraw = chess.isDraw()
      const isCheck = chess.inCheck()

      // Store the mover's authoritative clock reading alongside the SAN so the
      // poller can keep both clients' clocks in sync. Upstash auto-serializes
      // the object to JSON; lrange auto-deserializes it back to an object.
      const cleanMs = typeof remainingMs === 'number' && remainingMs >= 0 && Number.isFinite(remainingMs)
        ? Math.round(remainingMs)
        : null
      await Promise.all([
        redis.set(`evaluchess:fen:${gameId}`, newFen, { ex: 3600 }),
        redis.rpush(`evaluchess:moves:${gameId}`, { san, ms: cleanMs }),
        redis.expire(`evaluchess:moves:${gameId}`, 3600),
      ])

      log('info', 'move played', {
        gameId, playerId, username, opponentUsername, san, fen: newFen,
        inCheck: isCheck, isCheckmate, isDraw,
      })
      span.setAttributes({ 'move.type': 'move', 'game.check': isCheck, 'game.checkmate': isCheckmate, 'game.draw': isDraw })
      return res.json({ ok: true })
    }

    if (req.method === 'GET') {
      const { gameId, since, playerId } = req.query as { gameId: string; since?: string; playerId?: string }
      if (!gameId) { return res.status(400).json({ error: 'missing gameId' }) }

      span.setAttributes({ 'game.id': gameId, 'move.since': since ?? '0' })

      const sinceIdx = since ? parseInt(since) : 0
      const now = Date.now()

      // Refresh this poller's heartbeat so the opponent's next poll sees them as alive.
      if (playerId) {
        await redis.set(`evaluchess:hb:${gameId}:${playerId}`, now.toString(), { ex: HEARTBEAT_TTL_SECONDS })
      }

      let resigned = await redis.get(`evaluchess:resigned:${gameId}`)
      let myMatch: MatchData | null = null

      // Disconnect detection: if the opponent's heartbeat is missing or older than
      // DISCONNECT_GRACE_MS, auto-resign them. The polling player effectively wins.
      if (!resigned && playerId) {
        myMatch = await fetchMatch(playerId)
        if (myMatch?.opponentId) {
          const oppHbRaw = await redis.get(`evaluchess:hb:${gameId}:${myMatch.opponentId}`) as string | null
          const lastHb = oppHbRaw ? parseInt(oppHbRaw) : 0
          const stale = !oppHbRaw || (now - lastHb) > DISCONNECT_GRACE_MS
          if (stale) {
            await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
            resigned = '1'
            metric('chess.auto_resignations', 1, { gameId })
            log('info', 'opponent auto-resigned (disconnect)', {
              gameId,
              playerId,
              username: myMatch.myUsername ?? null,
              disconnectedPlayer: myMatch.opponentId,
              disconnectedUsername: myMatch.opponentUsername ?? null,
              lastHeartbeatMsAgo: oppHbRaw ? now - lastHb : null,
            })
          }
        }
      }

      const raw = await redis.lrange(`evaluchess:moves:${gameId}`, sinceIdx, -1) as unknown[]
      const moves = raw.map((entry) => {
        if (entry && typeof entry === 'object' && 'san' in (entry as Record<string, unknown>)) {
          const o = entry as { san: string; ms?: number | null }
          return { san: o.san, ms: typeof o.ms === 'number' ? o.ms : null }
        }
        if (typeof entry === 'string' && entry.startsWith('{')) {
          try {
            const parsed = JSON.parse(entry) as { san: string; ms: number | null }
            return { san: parsed.san, ms: parsed.ms ?? null }
          } catch { /* fall through */ }
        }
        return { san: String(entry), ms: null }
      })

      log('info', 'move poll', {
        gameId,
        playerId: playerId ?? null,
        username: myMatch?.myUsername ?? null,
        since: sinceIdx,
        moveCount: moves.length,
        resigned: !!resigned,
      })
      span.setAttributes({ 'move.count': moves.length, 'game.resigned': !!resigned })
      return res.json({ moves, resigned: !!resigned })
    }

    return res.status(405).end()
  } catch (err) {
    recordError(span, err)
    log('error', 'move handler error', { error: String(err) })
    return res.status(500).json({ error: 'internal error' })
  } finally {
    span.end()
    flush()
  }
}
