import { Chess } from 'chess.js'
import { normalizeSavedGame, mergeSavedGame } from './savedGame'
import {
  progressKey,
  progressOwner,
  changeProgressOwner,
  markProgressPending,
  notifyProgress,
} from './progressScope'
import { rememberEarnedBadges } from './training'
import type { SavedGame } from './savedGame'
export type { SavedGame } from './savedGame'
interface Library {
  version: 1
  games: SavedGame[]
  active: SavedGame | null
}
const KEY = 'evaluchess.library.v1'
const empty = (): Library => ({ version: 1, games: [], active: null })
export function reconstruct(moves: string[]) {
  const game = new Chess(),
    fens = [game.fen()],
    squares: { from: string; to: string }[] = []
  for (const san of moves) {
    const move = game.move(san)
    fens.push(game.fen())
    squares.push({ from: move.from, to: move.to })
  }
  return { game, fens, squares }
}
function valid(value: unknown): value is SavedGame {
  if (!value || typeof value !== 'object') return false
  const g = value as SavedGame
  if (
    typeof g.id !== 'string' ||
    !['computer', 'speed-pair'].includes(g.mode) ||
    !['white', 'black'].includes(g.playerColor) ||
    !Array.isArray(g.moves) ||
    g.moves.length > 2000 ||
    !g.moves.every((m) => typeof m === 'string' && m.length <= 16) ||
    ![0, 1, 2].includes(g.tc) ||
    ![0, 1, 2, 3].includes(g.difficulty) ||
    !Number.isFinite(g.updatedAt) ||
    !Number.isFinite(g.whiteMs) ||
    g.whiteMs < 0 ||
    !Number.isFinite(g.blackMs) ||
    g.blackMs < 0 ||
    typeof g.result !== 'string'
  )
    return false
  try {
    reconstruct(g.moves)
  } catch {
    return false
  }
  if (
    g.analysis &&
    (!Array.isArray(g.analysis.moves) ||
      g.analysis.moves.length !== g.moves.length ||
      !g.analysis.white ||
      !g.analysis.black ||
      !g.analysis.moves.every(
        (m) => m && m.evalBefore && m.evalAfter && typeof m.classification === 'string'
      ))
  )
    g.analysis = null
  if (g.match && (typeof g.match.gameId !== 'string' || typeof g.match.token !== 'string'))
    delete g.match
  return true
}
export function readLibrary(): Library {
  try {
    const stored = JSON.parse(localStorage.getItem(progressKey(KEY)) || 'null')
    if (stored?.version !== 1 || !Array.isArray(stored.games)) return empty()
    return {
      version: 1,
      games: stored.games.filter(valid).slice(0, 50),
      active: valid(stored.active) ? stored.active : null,
    }
  } catch {
    return empty()
  }
}
export function saveGame(game: SavedGame, active = true) {
  const library = readLibrary()
  const previous = library.games.find((g) => g.id === game.id)
  const saved = {
    ...game,
    attempts: previous?.attempts || game.attempts,
    completedAt:
      previous?.completedAt || game.completedAt || (game.result ? game.updatedAt : undefined),
  }
  rememberEarnedBadges([saved, ...library.games.filter((g) => g.id !== game.id)])
  library.games = [saved, ...library.games.filter((g) => g.id !== game.id)].slice(0, 50)
  if (active) library.active = saved
  markProgressPending(saved.id)
  localStorage.setItem(progressKey(KEY), JSON.stringify(library))
  notifyProgress()
}
export function clearActive() {
  const library = readLibrary()
  library.active = null
  localStorage.setItem(progressKey(KEY), JSON.stringify(library))
}
export function recordAttempt(id: string, ply: number, solved: boolean) {
  const library = readLibrary(),
    game = library.games.find((g) => g.id === id)
  if (!game) return
  const previous = game.attempts?.[ply]
  game.attempts = {
    ...game.attempts,
    [ply]: {
      tries: (previous?.tries || 0) + 1,
      solved: !!previous?.solved || solved,
      lastAt: Date.now(),
    },
  }
  if (library.active?.id === id) library.active = game
  localStorage.setItem(progressKey(KEY), JSON.stringify(library))
  rememberEarnedBadges(library.games)
  markProgressPending(game.id)
  notifyProgress()
}
export function exportPgn(game: SavedGame) {
  const chess = reconstruct(game.moves).game
  chess.header(
    'Event',
    'Evaluchess',
    'Date',
    new Date(game.updatedAt).toISOString().slice(0, 10).replaceAll('-', '.'),
    'White',
    game.playerColor === 'white' ? 'You' : 'Opponent',
    'Black',
    game.playerColor === 'black' ? 'You' : 'Opponent'
  )
  return chess.pgn()
}

export function setLibraryOwner(uid: string | null) {
  if (progressOwner() === uid) return
  // A guest collection is claimed once; account caches never become guest data.
  const guest = !progressOwner() && uid ? readLibrary() : null
  const guestBadges = !progressOwner() && uid ? localStorage.getItem('evaluchess.badges.v1') : null
  const previousOwner = progressOwner()
  changeProgressOwner(uid)
  try {
    if (guest && (guest.games.length || guestBadges)) {
      const current = readLibrary()
      const games = new Map(current.games.map((game) => [game.id, game]))
      for (const game of guest.games) {
        games.set(game.id, mergeSavedGame(games.get(game.id), game))
        markProgressPending(game.id)
      }
      current.games = [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
      current.active ||= guest.active
      localStorage.setItem(progressKey(KEY), JSON.stringify(current))
      let badges: unknown = []
      try {
        badges = JSON.parse(guestBadges || '[]')
      } catch {
        /* preserve valid games */
      }
      mergeAccountBadges(Array.isArray(badges) ? badges.filter((id) => typeof id === 'string') : [])
      localStorage.removeItem(KEY)
      localStorage.removeItem('evaluchess.badges.v1')
      localStorage.removeItem('evaluchess.pending.v1')
    }
    notifyProgress()
  } catch (error) {
    changeProgressOwner(previousOwner)
    throw error
  }
}

export function mergeAccountBadges(badges: string[]) {
  const key = progressKey('evaluchess.badges.v1')
  let previous: unknown = []
  try {
    previous = JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    /* start clean */
  }
  localStorage.setItem(
    key,
    JSON.stringify([...new Set([...(Array.isArray(previous) ? previous : []), ...badges])])
  )
}

export function receiveAccountProgress(incoming: unknown[], badges: string[]) {
  const library = readLibrary()
  const wasEmpty = !library.games.length
  const games = new Map(library.games.map((game) => [game.id, game]))
  for (const value of incoming) {
    const game = normalizeSavedGame(value)
    if (game) games.set(game.id, mergeSavedGame(games.get(game.id), game))
  }
  library.games = [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
  if (library.active) library.active = games.get(library.active.id) || library.active
  else if (wasEmpty) library.active = library.games[0] || null
  localStorage.setItem(progressKey(KEY), JSON.stringify(library))
  mergeAccountBadges(badges)
  rememberEarnedBadges(library.games)
  notifyProgress()
}
