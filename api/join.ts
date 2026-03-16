import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const QUEUE_KEY = 'evaluchess:queue'
const STALE_MS = 60_000

interface QueueEntry { ts: number; tc: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { id, tc, leave } = req.body as { id: string; tc: string; leave?: boolean }
  if (!id) return res.status(400).json({ error: 'missing id' })

  // Handle leave: clear match + queue entry and return
  if (leave) {
    await Promise.all([
      redis.del(`evaluchess:match:${id}`),
      redis.hdel(QUEUE_KEY, id),
    ])
    return res.json({ ok: true })
  }

  if (!tc) return res.status(400).json({ error: 'missing tc' })

  const now = Date.now()

  // Check if already matched (opponent may have created this match)
  const existingMatch = await redis.get(`evaluchess:match:${id}`)
  if (existingMatch) {
    return res.json({ matched: true, ...(existingMatch as object) })
  }

  // Get queue (upstash auto-deserializes values)
  const queue = (await redis.hgetall(QUEUE_KEY) as Record<string, QueueEntry> | null) ?? {}

  // Clean stale entries
  const stale = Object.entries(queue)
    .filter(([qId, entry]) => qId !== id && now - entry.ts > STALE_MS)
    .map(([qId]) => qId)
  if (stale.length) await redis.hdel(QUEUE_KEY, ...stale)
  stale.forEach(qId => delete queue[qId])

  // Find an opponent (same tc, different id)
  const opponents = Object.entries(queue)
    .filter(([qId, entry]) => qId !== id && entry.tc === tc)
    .sort(([, a], [, b]) => a.ts - b.ts)

  if (opponents.length > 0) {
    const [opponentId] = opponents[0]

    const myColor: 'white' | 'black' = id < opponentId ? 'white' : 'black'
    const oppColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white'
    const gameId = `g_${now}_${Math.random().toString(36).substr(2, 5)}`

    const myMatch = { gameId, myColor, opponentId }
    const oppMatch = { gameId, myColor: oppColor, opponentId: id }

    await Promise.all([
      redis.set(`evaluchess:match:${id}`, myMatch, { ex: 3600 }),
      redis.set(`evaluchess:match:${opponentId}`, oppMatch, { ex: 3600 }),
      redis.hdel(QUEUE_KEY, id, opponentId),
    ])

    return res.json({ matched: true, ...myMatch })
  }

  // No opponent — join queue
  await redis.hset(QUEUE_KEY, { [id]: { ts: now, tc } })
  return res.json({ matched: false })
}
