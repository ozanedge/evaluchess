export const STARTING_ELO = 1200
export const K_FACTOR = 32

export type GameOutcome = 'win' | 'loss' | 'draw'

export function expectedScore(myElo: number, oppElo: number): number {
  return 1 / (1 + Math.pow(10, (oppElo - myElo) / 400))
}

export function scoreFor(outcome: GameOutcome): number {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
}

export function newRating(myElo: number, oppElo: number, outcome: GameOutcome, k = K_FACTOR): number {
  const exp = expectedScore(myElo, oppElo)
  return Math.round(myElo + k * (scoreFor(outcome) - exp))
}
