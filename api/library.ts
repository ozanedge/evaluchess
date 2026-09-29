import type { VercelRequest, VercelResponse } from '@vercel/node'
import { identity } from './_identity.js'
import { checkMatchmakingRateLimit } from './_lib.js'
import * as store from './_store.js'
import { normalizeSavedGame, mergeSavedGame } from '../src/lib/savedGame.js'
import type { SavedGame } from '../src/lib/savedGame.js'

type Index = { games: { id: string; updatedAt: number }[]; badges: string[] }
const allowedBadges = new Set([
  'first-finish',
  'analyst',
  'tactician',
  'regular',
  'problem-solver',
  'deep-thinker',
  'tactics-expert',
  'veteran',
  'practice-master',
  'steady-hand',
  'precision',
  'on-the-rise',
])
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end()
  if (!(await checkMatchmakingRateLimit(req, res))) return
  try {
    const user = await identity(req)
    if (!user) return res.status(401).json({ error: 'Sign in to sync your progress.' })
    const pk = `evaluchess:library:v1:${user.uid}`
    if (req.method === 'GET') {
      const offset = Number(req.query.cursor || 0)
      if (!Number.isInteger(offset) || offset < 0 || offset > 50 || offset % 5)
        return res.status(400).json({ error: 'Invalid library cursor.' })
      const index = await store.get<Index>(pk)
      const page = index?.games.slice(offset, offset + 5) || []
      const games = await Promise.all(
        page.map((game) => store.get<SavedGame>(pk, `game:${game.id}`))
      )
      return res.json({
        uid: user.uid,
        games: games.filter(Boolean),
        badges: index?.badges || [],
        cursor: index && offset + 5 < index.games.length ? offset + 5 : null,
      })
    }
    // Prevent an old tab/request from writing after the session changes accounts.
    if (req.body?.uid !== user.uid)
      return res.status(409).json({ error: 'Your account changed. Sign in again to sync.' })
    if (
      !Array.isArray(req.body.games) ||
      req.body.games.length > 5 ||
      !Array.isArray(req.body.badges) ||
      req.body.badges.length > 30 ||
      Buffer.byteLength(JSON.stringify(req.body)) > 1500000
    )
      return res.status(400).json({ error: 'Invalid progress batch.' })
    const games: SavedGame[] = []
    for (const value of req.body.games) {
      const game = normalizeSavedGame(value)
      if (
        !game ||
        Buffer.byteLength(JSON.stringify(game)) > 300000 ||
        games.some((g) => g.id === game.id)
      )
        return res.status(400).json({ error: 'A saved game is invalid or too large to sync.' })
      games.push(game)
    }
    const badges = req.body.badges.filter(
      (id: unknown): id is string => typeof id === 'string' && allowedBadges.has(id)
    )
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await store.read<Index>(pk)
      const rows = await Promise.all(
        games.map((game) => store.read<SavedGame>(pk, `game:${game.id}`))
      )
      for (let i = 0; i < games.length; i++) {
        const old = rows[i]?.value,
          game = games[i]
        if (
          old &&
          (old.playerColor !== game.playerColor ||
            old.mode !== game.mode ||
            old.moves
              .slice(0, Math.min(old.moves.length, game.moves.length))
              .some((move, ply) => move !== game.moves[ply]))
        )
          return res
            .status(409)
            .json({
              code: 'different-continuation',
              error:
                'This game continued differently on another device. Your local copy is safe; download its PGN from My games to keep it.',
            })
      }
      const merged = games.map((game, i) => mergeSavedGame(rows[i]?.value, game))
      const entries = new Map((previous?.value.games || []).map((game) => [game.id, game]))
      for (const game of merged) entries.set(game.id, { id: game.id, updatedAt: game.updatedAt })
      const sorted = [...entries.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
      )
      const index: Index = {
        games: sorted.slice(0, 50),
        badges: [...new Set([...(previous?.value.badges || []), ...badges])],
      }
      const removed = sorted.slice(50)
      const oldRows = await Promise.all(
        removed.map((game) => store.read<SavedGame>(pk, `game:${game.id}`))
      )
      const writes = [store.putWrite(pk, index, previous)]
      for (let i = 0; i < merged.length; i++)
        if (index.games.some((game) => game.id === merged[i].id))
          writes.push(store.putWrite(pk, merged[i], rows[i], { sk: `game:${merged[i].id}` }))
      for (let i = 0; i < removed.length; i++)
        if (oldRows[i]) writes.push(store.deleteWrite(pk, oldRows[i], `game:${removed[i].id}`))
      if (await store.transact(writes))
        return res.json({ uid: user.uid, games: merged, badges: index.badges })
      await store.backoff(attempt)
    }
    return res.status(409).json({ error: 'Progress is syncing from another device. Please retry.' })
  } catch {
    return res
      .status(503)
      .json({ error: 'Progress sync is temporarily unavailable. Your local copy is safe.' })
  }
}
