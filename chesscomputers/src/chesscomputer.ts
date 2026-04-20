import { Chess } from 'chess.js'
import { joinPool, pollMoves, sendMove, resignGame } from './api.js'
import { pickNoviceMove } from './engine.js'
import { db } from './firebase.js'
import {
  TIME_CONTROL,
  STARTING_CLOCK_MS,
  INITIAL_MIN_WAIT_MS,
  INITIAL_MAX_WAIT_MS,
  THINK_MIN_MS,
  THINK_MAX_MS,
  GAME_STALL_MS,
  computeNextWaitMs,
  randRange,
} from './config.js'

const K_FACTOR = 32
const GAME_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000

function expectedScore(my: number, opp: number): number {
  return 1 / (1 + Math.pow(10, (opp - my) / 400))
}

function newRating(my: number, opp: number, outcome: 'win' | 'loss' | 'draw'): number {
  const s = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
  return Math.round(my + K_FACTOR * (s - expectedScore(my, opp)))
}

interface GameState {
  gameId: string
  myColor: 'white' | 'black'
  token: string
  opponentUid?: string
  opponentElo?: number
  chess: Chess
  knownMoveCount: number // total moves in game we've already applied
  myClockMs: number
  lastClockAnchorAt: number
  thinkingUntil?: number // when we're allowed to play our move
  startedAt: number
  lastProgressAt: number
}

type ChessComputerState =
  | { kind: 'waiting'; nextGameAt: number }
  | { kind: 'searching' }
  | { kind: 'playing'; game: GameState }

export interface ChessComputerInit {
  uid: string
  username: string
  avgGamesPerDay: number
}

export class ChessComputer {
  readonly uid: string
  readonly username: string
  readonly avgGamesPerDay: number
  readonly playerId: string
  elo = 1300
  wins = 0
  losses = 0
  draws = 0
  state: ChessComputerState = { kind: 'waiting', nextGameAt: 0 }

  constructor(init: ChessComputerInit) {
    this.uid = init.uid
    this.username = init.username
    this.avgGamesPerDay = init.avgGamesPerDay
    this.playerId = `cc_${init.uid}`
  }

  async init(): Promise<void> {
    const snap = await db().ref(`users/${this.uid}`).get()
    const v = snap.val() as { elo?: number; wins?: number; losses?: number; draws?: number } | null
    if (v) {
      this.elo = typeof v.elo === 'number' ? v.elo : this.elo
      this.wins = v.wins ?? 0
      this.losses = v.losses ?? 0
      this.draws = v.draws ?? 0
    }
    // On startup, clear any stale match record so we don't accidentally resume a dead game.
    try {
      await joinPool({ id: this.playerId, tc: TIME_CONTROL, leave: true })
    } catch { /* ignore */ }
    const wait = randRange(INITIAL_MIN_WAIT_MS, INITIAL_MAX_WAIT_MS)
    this.state = { kind: 'waiting', nextGameAt: Date.now() + wait }
    console.log(
      `[${this.username}] ready · elo ${this.elo} · ~${this.avgGamesPerDay}/day · first game in ${(wait / 60000).toFixed(1)}m`,
    )
  }

  async tick(now: number): Promise<void> {
    try {
      if (this.state.kind === 'waiting') {
        if (now >= this.state.nextGameAt) await this.joinQueue()
        return
      }
      if (this.state.kind === 'searching') {
        await this.checkMatch()
        return
      }
      if (this.state.kind === 'playing') {
        await this.advanceGame(now)
      }
    } catch (err) {
      console.error(`[${this.username}] tick error`, err)
    }
  }

  private async joinQueue(): Promise<void> {
    console.log(`[${this.username}] joining pool @ ${TIME_CONTROL} · elo ${this.elo}`)
    await joinPool({
      id: this.playerId,
      tc: TIME_CONTROL,
      uid: this.uid,
      username: this.username,
      elo: this.elo,
    })
    this.state = { kind: 'searching' }
  }

  private async checkMatch(): Promise<void> {
    const data = await joinPool({
      id: this.playerId,
      tc: TIME_CONTROL,
      uid: this.uid,
      username: this.username,
      elo: this.elo,
    })
    if (!data.matched || !data.gameId || !data.token || !data.myColor) return
    if (data.opponentUid && data.opponentUid === this.uid) {
      // Shouldn't happen, but guard against self-match.
      return
    }
    console.log(
      `[${this.username}] matched as ${data.myColor} vs ${data.opponentUsername ?? 'guest'} (elo ${data.opponentElo ?? '?'})`,
    )
    const now = Date.now()
    this.state = {
      kind: 'playing',
      game: {
        gameId: data.gameId,
        myColor: data.myColor,
        token: data.token,
        opponentUid: data.opponentUid,
        opponentElo: data.opponentElo,
        chess: new Chess(),
        knownMoveCount: 0,
        myClockMs: STARTING_CLOCK_MS,
        lastClockAnchorAt: now,
        startedAt: now,
        lastProgressAt: now,
      },
    }
  }

  private async advanceGame(now: number): Promise<void> {
    if (this.state.kind !== 'playing') return
    const g = this.state.game

    // Safety valve: game has been stuck with no progress for GAME_STALL_MS. Resign.
    if (now - g.lastProgressAt > GAME_STALL_MS) {
      console.warn(`[${this.username}] game ${g.gameId} stalled — resigning`)
      await resignGame(g.gameId, this.playerId, g.token).catch(() => {})
      await this.finishGame('loss')
      return
    }

    const resp = await pollMoves(g.gameId, g.knownMoveCount, this.playerId)
    if (resp.resigned) {
      await this.finishGame('win')
      return
    }

    if (resp.moves.length > 0) {
      let needFinish: 'win' | 'loss' | 'draw' | null = null
      for (let i = 0; i < resp.moves.length; i++) {
        const globalIdx = g.knownMoveCount + i
        const isWhiteTurn = globalIdx % 2 === 0
        const isMyMove = (isWhiteTurn && g.myColor === 'white') || (!isWhiteTurn && g.myColor === 'black')
        try {
          g.chess.move(resp.moves[i].san)
        } catch {
          console.error(`[${this.username}] illegal move in stream: ${resp.moves[i].san}`)
          needFinish = 'loss'
          break
        }
        if (!isMyMove) g.lastProgressAt = now
      }
      g.knownMoveCount += resp.moves.length
      if (needFinish) {
        await this.finishGame(needFinish)
        return
      }
    }

    if (g.chess.isCheckmate()) {
      const loser = g.chess.turn() === 'w' ? 'white' : 'black'
      await this.finishGame(loser === g.myColor ? 'loss' : 'win')
      return
    }
    if (g.chess.isStalemate() || g.chess.isInsufficientMaterial() || g.chess.isThreefoldRepetition() || g.chess.isDraw()) {
      await this.finishGame('draw')
      return
    }

    const turnColor: 'white' | 'black' = g.chess.turn() === 'w' ? 'white' : 'black'
    if (turnColor !== g.myColor) return

    if (!g.thinkingUntil) {
      g.thinkingUntil = now + randRange(THINK_MIN_MS, THINK_MAX_MS)
      return
    }
    if (now < g.thinkingUntil) return

    const elapsed = now - g.lastClockAnchorAt
    const remainingAfterMove = Math.max(0, g.myClockMs - elapsed)
    if (remainingAfterMove <= 0) {
      console.log(`[${this.username}] flagged on time`)
      await this.finishGame('loss')
      return
    }

    const san = pickNoviceMove(g.chess.fen())
    if (!san) {
      await this.finishGame('draw')
      return
    }
    try {
      g.chess.move(san)
    } catch (err) {
      console.error(`[${this.username}] engine picked illegal ${san}`, err)
      await this.finishGame('loss')
      return
    }
    g.myClockMs = remainingAfterMove
    g.lastClockAnchorAt = now
    g.thinkingUntil = undefined
    try {
      await sendMove(g.gameId, san, this.playerId, g.token, g.myClockMs)
    } catch (err) {
      console.error(`[${this.username}] sendMove failed`, err)
      return
    }
    g.knownMoveCount += 1
    g.lastProgressAt = now
    console.log(`[${this.username}] played ${san} (${Math.round(g.myClockMs / 1000)}s left)`)

    if (g.chess.isCheckmate()) {
      await this.finishGame('win')
    }
  }

  private async finishGame(outcome: 'win' | 'loss' | 'draw'): Promise<void> {
    if (this.state.kind !== 'playing') return
    const g = this.state.game
    console.log(`[${this.username}] game ${g.gameId} → ${outcome}`)
    await this.applyResult(g, outcome).catch((err) => console.error(`[${this.username}] apply failed`, err))
    const wait = computeNextWaitMs(this.avgGamesPerDay)
    this.state = { kind: 'waiting', nextGameAt: Date.now() + wait }
    console.log(`[${this.username}] next game in ${(wait / 60000).toFixed(1)}m (target ${this.avgGamesPerDay}/day)`)
  }

  private async applyResult(g: GameState, outcome: 'win' | 'loss' | 'draw'): Promise<void> {
    const oppElo = typeof g.opponentElo === 'number' ? g.opponentElo : 1200
    const nextElo = newRating(this.elo, oppElo, outcome)
    const profileRef = db().ref(`users/${this.uid}`)
    await profileRef.transaction((current) => {
      if (!current) return current
      const c = current as { elo?: number; wins?: number; losses?: number; draws?: number; gamesPlayed?: number }
      return {
        ...c,
        elo: nextElo,
        wins: (c.wins ?? 0) + (outcome === 'win' ? 1 : 0),
        losses: (c.losses ?? 0) + (outcome === 'loss' ? 1 : 0),
        draws: (c.draws ?? 0) + (outcome === 'draw' ? 1 : 0),
        gamesPlayed: (c.gamesPlayed ?? 0) + 1,
      }
    })
    this.elo = nextElo
    if (outcome === 'win') this.wins++
    else if (outcome === 'loss') this.losses++
    else this.draws++

    // Feed the 24h leaderboard. Prune this account's stale events in the same write.
    try {
      const eventsRef = db().ref(`gameEvents/${this.uid}`)
      const snap = await eventsRef.get()
      const now = Date.now()
      const cutoff = now - GAME_EVENT_WINDOW_MS
      const updates: Record<string, unknown> = {}
      snap.forEach((child) => {
        const v = child.val() as { at?: number } | null
        if (v?.at && v.at < cutoff) updates[child.key!] = null
      })
      const newKey = eventsRef.push().key!
      updates[newKey] = { o: outcome, at: now }
      await eventsRef.update(updates)
    } catch (err) {
      console.error(`[${this.username}] failed to record game event`, err)
    }
  }
}
