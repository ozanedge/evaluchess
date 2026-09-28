import { Chess } from 'chess.js'
import { ApiClient } from './api.js'
import type { Match, ServerGame } from './api.js'
import { pickRatedMove, strengthSettings } from './engine.js'
import {
  TIME_CONTROL,
  INITIAL_MIN_WAIT_MS,
  INITIAL_MAX_WAIT_MS,
  THINK_MIN_MS,
  THINK_MAX_MS,
  GAME_STALL_MS,
  computeNextWaitMs,
  randRange,
} from './config.js'

interface GameState {
  match: Match
  chess: Chess
  knownMoveCount: number
  thinkingUntil?: number
  lastProgressAt: number
}

type ChessComputerState =
  | { kind: 'waiting'; nextGameAt: number }
  | { kind: 'searching' }
  | { kind: 'playing'; game: GameState }

export interface ChessComputerInit {
  username: string
  password: string
  avgGamesPerDay: number
  initialRating: number
}

export class ChessComputer {
  readonly username: string
  readonly avgGamesPerDay: number
  readonly targetRating: number
  readonly api = new ApiClient()
  private readonly password: string
  private lastSignInAt = 0
  private nextStandbyPoll = 0
  uid = ''
  elo = 1200
  wins = 0
  losses = 0
  draws = 0
  state: ChessComputerState = { kind: 'waiting', nextGameAt: 0 }

  constructor(init: ChessComputerInit) {
    this.username = init.username
    this.password = init.password
    this.avgGamesPerDay = init.avgGamesPerDay
    strengthSettings(init.initialRating)
    this.targetRating = init.initialRating
  }

  get playerId() {
    return this.api.playerId
  }

  async init(): Promise<void> {
    const profile = await this.api.signIn(this.username, this.password)
    this.lastSignInAt = Date.now()
    this.uid = profile.uid
    this.elo = profile.elo
    this.wins = profile.wins
    this.losses = profile.losses
    this.draws = profile.draws
    await this.api.join(TIME_CONTROL, true).catch(() => {})
    const wait = randRange(INITIAL_MIN_WAIT_MS, INITIAL_MAX_WAIT_MS)
    this.state = { kind: 'waiting', nextGameAt: Date.now() + wait }
    console.log(
      `[${this.username}] ready · elo ${this.elo} · strength target ${this.targetRating} · ~${this.avgGamesPerDay}/day · first game in ${(wait / 60000).toFixed(1)}m`
    )
  }

  async tick(now: number, allowScheduledGame = true): Promise<void> {
    try {
      if (this.state.kind === 'waiting') {
        if (allowScheduledGame && now >= this.state.nextGameAt) await this.joinQueue()
        else if (now >= this.nextStandbyPoll) {
          await this.refreshSession()
          const match = await this.api.join(TIME_CONTROL, false, true)
          this.nextStandbyPoll = Date.now() + 6000
          if (match) this.state = this.playing(match)
        }
      } else if (this.state.kind === 'searching') await this.checkMatch()
      else if (this.state.kind === 'playing') await this.advanceGame(now)
    } catch (err) {
      console.error(`[${this.username}] tick error`, err)
    }
  }

  private async refreshSession(): Promise<void> {
    if (Date.now() - this.lastSignInAt < 86400000) return
    const profile = await this.api.signIn(this.username, this.password)
    this.elo = profile.elo
    this.lastSignInAt = Date.now()
  }

  private async joinQueue(): Promise<void> {
    // Sessions expire; refresh before each new game instead of becoming a guest.
    const profile = await this.api.signIn(this.username, this.password)
    this.lastSignInAt = Date.now()
    this.elo = profile.elo
    console.log(`[${this.username}] joining pool @ ${TIME_CONTROL}`)
    const match = await this.api.join(TIME_CONTROL)
    this.state = match ? this.playing(match) : { kind: 'searching' }
  }

  private async checkMatch(): Promise<void> {
    const match = await this.api.join(TIME_CONTROL)
    if (match) this.state = this.playing(match)
  }

  private playing(match: Match): ChessComputerState {
    console.log(
      `[${this.username}] matched as ${match.myColor} vs ${match.opponentUsername ?? 'guest'} (elo ${match.opponentElo ?? '?'})`
    )
    return {
      kind: 'playing',
      game: { match, chess: new Chess(), knownMoveCount: 0, lastProgressAt: Date.now() },
    }
  }

  private applySnapshot(state: GameState, snapshot: ServerGame, now: number): void {
    const unseen = snapshot.moves.slice(state.knownMoveCount)
    for (const san of unseen) state.chess.move(san)
    if (unseen.length) state.lastProgressAt = now
    state.knownMoveCount = snapshot.moves.length
  }

  private async advanceGame(now: number): Promise<void> {
    if (this.state.kind !== 'playing') return
    const state = this.state.game
    if (now - state.lastProgressAt > GAME_STALL_MS) {
      console.warn(`[${this.username}] game ${state.match.gameId} stalled — resigning`)
      await this.api.resign(state.match)
      await this.finishGame('loss')
      return
    }

    const snapshot = await this.api.game(state.match)
    this.applySnapshot(state, snapshot, now)
    if (snapshot.result) {
      const outcome =
        snapshot.result.winner === null
          ? 'draw'
          : snapshot.result.winner === state.match.myColor
            ? 'win'
            : 'loss'
      await this.finishGame(outcome)
      return
    }
    const turn = state.chess.turn() === 'w' ? 'white' : 'black'
    if (turn !== state.match.myColor) return
    if (!state.thinkingUntil) {
      state.thinkingUntil = now + randRange(THINK_MIN_MS, THINK_MAX_MS)
      return
    }
    if (now < state.thinkingUntil) return

    const san = await pickRatedMove(state.chess.fen(), this.targetRating)
    if (!san) return
    const next = await this.api.move(state.match, san, state.knownMoveCount)
    this.applySnapshot(state, next, now)
    state.thinkingUntil = undefined
    console.log(`[${this.username}] played ${san}`)
    if (next.result) {
      const outcome =
        next.result.winner === null
          ? 'draw'
          : next.result.winner === state.match.myColor
            ? 'win'
            : 'loss'
      await this.finishGame(outcome)
    }
  }

  private async finishGame(outcome: 'win' | 'loss' | 'draw'): Promise<void> {
    if (this.state.kind !== 'playing') return
    await this.api.join(TIME_CONTROL, true)
    console.log(`[${this.username}] game ${this.state.game.match.gameId} → ${outcome}`)
    if (outcome === 'win') this.wins++
    else if (outcome === 'loss') this.losses++
    else this.draws++
    const wait = computeNextWaitMs(this.avgGamesPerDay)
    this.state = { kind: 'waiting', nextGameAt: Date.now() + wait }
    console.log(`[${this.username}] next game in ${(wait / 60000).toFixed(1)}m`)
  }

  async stop(): Promise<void> {
    if (this.state.kind === 'playing') await this.api.resign(this.state.game.match)
    await this.api.join(TIME_CONTROL, true)
  }
}
