import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkStrictRateLimit } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

const PRESENCE_KEY = 'evaluchess:presence'
const STALE_MS = 90_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('online')
  let statusCode = 200
  let body: unknown = null

  try {
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); statusCode = 429; return }

    const id = req.method === 'POST'
      ? (req.body as { id?: string })?.id
      : (req.query as { id?: string })?.id

    const now = Date.now()
    if (id) { await redis.hset(PRESENCE_KEY, { [id]: String(now) }); span.setAttribute('player.id', id) }

    const raw = await redis.hgetall(PRESENCE_KEY) as Record<string, string> | null
    if (!raw) { span.setAttribute('online.count', 0); body = { count: 0 }; return }

    let count = 0
    const stale: string[] = []
    for (const [pid, ts] of Object.entries(raw)) {
      if (now - parseInt(ts) < STALE_MS) count++
      else stale.push(pid)
    }
    if (stale.length) {
      await redis.hdel(PRESENCE_KEY, ...stale)
      log('info', 'removed stale presence entries', { count: stale.length })
    }

    log('info', 'presence heartbeat', { onlineCount: count, staleRemoved: stale.length, method: req.method, ...(id ? { playerId: id } : {}) })
    metric('chess.online_players', count)
    span.setAttribute('online.count', count)
    body = { count }
  } catch (err) {
    recordError(span, err)
    log('error', 'online handler error', { error: String(err) })
    statusCode = 500; body = { error: 'internal error' }
  } finally {
    span.end()
    flush()
  }

  if (statusCode === 429) return
  return res.status(statusCode).json(body)
}
