import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkRateLimit } from './_lib.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!await checkRateLimit(req, res)) return

  const { id } = req.query as { id: string }
  if (!id) return res.status(400).json({ error: 'missing id' })

  const match = await redis.get(`evaluchess:match:${id}`)
  if (match) return res.json({ matched: true, ...(match as object) })
  return res.json({ matched: false })
}
