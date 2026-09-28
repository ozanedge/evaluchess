import { Chess } from 'chess.js'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Below Stockfish's native floor, add mistakes rather than clamp all bots to 1320.
 * These are approximate strength targets, not calibrated human Elo ratings. */
export function strengthSettings(targetRating: number) {
  if (!Number.isFinite(targetRating) || targetRating < 400 || targetRating > 1600)
    throw new Error('Bot strength must be between 400 and 1600')
  return {
    engineElo: Math.max(1320, Math.round(targetRating)),
    randomMoveChance: Math.max(0, (1320 - targetRating) / 920) * 0.6,
  }
}

interface Pending {
  accept: (line: string) => boolean
  resolve: (line: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// One engine, serialized searches: concurrent bots cannot overwrite each other's
// positions or strength settings. The child process keeps heartbeats responsive.
export class RatedEngine {
  private child?: ChildProcessWithoutNullStreams
  private pending?: Pending
  private queue: Promise<void> = Promise.resolve()
  private closed = false
  private readonly enginePath: string
  private readonly timeoutMs: number

  constructor(options: { enginePath?: string; timeoutMs?: number } = {}) {
    this.enginePath = options.enginePath ?? require.resolve('stockfish/bin/stockfish-18-single.js')
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  pickMove(fen: string, targetRating: number, random = Math.random): Promise<string | null> {
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error('Bot engine is closed')
      const settings = strengthSettings(targetRating)
      const chess = new Chess(fen)
      const moves = chess.moves()
      if (chess.isGameOver() || !moves.length) return null
      if (random() < settings.randomMoveChance)
        return moves[Math.min(moves.length - 1, Math.floor(random() * moves.length))]

      await this.start()
      await this.exchange(
        [
          'ucinewgame',
          'setoption name UCI_LimitStrength value true',
          `setoption name UCI_Elo value ${settings.engineElo}`,
          'isready',
        ],
        (line) => line === 'readyok'
      )
      const result = await this.exchange(
        [`position fen ${chess.fen()}`, 'go movetime 250'],
        (line) => line.startsWith('bestmove ')
      )
      const uci = result.split(/\s+/)[1]
      try {
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid UCI move')
        return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
      } catch {
        this.fail(new Error('Bot engine returned an illegal move'))
        throw new Error('Bot engine returned an illegal move')
      }
    })
    this.queue = task.then(
      () => {},
      () => {}
    )
    return task
  }

  private async start() {
    if (this.child) return
    const child = spawn(process.execPath, [this.enginePath], { stdio: 'pipe' })
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (this.pending?.accept(line)) {
          const pending = this.pending
          this.pending = undefined
          clearTimeout(pending.timer)
          pending.resolve(line)
        }
      }
    })
    // Drain stderr without forwarding potentially noisy engine diagnostics.
    child.stderr.resume()
    child.on('error', () => {
      if (this.child === child) this.fail(new Error('Bot engine failed to start'))
    })
    child.on('exit', () => {
      if (this.child === child) this.fail(new Error('Bot engine exited'))
    })
    child.stdin.on('error', () => {
      if (this.child === child) this.fail(new Error('Bot engine input failed'))
    })
    await this.exchange(['uci'], (line) => line === 'uciok')
    await this.exchange(['setoption name Hash value 16', 'isready'], (line) => line === 'readyok')
  }

  private exchange(commands: string[], accept: Pending['accept']): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.pending) return reject(new Error('Bot engine is unavailable'))
      const timer = setTimeout(() => this.fail(new Error('Bot engine timed out')), this.timeoutMs)
      this.pending = { accept, resolve, reject, timer }
      this.child.stdin.write(commands.join('\n') + '\n')
    })
  }

  private fail(error: Error) {
    const pending = this.pending
    this.pending = undefined
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    const child = this.child
    this.child = undefined
    child?.kill('SIGKILL')
  }

  async close() {
    this.closed = true
    await this.queue
    this.fail(new Error('Bot engine closed'))
  }
}

let shared: RatedEngine | undefined
export const pickRatedMove = (fen: string, rating: number) =>
  (shared ??= new RatedEngine()).pickMove(fen, rating)
export const closeBotEngine = async () => {
  await shared?.close()
  shared = undefined
}
