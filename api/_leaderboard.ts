import * as store from './_store.js'
import type { OnlineGame, Color } from '../src/lib/gameRules.js'

export const LEADERBOARD_WINDOW_MS = 24 * 60 * 60 * 1000
interface ResultPlayer {
  uid: string
  username: string
  ratingChange: number
}
export interface LeaderboardResult {
  gameId: string
  endedAt: number
  winner: Color | null
  white: ResultPlayer
  black: ResultPlayer
}
export interface LeaderboardRow extends ResultPlayer {
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
}

export const resultPartition = (time: number) =>
  `leaderboard:results:v1:${new Date(time).toISOString().slice(0, 10)}`
export const resultSortKey = (result: LeaderboardResult) => `${result.endedAt}#${result.gameId}`

export function gameResult(game: OnlineGame): LeaderboardResult | null {
  const { white, black } = game.players || {}
  if (
    !game.result ||
    !white ||
    !black ||
    white.uid === black.uid ||
    !game.ratings?.white ||
    !game.ratings.black
  )
    return null
  return {
    gameId: game.id,
    endedAt: game.turnAt,
    winner: game.result.winner,
    white: {
      uid: white.uid,
      username: white.username,
      ratingChange: game.ratings.white.after - game.ratings.white.before,
    },
    black: {
      uid: black.uid,
      username: black.username,
      ratingChange: game.ratings.black.after - game.ratings.black.before,
    },
  }
}

export function resultWrite(result: LeaderboardResult) {
  return store.putWrite(resultPartition(result.endedAt), result, null, {
    sk: resultSortKey(result),
    // TTL only cleans up. The read path enforces the exact rolling window.
    ttl: Math.max(1, Math.ceil((result.endedAt + 2 * LEADERBOARD_WINDOW_MS - Date.now()) / 1000)),
  })
}

export function summarizeResults(results: LeaderboardResult[], now: number): LeaderboardRow[] {
  const players = new Map<string, LeaderboardRow>()
  const seen = new Set<string>()
  for (const result of results) {
    if (
      result.endedAt <= now - LEADERBOARD_WINDOW_MS ||
      result.endedAt > now ||
      seen.has(result.gameId)
    )
      continue
    seen.add(result.gameId)
    for (const color of ['white', 'black'] as const) {
      const player = result[color]
      let row = players.get(player.uid)
      if (!row) {
        row = {
          uid: player.uid,
          username: player.username,
          ratingChange: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          gamesPlayed: 0,
        }
        players.set(player.uid, row)
      }
      row.gamesPlayed++
      row.ratingChange += player.ratingChange
      row[result.winner === null ? 'draws' : result.winner === color ? 'wins' : 'losses']++
    }
  }
  return [...players.values()]
    .sort(
      (a, b) =>
        b.wins - a.wins || a.username.localeCompare(b.username) || a.uid.localeCompare(b.uid)
    )
    .slice(0, 10)
}

export async function recentLeaders(now = Date.now()) {
  const days = [resultPartition(now - LEADERBOARD_WINDOW_MS), resultPartition(now)]
  const partitions = await Promise.all(days.map((day) => store.partition<LeaderboardResult>(day)))
  return summarizeResults(
    partitions.flat().map((row) => row.value),
    now
  )
}
