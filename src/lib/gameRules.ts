import { Chess } from 'chess.js'

export type Color = 'white' | 'black'
export interface GameResult {
  winner: Color | null
  reason: 'checkmate' | 'draw' | 'timeout' | 'resignation'
}
export interface OnlineGame {
  id: string
  version: number
  moves: string[]
  requests: string[]
  fen: string
  whiteMs: number
  blackMs: number
  incrementMs: number
  turnAt: number
  result: GameResult | null
  players?: Partial<
    Record<
      Color,
      {
        uid: string
        username: string
        rating: { elo: number; wins: number; losses: number; draws: number; gamesPlayed: number }
      }
    >
  >
  ratings?: Partial<Record<Color, { before: number; after: number }>>
}
export type GameAction =
  | { type: 'move'; san: string; expectedPly: number; requestId: string }
  | { type: 'resign' }
  | { type: 'poll' }
export const TIME_CONTROL = { label: '5+0', seconds: 300, increment: 0 } as const
export const opposite = (color: Color): Color => (color === 'white' ? 'black' : 'white')
export function replay(moves: string[]) {
  const chess = new Chess()
  for (const san of moves) chess.move(san)
  return chess
}
export function createGame(id: string, tc: string, now: number): OnlineGame {
  if (tc !== TIME_CONTROL.label) throw new Error('All games use 5+0')
  return {
    id,
    version: 0,
    moves: [],
    requests: [],
    fen: new Chess().fen(),
    whiteMs: TIME_CONTROL.seconds * 1000,
    blackMs: TIME_CONTROL.seconds * 1000,
    incrementMs: 0,
    turnAt: now,
    result: null,
  }
}
export function clocksAt(game: OnlineGame, now: number) {
  const active = game.fen.split(' ')[1] === 'w' ? 'white' : 'black'
  const elapsed = game.result ? 0 : Math.max(0, now - game.turnAt)
  return {
    whiteMs: Math.max(0, game.whiteMs - (active === 'white' ? elapsed : 0)),
    blackMs: Math.max(0, game.blackMs - (active === 'black' ? elapsed : 0)),
  }
}
// A bare king cannot win on time. A lone bishop/knight cannot mate a bare king either.
function canPossiblyMate(chess: Chess, color: Color) {
  const own = chess
    .board()
    .flat()
    .filter((p) => p && p.color === color[0] && p.type !== 'k')
  if (!own.length) return false
  const other = chess
    .board()
    .flat()
    .filter((p) => p && p.color !== color[0] && p.type !== 'k')
  if (!other.length && own.length === 1 && ['b', 'n'].includes(own[0]!.type)) return false
  return !chess.isInsufficientMaterial()
}
export function advanceGame(
  game: OnlineGame,
  color: Color,
  action: GameAction,
  now: number
): OnlineGame {
  if (action.type === 'move' && game.requests.includes(action.requestId)) return game
  if (game.result) {
    if (action.type === 'move') throw new Error('Game has ended')
    return game
  }
  const chess = replay(game.moves)
  const turn: Color = chess.turn() === 'w' ? 'white' : 'black'
  const clock = clocksAt(game, now)
  const finish = (result: GameResult): OnlineGame => ({
    ...game,
    ...clock,
    turnAt: now,
    result,
    version: game.version + 1,
  })
  if ((turn === 'white' ? clock.whiteMs : clock.blackMs) === 0) {
    const winner = opposite(turn)
    return finish({ winner: canPossiblyMate(chess, winner) ? winner : null, reason: 'timeout' })
  }
  if (action.type === 'poll') return game
  if (action.type === 'resign') return finish({ winner: opposite(color), reason: 'resignation' })
  if (color !== turn) throw new Error('It is not your turn')
  if (action.expectedPly !== game.moves.length)
    throw new Error('Position changed; reconnect to synchronize')
  if (!action.requestId || action.requestId.length > 100) throw new Error('Invalid move request')
  let move
  try {
    move = chess.move(action.san)
  } catch {
    throw new Error('Illegal move')
  }
  if (!move) throw new Error('Illegal move')
  const result: GameResult | null = chess.isCheckmate()
    ? { winner: color, reason: 'checkmate' }
    : chess.isDraw()
      ? { winner: null, reason: 'draw' }
      : null
  return {
    ...game,
    ...clock,
    [color === 'white' ? 'whiteMs' : 'blackMs']:
      (color === 'white' ? clock.whiteMs : clock.blackMs) + game.incrementMs,
    fen: chess.fen(),
    moves: [...game.moves, move.san],
    requests: [...game.requests, action.requestId],
    version: game.version + 1,
    turnAt: now,
    result,
  }
}
