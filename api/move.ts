import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkRateLimit } from './_lib.js'
import { findMatch } from './_matchmaking.js'
import { updateGame } from './_game.js'
import type { GameAction } from '../src/lib/gameRules.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end()
  if (!(await checkRateLimit(req, res))) return
  const input = req.method === 'GET' ? req.query : req.body
  const { gameId, playerId } = input || {}
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  if (typeof gameId !== 'string' || typeof playerId !== 'string' || !token)
    return res.status(400).json({ error: 'Missing game credentials' })
  try {
    const match = await findMatch(playerId)
    if (!match || match.gameId !== gameId || match.token !== token)
      return res.status(403).json({ error: 'Unauthorized game access' })
    let action: GameAction = { type: 'poll' }
    if (req.method === 'POST') {
      if (input.resign === true) action = { type: 'resign' }
      else if (
        typeof input.san === 'string' &&
        input.san.length <= 16 &&
        Number.isInteger(input.expectedPly) &&
        typeof input.requestId === 'string'
      ) {
        action = {
          type: 'move',
          san: input.san,
          expectedPly: input.expectedPly,
          requestId: input.requestId,
        }
      } else return res.status(400).json({ error: 'Invalid move request' })
    }
    const game = await updateGame(gameId, match.myColor, action)
    return res.json({ game })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Game unavailable'
    const known = /turn|changed|Illegal|ended|expired|busy|Invalid/.test(message)
    return res
      .status(known ? 409 : 503)
      .json({ error: known ? message : 'Game temporarily unavailable; reconnecting.' })
  }
}
