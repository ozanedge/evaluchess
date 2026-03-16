import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const PRESENCE_KEY = 'evaluchess:presence'
const STALE_MS = 30_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.method === 'POST' ? req.body : req.query as { id?: string }

  const now = Date.now()

  // Heartbeat: update this player's timestamp
  if (id) {
    await redis.hset(PRESENCE_KEY, { [id]: String(now) })
  }

  // Count active players (seen in last 30s)
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
