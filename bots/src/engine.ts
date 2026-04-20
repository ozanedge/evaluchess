import { Chess } from 'chess.js'

// Very lightweight ~800-Elo heuristic: take mates, take hanging pieces, avoid
// leaving pieces hanging at destination, otherwise random with small positional
// nudges and frequent blunders. Not trying to be accurate — just plausible.

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const CENTER = new Set(['d4', 'e4', 'd5', 'e5'])

function pieceValue(p?: string): number {
  if (!p) return 0
  return PIECE_VALUE[p.toLowerCase()] ?? 0
}

export function pickNoviceMove(fen: string): string | null {
  const chess = new Chess(fen)
  const moves = chess.moves({ verbose: true }) as {
    from: string; to: string; san: string; piece: string; captured?: string; promotion?: string
  }[]
  if (moves.length === 0) return null

  // 1. Always take checkmate if offered.
  for (const m of moves) {
    const probe = new Chess(fen)
    probe.move(m.san)
    if (probe.isCheckmate()) return m.san
  }

  // 2. Score each candidate move.
  const scored = moves.map((m) => {
    let score = 0
    if (m.captured) score += 10 * pieceValue(m.captured)

    // Avoid moving into a square attacked by opponent (shallow, 1-ply).
    const probe = new Chess(fen)
    probe.move(m.san)
    const oppMoves = probe.moves({ verbose: true }) as { to: string; captured?: string }[]
    const hanging = oppMoves.some((o) => o.to === m.to && o.captured)
    if (hanging) score -= 8 * pieceValue(m.piece)

    if (CENTER.has(m.to)) score += 0.4
    score += Math.random() * 1.5 - 0.75
    return { m, score }
  })

  // 3. Blunder rate: 25% of the time just pick a random legal move regardless.
  if (Math.random() < 0.25) {
    return scored[Math.floor(Math.random() * scored.length)].m.san
  }

  scored.sort((a, b) => b.score - a.score)
  const topN = Math.min(3, scored.length)
  return scored[Math.floor(Math.random() * topN)].m.san
}
