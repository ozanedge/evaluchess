import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkRateLimit } from './_lib.js'

const PRESENCE_KEY = 'evaluchess:presence'
const STALE_MS = 30_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await checkRateLimit(req, res)) return

  const id = req.method === 'POST'
    ? (req.body as { id?: string })?.id
    : (req.query as { id?: string })?.id

  const now = Date.now()

  if (id) {
    await redis.hset(PRESENCE_KEY, { [id]: String(now) })
  }

  const raw = await redis.hgetall(PRESENCE_KEY) as Record<string, string> | null
  if (!raw) return res.json({ count: 0 })

  let count = 0
  const stale: string[] = []
  for (const [pid, ts] of Object.entries(raw)) {
    if (now - parseInt(ts) < STALE_MS) count++
    else stale.push(pid)
  }
  if (stale.length) await redis.hdel(PRESENCE_KEY, ...stale)

  return res.json({ count })
}
