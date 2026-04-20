import type { PositionEval } from '../hooks/useStockfish'

export type MoveClassification = 'brilliant' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface MoveAnalysis {
  moveNumber: number
  move: string
  player: 'white' | 'black'
  classification: MoveClassification
  cpLoss: number
  accuracy: number // 0–100 per-move accuracy
  evalBefore: PositionEval
  evalAfter: PositionEval
  bestMove: string | null // UCI format of the best move at this position
}

export interface GameAnalysisResult {
  moves: MoveAnalysis[]
  white: PlayerStats
  black: PlayerStats
}

export interface PlayerStats {
  accuracy: number
  brilliant: number
  best: number
  good: number
  inaccuracy: number
  mistake: number
  blunder: number
}

// Convert centipawns to win probability using Elo-style base-10 logistic (steeper than natural exp,
// matching Chess.com's model more closely so mistakes/blunders are penalised realistically)
function cpToWinProb(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400))
}

function winProbToAccuracy(winProbBefore: number, winProbAfter: number): number {
  // Chess.com-style accuracy formula
  const delta = Math.max(0, winProbBefore - winProbAfter)
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * delta * 100) - 3.1669))
}

function classifyMove(cpLoss: number): MoveClassification {
  if (cpLoss <= 0) return 'best'
  if (cpLoss <= 20) return 'good'
  if (cpLoss <= 50) return 'inaccuracy'
  if (cpLoss <= 150) return 'mistake'
  return 'blunder'
}

// UCI score cp is from the side-to-move's perspective.
// Position index i: white to move if i%2==0, black to move if i%2==1.
// This converts to white's absolute perspective.
function toWhitePersp(ev: PositionEval, posIdx: number): number {
  if (ev.mate !== null) return ev.mate > 0 ? (posIdx % 2 === 0 ? 9999 : -9999) : (posIdx % 2 === 0 ? -9999 : 9999)
  return posIdx % 2 === 0 ? ev.score : -ev.score
}

export function buildAnalysis(
  moves: string[],
  evals: PositionEval[]
): GameAnalysisResult {
  const moveAnalyses: MoveAnalysis[] = []

  // evals[i] = position before move i (position index = i)
  // evals[i+1] = position after move i (position index = i+1)
  for (let i = 0; i < moves.length; i++) {
    const evalBefore = evals[i]
    const evalAfter = evals[i + 1]
    const player: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black'

    // Convert both evals to white's absolute perspective
    const whiteBefore = toWhitePersp(evalBefore, i)
    const whiteAfter = toWhitePersp(evalAfter, i + 1)

    // cpLoss = how much the position worsened for the player who moved
    const cpLoss = player === 'white'
      ? Math.max(0, whiteBefore - whiteAfter)
      : Math.max(0, whiteAfter - whiteBefore)

    const wp1 = player === 'white' ? cpToWinProb(whiteBefore) : 1 - cpToWinProb(whiteBefore)
    const wp2 = player === 'white' ? cpToWinProb(whiteAfter) : 1 - cpToWinProb(whiteAfter)
    const accuracy = winProbToAccuracy(wp1, wp2)

    moveAnalyses.push({
      moveNumber: Math.floor(i / 2) + 1,
      move: moves[i],
      player,
      classification: classifyMove(cpLoss),
      cpLoss,
      accuracy,
      evalBefore,
      evalAfter,
      bestMove: evalBefore.bestMove ?? null,
    })
  }

  const calcStats = (playerMoves: MoveAnalysis[], playerColor: 'white' | 'black'): PlayerStats => {
    const accuracies = playerMoves.map((m) => {
      const moveIdx = (m.moveNumber - 1) * 2 + (playerColor === 'black' ? 1 : 0)
      const whiteBefore = toWhitePersp(m.evalBefore, moveIdx)
      const whiteAfter = toWhitePersp(m.evalAfter, moveIdx + 1)
      const wp1 = playerColor === 'white' ? cpToWinProb(whiteBefore) : 1 - cpToWinProb(whiteBefore)
      const wp2 = playerColor === 'white' ? cpToWinProb(whiteAfter) : 1 - cpToWinProb(whiteAfter)
      return winProbToAccuracy(wp1, wp2)
    })
    const accuracy = accuracies.length
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : 100

    return {
      accuracy: Math.round(accuracy),
      brilliant: playerMoves.filter((m) => m.classification === 'brilliant').length,
      best: playerMoves.filter((m) => m.classification === 'best').length,
      good: playerMoves.filter((m) => m.classification === 'good').length,
      inaccuracy: playerMoves.filter((m) => m.classification === 'inaccuracy').length,
      mistake: playerMoves.filter((m) => m.classification === 'mistake').length,
      blunder: playerMoves.filter((m) => m.classification === 'blunder').length,
    }
  }

  const whiteMoves = moveAnalyses.filter((m) => m.player === 'white')
  const blackMoves = moveAnalyses.filter((m) => m.player === 'black')

  return {
    moves: moveAnalyses,
    white: calcStats(whiteMoves, 'white'),
    black: calcStats(blackMoves, 'black'),
  }
}
