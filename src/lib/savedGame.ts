import { Chess } from 'chess.js'
import type { GameAnalysisResult } from '../utils/analysis.js'
export interface SpeedPairMatch {
  playerId?: string
  playerSecret?: string
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
  tc: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
  opponentBot?: boolean
}
export interface SavedGame {
  id: string
  updatedAt: number
  completedAt?: number
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

const classifications = ['brilliant', 'best', 'good', 'inaccuracy', 'mistake', 'blunder']
const finite = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max

// Allow only the saved-game contract into private account storage.
export function normalizeSavedGame(value: unknown): SavedGame | null {
  if (!value || typeof value !== 'object') return null
  const g = value as SavedGame
  if (
    !text(g.id, 100) ||
    !/^[a-zA-Z0-9_-]+$/.test(g.id) ||
    !['computer', 'speed-pair'].includes(g.mode) ||
    !['white', 'black'].includes(g.playerColor) ||
    !Array.isArray(g.moves) ||
    g.moves.length > 2000 ||
    !g.moves.every((m) => text(m, 16)) ||
    ![0, 1, 2].includes(g.tc) ||
    ![0, 1, 2, 3].includes(g.difficulty) ||
    !finite(g.updatedAt, 0, Date.now() + 86400000) ||
    !finite(g.whiteMs, 0, 3600000) ||
    !finite(g.blackMs, 0, 3600000) ||
    !text(g.result, 300)
  )
    return null
  try {
    const chess = new Chess()
    for (const move of g.moves) chess.move(move)
  } catch {
    return null
  }
  let analysis: GameAnalysisResult | null = null
  if (
    Array.isArray(g.analysis?.moves) &&
    g.analysis.moves.length === g.moves.length &&
    g.moves.length
  ) {
    const validEval = (ev: GameAnalysisResult['moves'][number]['evalBefore']) =>
      ev &&
      finite(ev.score, -100000, 100000) &&
      (ev.mate === null || finite(ev.mate, -10000, 10000)) &&
      (ev.bestMove === null ||
        (text(ev.bestMove, 5) && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(ev.bestMove)))
    if (
      g.analysis.moves.every(
        (m, i) =>
          m &&
          m.move === g.moves[i] &&
          m.player === (i % 2 ? 'black' : 'white') &&
          classifications.includes(m.classification) &&
          finite(m.cpLoss, 0, 200000) &&
          finite(m.accuracy, 0, 100) &&
          validEval(m.evalBefore) &&
          validEval(m.evalAfter) &&
          (m.bestMove === null ||
            (text(m.bestMove, 5) && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.bestMove)))
      )
    ) {
      const cleanEval = (ev: GameAnalysisResult['moves'][number]['evalBefore']) => ({
        score: ev.score,
        mate: ev.mate,
        bestMove: ev.bestMove,
        pv: Array.isArray(ev.pv)
          ? ev.pv
              .filter((m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))
              .slice(0, 6)
          : [],
      })
      const moves = g.analysis.moves.map((m, i) => ({
        moveNumber: Math.floor(i / 2) + 1,
        move: m.move,
        player: m.player,
        classification: m.classification,
        cpLoss: m.cpLoss,
        accuracy: m.accuracy,
        bestMove: m.bestMove,
        evalBefore: cleanEval(m.evalBefore),
        evalAfter: cleanEval(m.evalAfter),
      }))
      const stats = (color: 'white' | 'black') => {
        const own = moves.filter((m) => m.player === color)
        return {
          accuracy: own.length
            ? Math.round(own.reduce((sum, m) => sum + m.accuracy, 0) / own.length)
            : 0,
          brilliant: own.filter((m) => m.classification === 'brilliant').length,
          best: own.filter((m) => m.classification === 'best').length,
          good: own.filter((m) => m.classification === 'good').length,
          inaccuracy: own.filter((m) => m.classification === 'inaccuracy').length,
          mistake: own.filter((m) => m.classification === 'mistake').length,
          blunder: own.filter((m) => m.classification === 'blunder').length,
        }
      }
      analysis = { moves, white: stats('white'), black: stats('black') }
    }
  }
  const game: SavedGame = {
    id: g.id,
    updatedAt: g.updatedAt,
    mode: g.mode,
    playerColor: g.playerColor,
    moves: [...g.moves],
    tc: g.tc,
    difficulty: g.difficulty,
    whiteMs: g.whiteMs,
    blackMs: g.blackMs,
    result: g.result,
    analysis,
    ...(g.result
      ? {
          completedAt: finite(g.completedAt, 0, Date.now() + 86400000)
            ? g.completedAt
            : g.updatedAt,
        }
      : {}),
    attempts: {},
  }
  for (const [ply, attempt] of Object.entries(g.attempts || {})) {
    const i = Number(ply)
    if (
      String(i) !== ply ||
      !Number.isInteger(i) ||
      i < 0 ||
      i >= game.moves.length ||
      i % 2 !== (game.playerColor === 'white' ? 0 : 1) ||
      !attempt ||
      !finite(attempt.tries, 0, 1000000) ||
      !finite(attempt.lastAt, 0, Date.now() + 86400000) ||
      typeof attempt.solved !== 'boolean'
    )
      continue
    game.attempts![ply] = {
      tries: Math.floor(attempt.tries),
      solved: attempt.solved,
      lastAt: attempt.lastAt,
    }
  }
  const match = g.match
  if (
    match &&
    text(match.gameId, 100) &&
    text(match.token, 256) &&
    ['white', 'black'].includes(match.myColor) &&
    text(match.opponentId, 100) &&
    text(match.tc, 10)
  ) {
    game.match = {
      gameId: match.gameId,
      token: match.token,
      myColor: match.myColor,
      opponentId: match.opponentId,
      tc: match.tc,
    }
    for (const key of ['playerId', 'playerSecret', 'opponentUsername', 'opponentUid'] as const)
      if (text(match[key], 256)) game.match[key] = match[key]
    if (finite(match.opponentElo, 0, 10000)) game.match.opponentElo = match.opponentElo
    if (typeof match.opponentBot === 'boolean') game.match.opponentBot = match.opponentBot
  }
  return game
}

export function mergeSavedGame(previous: SavedGame | undefined, incoming: SavedGame): SavedGame {
  if (!previous) return incoming
  const sameLine =
    previous.playerColor === incoming.playerColor &&
    previous.mode === incoming.mode &&
    previous.moves
      .slice(0, Math.min(previous.moves.length, incoming.moves.length))
      .every((move, i) => move === incoming.moves[i])
  if (!sameLine) return previous // Different continuations are never spliced into one game.
  const winner =
    previous.result && !incoming.result
      ? previous
      : incoming.result && !previous.result && incoming.moves.length >= previous.moves.length
        ? incoming
        : incoming.moves.length > previous.moves.length
          ? incoming
          : incoming.moves.length < previous.moves.length
            ? previous
            : incoming.updatedAt > previous.updatedAt
              ? incoming
              : previous
  const other = winner === incoming ? previous : incoming
  const attempts = { ...winner.attempts }
  for (const [ply, attempt] of Object.entries(other.attempts || {})) {
    if (Number(ply) >= winner.moves.length) continue
    const current = attempts[ply]
    attempts[ply] = current
      ? {
          tries: Math.max(current.tries, attempt.tries),
          solved: current.solved || attempt.solved,
          lastAt: Math.max(current.lastAt, attempt.lastAt),
        }
      : attempt
  }
  return {
    ...winner,
    attempts,
    completedAt: previous.completedAt || incoming.completedAt,
    analysis:
      winner.analysis || (other.moves.length === winner.moves.length ? other.analysis : null),
    match: winner.match || other.match,
  }
}
