import { Chess } from 'chess.js'
import type { PositionEval } from '../lib/engine'
import { classifyMove } from './analysis'
import type { MoveClassification } from './analysis'

export const MOVE_COLORS: Record<MoveClassification, string> = {
  brilliant: '#22d3ee',
  best: '#39ff14',
  good: '#34d399',
  inaccuracy: '#facc15',
  mistake: '#fb923c',
  blunder: '#ef4444',
}

export interface FeedbackArrow {
  startSquare: string
  endSquare: string
  uci: string
  color: string
  kind: 'played' | 'best'
}

export interface MoveFeedback {
  beforeFen: string
  afterFen: string
  player: 'white' | 'black'
  classification: MoveClassification
  arrows: FeedbackArrow[]
}

const score = (ev: PositionEval) => (ev.mate === null ? ev.score : ev.mate > 0 ? 9999 : -9999)

export function moveFeedback(
  beforeFen: string,
  afterFen: string,
  san: string,
  before: PositionEval,
  after: PositionEval
): MoveFeedback | null {
  const game = new Chess(beforeFen)
  let played
  try {
    played = game.move(san)
  } catch {
    return null
  }
  if (game.fen() !== afterFen) return null
  const playedUci = played.from + played.to + (played.promotion || '')
  let bestUci = before.bestMove
  // Persisted reviews and engine output must describe a legal move in this position.
  try {
    if (!bestUci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestUci)) bestUci = null
    else
      new Chess(beforeFen).move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci[4],
      })
  } catch {
    bestUci = null
  }
  const playedBest = playedUci === bestUci
  // Each evaluation is from its own side-to-move's perspective.
  const classification = playedBest
    ? 'best'
    : classifyMove(Math.max(0, score(before) + score(after)))
  const arrows: FeedbackArrow[] = []
  if (Number(beforeFen.split(' ')[5]) > 1) {
    // No-loss alternatives receive the same single-arrow treatment as exact matches.
    arrows.push({
      startSquare: played.from,
      endSquare: played.to,
      uci: playedUci,
      kind: classification === 'best' ? 'best' : 'played',
      color: MOVE_COLORS[classification],
    })
    if (classification !== 'best' && bestUci)
      arrows.push({
        startSquare: bestUci.slice(0, 2),
        endSquare: bestUci.slice(2, 4),
        uci: bestUci,
        kind: 'best',
        color: MOVE_COLORS.best,
      })
  }
  return {
    beforeFen,
    afterFen,
    player: played.color === 'w' ? 'white' : 'black',
    classification,
    arrows,
  }
}
