import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    const { gameId, san, resign } = req.body as { gameId: string; san?: string; resign?: boolean }
    if (!gameId) return res.status(400).json({ error: 'missing gameId' })
    if (resign) {
      await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
      return res.json({ ok: true })
    }
    if (!san) return res.status(400).json({ error: 'missing san' })
    await redis.rpush(`evaluchess:moves:${gameId}`, san)
    await redis.expire(`evaluchess:moves:${gameId}`, 3600)
    return res.json({ ok: true })
  }

  if (req.method === 'GET') {
    const { gameId, since } = req.query as { gameId: string; since?: string }
    if (!gameId) return res.status(400).json({ error: 'missing gameId' })
    const sinceIdx = since ? parseInt(since) : 0
    const [moves, resigned] = await Promise.all([
      redis.lrange(`evaluchess:moves:${gameId}`, sinceIdx, -1) as Promise<string[]>,
      redis.get(`evaluchess:resigned:${gameId}`),
    ])
    return res.json({ moves, resigned: !!resigned })
  }

  return res.status(405).end()
}
