import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'node:crypto'
import { checkMatchmakingRateLimit } from './_lib.js'
import { TIME_CONTROL } from '../src/lib/gameRules.js'
import { identity } from './_identity.js'
import { pair } from './_matchmaking.js'

export function sessionHash(secret: unknown) {
  if (typeof secret !== 'string' || !/^[a-zA-Z0-9-]{32,100}$/.test(secret)) return null
  return createHash('sha256').update(secret).digest('hex')
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).end()
  if (!(await checkMatchmakingRateLimit(req, res))) return
  const { id, tc, leave, username, standby } = req.body || {}
  const session = sessionHash(req.headers['x-player-secret'])
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{10,100}$/.test(id) || !session)
    return res.status(400).json({ error: 'Invalid player credentials' })
  if (!leave && tc !== undefined && tc !== TIME_CONTROL.label)
    return res.status(400).json({ error: 'All games use 5+0. Refresh to start a new game.' })
  const name =
    typeof username === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/.test(username)
      ? username
      : 'Guest'
  try {
    const user = leave ? null : await identity(req)
    const result = await pair(
      id,
      session,
      TIME_CONTROL.label,
      !!leave,
      name,
      user,
      !leave && standby === true
    )
    if (result.error) return res.status(409).json(result)
    if (result.match) {
      const { session: _session, ...match } = result.match
      void _session
      return res.json({ matched: true, match })
    }
    return res.json(result)
  } catch {
    return res.status(503).json({ error: 'Matchmaking unavailable. Please retry.' })
  }
}
