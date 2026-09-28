import type { VercelRequest, VercelResponse } from '@vercel/node'
import { identity } from './_identity.js'
import { checkStrictRateLimit } from './_lib.js'
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).end()
  if (!(await checkStrictRateLimit(req, res))) return
  try {
    const user = await identity(req)
    if (!user) return res.status(401).json({ error: 'Sign in required' })
    return res.json(user.rating)
  } catch {
    return res.status(503).json({ error: 'Rating temporarily unavailable' })
  }
}
