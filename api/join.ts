import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkStrictRateLimit, generateToken } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

const QUEUE_KEY = 'evaluchess:queue'
const STALE_MS = 60_000

interface QueueEntry { ts: number; tc: string }
interface MatchData { gameId: string; myColor: 'white' | 'black'; opponentId: string; token: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('join')
  let statusCode = 200
  let body: unknown = null

  try {
    if (req.method !== 'POST') { statusCode = 405; return }
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); statusCode = 429; return }

    const { id, tc, leave } = req.body as { id: string; tc: string; leave?: boolean }
    if (!id) { statusCode = 400; body = { error: 'missing id' }; return }

    span.setAttributes({ 'player.id': id, 'tc': tc ?? '', 'leave': !!leave })

    if (leave) {
      await Promise.all([redis.del(`evaluchess:match:${id}`), redis.hdel(QUEUE_KEY, id)])
      log('info', 'player left pool', { playerId: id, tc })
      body = { ok: true }; return
    }

    if (!tc) { statusCode = 400; body = { error: 'missing tc' }; return }

    const now = Date.now()

    const existingMatch = await redis.get(`evaluchess:match:${id}`) as MatchData | null
    if (existingMatch) {
      log('info', 'returning existing match', { playerId: id, gameId: existingMatch.gameId, color: existingMatch.myColor, opponentId: existingMatch.opponentId })
      span.setAttributes({ 'matched': true, 'match.existing': true })
      body = { matched: true, ...existingMatch }; return
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

    if (opponents.length > 0) {
      const [opponentId] = opponents[0]
      const myColor: 'white' | 'black' = id < opponentId ? 'white' : 'black'
      const oppColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white'
      const gameId = `g_${now}_${Math.random().toString(36).substr(2, 5)}`
      const myToken = generateToken()
      const oppToken = generateToken()
      const myMatch: MatchData = { gameId, myColor, opponentId, token: myToken }
      const oppMatch: MatchData = { gameId, myColor: oppColor, opponentId: id, token: oppToken }
      await Promise.all([
        redis.set(`evaluchess:match:${id}`, myMatch, { ex: 3600 }),
        redis.set(`evaluchess:match:${opponentId}`, oppMatch, { ex: 3600 }),
        redis.hdel(QUEUE_KEY, id, opponentId),
        redis.set(`evaluchess:fen:${gameId}`, new Chess().fen(), { ex: 3600 }),
      ])
      const waitMs = now - opponents[0][1].ts
      metric('chess.match_wait_ms', waitMs, { tc })
      log('info', 'players matched', { gameId, playerId: id, opponentId, color: myColor, tc, waitMs })
      span.setAttributes({ 'matched': true, 'game.id': gameId, 'player.color': myColor })
      body = { matched: true, ...myMatch }; return
    }

    log('info', 'player joined pool', { playerId: id, tc, queueSize: totalQueueSize, tcQueueSize })
    await redis.hset(QUEUE_KEY, { [id]: { ts: now, tc } })
    span.setAttribute('matched', false)
    body = { matched: false }
  } catch (err) {
    recordError(span, err)
    log('error', 'join handler error', { error: String(err) })
    statusCode = 500; body = { error: 'internal error' }
  } finally {
    span.end()
    await flush()
  }

  if (statusCode === 405) return res.status(405).end()
  if (statusCode === 429) return
  return res.status(statusCode).json(body)
}
