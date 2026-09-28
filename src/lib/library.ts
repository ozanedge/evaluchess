import { Chess } from 'chess.js'
import type { GameAnalysisResult } from '../utils/analysis'
import type { SpeedPairMatch } from '../hooks/useSpeedPair'
export interface SavedGame {
  id: string
  updatedAt: number
  mode: 'computer' | 'speed-pair'
  playerColor: 'white' | 'black'
  moves: string[]
  tc: number
  difficulty: number
  whiteMs: number
  blackMs: number
  result: string
  analysis: GameAnalysisResult | null
  match?: SpeedPairMatch
  attempts?: Record<string, { tries: number; solved: boolean; lastAt: number }>
}
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
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null')
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
  const saved = { ...game, attempts: previous?.attempts || game.attempts }
  library.games = [saved, ...library.games.filter((g) => g.id !== game.id)].slice(0, 50)
  if (active) library.active = saved
  localStorage.setItem(KEY, JSON.stringify(library))
}
export function clearActive() {
  const library = readLibrary()
  library.active = null
  localStorage.setItem(KEY, JSON.stringify(library))
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
  localStorage.setItem(KEY, JSON.stringify(library))
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
