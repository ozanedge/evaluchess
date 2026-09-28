import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkMatchmakingRateLimit } from './_lib.js'
import { findMatch } from './_matchmaking.js'
import { sessionHash } from './join.js'
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).end()
  if (!(await checkMatchmakingRateLimit(req, res))) return
  const id = req.query.id,
    session = sessionHash(req.headers['x-player-secret'])
  if (typeof id !== 'string' || !session)
    return res.status(400).json({ error: 'Invalid player credentials' })
  try {
    const match = await findMatch(id)
    if (!match) return res.json({ matched: false })
    if (match.session !== session) return res.status(403).json({ error: 'Unauthorized' })
    const { session: _session, ...publicMatch } = match
    void _session
    return res.json({ matched: true, match: publicMatch })
  } catch {
    return res.status(503).json({ error: 'Match status unavailable' })
  }
}
