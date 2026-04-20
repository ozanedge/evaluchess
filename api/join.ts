import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit, generateToken } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

const QUEUE_KEY = 'evaluchess:queue'
const STALE_MS = 60_000

// Mirror the client's username rules: 3–24 chars, start/end alphanumeric,
// middle chars from [a-zA-Z0-9._\-+~!]. Anything outside that is silently dropped.
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/

interface QueueEntry { ts: number; tc: string; username?: string; elo?: number; uid?: string }
interface MatchData {
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
  // "My" identity — cached on the match record so later handlers (move, resign,
  // disconnect detection) can include the caller's username in their logs.
  myUsername?: string
  myElo?: number
  myUid?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('join')

  try {
    if (req.method !== 'POST') { return res.status(405).end() }
    if (!await checkRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    const { id, tc, leave, username, elo, uid } = req.body as {
      id: string; tc: string; leave?: boolean;
      username?: string; elo?: number; uid?: string;
    }
    if (!id) { return res.status(400).json({ error: 'missing id' }) }

    // Sanitize identity fields — only trust basic shapes; anyone could post these.
    const cleanUsername = typeof username === 'string' && USERNAME_RE.test(username) ? username : undefined
    const cleanElo = typeof elo === 'number' && elo >= 100 && elo <= 3500 ? Math.round(elo) : undefined
    const cleanUid = typeof uid === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(uid) ? uid : undefined

    span.setAttributes({
      'player.id': id,
      'tc': tc ?? '',
      'leave': !!leave,
      ...(cleanUsername ? { 'player.username': cleanUsername } : {}),
    })

    if (leave) {
      await Promise.all([redis.del(`evaluchess:match:${id}`), redis.hdel(QUEUE_KEY, id)])
      log('info', 'player left pool', { playerId: id, username: cleanUsername ?? null, tc })
      return res.json({ ok: true })
    }

    if (!tc) { return res.status(400).json({ error: 'missing tc' }) }

    const now = Date.now()

    const existingMatch = await redis.get(`evaluchess:match:${id}`) as MatchData | null
    if (existingMatch) {
      log('info', 'returning existing match', {
        playerId: id,
        username: cleanUsername ?? existingMatch.myUsername ?? null,
        gameId: existingMatch.gameId,
        color: existingMatch.myColor,
        opponentId: existingMatch.opponentId,
        opponentUsername: existingMatch.opponentUsername ?? null,
      })
      span.setAttributes({ 'matched': true, 'match.existing': true })
      return res.json({ matched: true, ...existingMatch })
    }

    const queue = (await redis.hgetall(QUEUE_KEY) as Record<string, QueueEntry> | null) ?? {}
    const stale = Object.entries(queue)
      .filter(([qId, entry]) => qId !== id && now - entry.ts > STALE_MS)
      .map(([qId]) => qId)
    if (stale.length) {
      await redis.hdel(QUEUE_KEY, ...stale)
      log('info', 'removed stale queue entries', { count: stale.length, staleIds: stale.join(',') })
    }
    stale.forEach(qId => delete queue[qId])

    const opponents = Object.entries(queue)
      .filter(([qId, entry]) => qId !== id && entry.tc === tc)
      .sort(([, a], [, b]) => a.ts - b.ts)

    const totalQueueSize = Object.keys(queue).length
    const tcQueueSize = opponents.length
    metric('chess.queue_size', totalQueueSize, { tc })
    span.setAttributes({ 'queue.size': totalQueueSize, 'queue.tc_size': tcQueueSize })

    // Atomically claim an opponent. Redis HDEL returns the number of fields
    // actually removed, so only one concurrent request will ever see `1` for a
    // given opponentId — the others race-lose and try the next candidate.
    let claimedOpponent: [string, QueueEntry] | null = null
    for (const candidate of opponents) {
      const removed = await redis.hdel(QUEUE_KEY, candidate[0])
      if (removed === 1) {
        claimedOpponent = candidate
        break
      }
    }

    if (claimedOpponent) {
      const [opponentId, oppEntry] = claimedOpponent
      // Randomize colors 50/50 on each pairing so neither player is deterministically white.
      const myColor: 'white' | 'black' = Math.random() < 0.5 ? 'white' : 'black'
      const oppColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white'
      const gameId = `g_${now}_${Math.random().toString(36).substr(2, 5)}`
      const myToken = generateToken()
      const oppToken = generateToken()
      const myMatch: MatchData = {
        gameId, myColor, opponentId, token: myToken,
        opponentUsername: oppEntry.username,
        opponentElo: oppEntry.elo,
        opponentUid: oppEntry.uid,
        myUsername: cleanUsername,
        myElo: cleanElo,
        myUid: cleanUid,
      }
      const oppMatch: MatchData = {
        gameId, myColor: oppColor, opponentId: id, token: oppToken,
        opponentUsername: cleanUsername,
        opponentElo: cleanElo,
        opponentUid: cleanUid,
        myUsername: oppEntry.username,
        myElo: oppEntry.elo,
        myUid: oppEntry.uid,
      }
      const hbNow = now.toString()
      await Promise.all([
        redis.set(`evaluchess:match:${id}`, myMatch, { ex: 3600 }),
        redis.set(`evaluchess:match:${opponentId}`, oppMatch, { ex: 3600 }),
        redis.hdel(QUEUE_KEY, id),
        redis.set(`evaluchess:fen:${gameId}`, new Chess().fen(), { ex: 3600 }),
        // Seed heartbeats so the first move-poll doesn't instantly treat either
        // player as disconnected.
        redis.set(`evaluchess:hb:${gameId}:${id}`, hbNow, { ex: 15 }),
        redis.set(`evaluchess:hb:${gameId}:${opponentId}`, hbNow, { ex: 15 }),
      ])
      const waitMs = now - opponents[0][1].ts
      metric('chess.match_wait_ms', waitMs, { tc })
      log('info', 'players matched', {
        gameId,
        playerId: id,
        username: cleanUsername ?? null,
        opponentId,
        opponentUsername: oppEntry.username ?? null,
        color: myColor,
        tc,
        waitMs,
      })
      span.setAttributes({ 'matched': true, 'game.id': gameId, 'player.color': myColor })
      return res.json({ matched: true, ...myMatch })
    }

    log('info', 'player joined pool', {
      playerId: id,
      username: cleanUsername ?? null,
      tc,
      queueSize: totalQueueSize,
      tcQueueSize,
    })
    const entry: QueueEntry = { ts: now, tc }
    if (cleanUsername) entry.username = cleanUsername
    if (cleanElo !== undefined) entry.elo = cleanElo
    if (cleanUid) entry.uid = cleanUid
    await redis.hset(QUEUE_KEY, { [id]: entry })
    span.setAttribute('matched', false)
    return res.json({ matched: false })
  } catch (err) {
    recordError(span, err)
    log('error', 'join handler error', { error: String(err) })
    return res.status(500).json({ error: 'internal error' })
  } finally {
    span.end()
    flush()
  }
}
