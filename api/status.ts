import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const { id } = req.query as { id: string }
  if (!id) return res.status(400).json({ error: 'missing id' })

  const match = await redis.get(`evaluchess:match:${id}`)
  if (match) return res.json({ matched: true, ...(match as object) })
  return res.json({ matched: false })
}
