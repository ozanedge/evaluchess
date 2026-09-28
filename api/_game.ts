import * as store from './_store.js'
import { ratingKey } from './_identity.js'
import type { Rating } from './_identity.js'
import { advanceGame, clocksAt } from '../src/lib/gameRules.js'
import type { Color, GameAction, OnlineGame } from '../src/lib/gameRules.js'
import { gameResult, resultWrite } from './_leaderboard.js'
export interface MatchData {
  gameId: string
  myColor: Color
  opponentId: string
  token: string
  session: string
  tc: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
  opponentBot?: boolean
  myUsername?: string
  myUid?: string
}
export const GAME_TTL = 86400
export const gameKey = (id: string) => `evaluchess:game:v3:${id}`
export async function updateGame(id: string, color: Color, action: GameAction) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const record = await store.read<OnlineGame>(gameKey(id))
    if (!record) throw new Error('Game expired')
    const current = record.value
    const next = advanceGame(current, color, action, Date.now())
    if (next === current) return publicGame(current)
    const writes: store.Write[] = []
    const white = next.players?.white,
      black = next.players?.black
    if (!current.result && next.result && white && black && white.uid !== black.uid) {
      const [wr, br] = await Promise.all([
        store.read<Rating>(ratingKey(white.uid)),
        store.read<Rating>(ratingKey(black.uid)),
      ])
      const w = { ...(wr?.value || white.rating) },
        b = { ...(br?.value || black.rating) }
      const score = next.result.winner === null ? 0.5 : next.result.winner === 'white' ? 1 : 0
      const expected = 1 / (1 + 10 ** ((b.elo - w.elo) / 400))
      next.ratings = {
        white: { before: w.elo, after: Math.round(w.elo + 32 * (score - expected)) },
        black: { before: b.elo, after: Math.round(b.elo + 32 * (expected - score)) },
      }
      w.elo = next.ratings.white!.after
      b.elo = next.ratings.black!.after
      w[score === 1 ? 'wins' : score === 0 ? 'losses' : 'draws']++
      b[score === 0 ? 'wins' : score === 1 ? 'losses' : 'draws']++
      w.gamesPlayed++
      b.gamesPlayed++
      writes.push(
        store.putWrite(ratingKey(white.uid), w, wr, {
          leaderboard: { uid: white.uid, username: white.username, elo: w.elo, wins: w.wins },
        }),
        store.putWrite(ratingKey(black.uid), b, br, {
          leaderboard: { uid: black.uid, username: black.username, elo: b.elo, wins: b.wins },
        })
      )
      const result = gameResult(next)
      if (result) writes.push(resultWrite(result))
    }
    writes.push(store.putWrite(gameKey(id), next, record, { ttl: GAME_TTL }))
    // Game, ratings and dated result commit together; retries cannot count a result twice.
    if (await store.transact(writes)) return publicGame(next)
    await store.backoff(attempt)
  }
  throw new Error('Game is busy; try again')
}
function publicGame(game: OnlineGame) {
  return { ...game, requests: undefined, clocks: clocksAt(game, Date.now()), serverNow: Date.now() }
}
