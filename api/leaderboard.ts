import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkStrictRateLimit } from './_lib.js'
import { recentLeaders, LEADERBOARD_WINDOW_MS } from './_leaderboard.js'
import { ratingKey } from './_identity.js'
import type { Rating } from './_identity.js'
import { get } from './_store.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!(await checkStrictRateLimit(req, res, 'leaderboard'))) return
  try {
    const computedAt = Date.now()
    const leaders = await recentLeaders(computedAt)
    const rows = await Promise.all(
      leaders.map(async (row) => {
        const rating = await get<Rating>(ratingKey(row.uid))
        return { ...row, elo: rating?.elo ?? null }
      })
    )
    res.setHeader('Cache-Control', 'public, s-maxage=30')
    return res.json({
      rows,
      computedAt,
      windowStart: computedAt - LEADERBOARD_WINDOW_MS,
      scope: 'last-24-hours',
      sort: 'wins',
      cached: false,
    })
  } catch (error) {
    console.error('Leaderboard unavailable', error instanceof Error ? error.name : 'UnknownError')
    return res.status(503).json({ error: 'Leaderboard temporarily unavailable' })
  }
}
