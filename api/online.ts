import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkStrictRateLimit } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

const PRESENCE_KEY = 'evaluchess:presence'
const STALE_MS = 90_000

// Client sends username (3–24 chars, letters/digits/._-+~! in the middle, alphanumeric at start/end).
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/

function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('online')

  try {
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    const isPost = req.method === 'POST'
    const id = readString(isPost ? (req.body as { id?: string })?.id : (req.query as { id?: string })?.id)
    const rawUsername = readString(isPost
      ? (req.body as { username?: string })?.username
      : (req.query as { username?: string })?.username)
    const username = rawUsername && USERNAME_RE.test(rawUsername) ? rawUsername : undefined

    const now = Date.now()
    if (id) {
      await redis.hset(PRESENCE_KEY, { [id]: String(now) })
      span.setAttributes({
        'player.id': id,
        ...(username ? { 'player.username': username } : {}),
      })
    }

    const raw = await redis.hgetall(PRESENCE_KEY) as Record<string, string> | null
    if (!raw) { span.setAttribute('online.count', 0); return res.json({ count: 0 }) }

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

    log('info', 'presence heartbeat', {
      onlineCount: count,
      staleRemoved: stale.length,
      method: req.method,
      ...(id ? { playerId: id } : {}),
      ...(username ? { username } : {}),
    })
    metric('chess.online_players', count)
    span.setAttribute('online.count', count)
    return res.json({ count })
  } catch (err) {
    recordError(span, err)
    log('error', 'online handler error', { error: String(err) })
    return res.status(500).json({ error: 'internal error' })
  } finally {
    span.end()
    flush()
  }
}
