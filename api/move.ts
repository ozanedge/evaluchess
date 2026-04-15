import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

interface MatchData { gameId: string; myColor: 'white' | 'black'; opponentId: string; token: string }

async function validateToken(playerId: string, gameId: string, token: string): Promise<boolean> {
  const match = await redis.get(`evaluchess:match:${playerId}`) as MatchData | null
  return !!match && match.gameId === gameId && match.token === token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('move')

  try {
    if (!await checkRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    if (req.method === 'POST') {
      const { gameId, san, resign, playerId, token } = req.body as {
        gameId: string; san?: string; resign?: boolean; playerId: string; token: string
      }
      if (!gameId || !playerId || !token) { return res.status(400).json({ error: 'missing fields' }) }

      span.setAttributes({ 'game.id': gameId, 'player.id': playerId, 'move.resign': !!resign })

      if (!await validateToken(playerId, gameId, token)) {
        log('warn', 'unauthorized move attempt', { gameId, playerId, san: san ?? null, resign: !!resign })
        span.setAttribute('auth.failed', true)
        return res.status(403).json({ error: 'unauthorized' })
      }

      if (resign) {
        await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
        metric('chess.resignations', 1, { gameId })
        log('info', 'player resigned', { gameId, playerId })
        span.setAttribute('move.type', 'resign')
        return res.json({ ok: true })
      }

      if (!san) { return res.status(400).json({ error: 'missing san' }) }

      span.setAttribute('move.san', san)

      const fen = await redis.get(`evaluchess:fen:${gameId}`) as string | null
      if (!fen) {
        log('warn', 'game not found', { gameId, playerId, san })
        return res.status(410).json({ error: 'game not found' })
      }

      const chess = new Chess(fen)
      let move
      try { move = chess.move(san) } catch { move = null }
      if (!move) {
        metric('chess.illegal_moves', 1, { gameId })
        log('warn', 'illegal move attempted', { gameId, playerId, san, fen })
        span.setAttribute('move.illegal', true)
        return res.status(400).json({ error: 'illegal move' })
      }

      const newFen = chess.fen()
      const isCheckmate = chess.isCheckmate()
      const isDraw = chess.isDraw()
      const isCheck = chess.inCheck()

      await Promise.all([
        redis.set(`evaluchess:fen:${gameId}`, newFen, { ex: 3600 }),
        redis.rpush(`evaluchess:moves:${gameId}`, san),
        redis.expire(`evaluchess:moves:${gameId}`, 3600),
      ])

      log('info', 'move played', { gameId, playerId, san, fen: newFen, inCheck: isCheck, isCheckmate, isDraw })
      span.setAttributes({ 'move.type': 'move', 'game.check': isCheck, 'game.checkmate': isCheckmate, 'game.draw': isDraw })
      return res.json({ ok: true })
    }

    if (req.method === 'GET') {
      const { gameId, since } = req.query as { gameId: string; since?: string }
      if (!gameId) { return res.status(400).json({ error: 'missing gameId' }) }

      span.setAttributes({ 'game.id': gameId, 'move.since': since ?? '0' })

      const sinceIdx = since ? parseInt(since) : 0
      const [moves, resigned] = await Promise.all([
        redis.lrange(`evaluchess:moves:${gameId}`, sinceIdx, -1) as Promise<string[]>,
        redis.get(`evaluchess:resigned:${gameId}`),
      ])

      log('info', 'move poll', { gameId, since: sinceIdx, moveCount: moves.length, resigned: !!resigned })
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
