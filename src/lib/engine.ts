export interface PositionEval {
  score: number // UCI score from the side to move, not always White.
  mate: number | null
  bestMove: string | null
  pv?: string[]
}
export class EngineCancelled extends Error {
  constructor() {
    super('Analysis cancelled')
    this.name = 'AbortError'
  }
}
export class Engine {
  private worker: Worker | null = null
  private ready: Promise<Worker> | null = null
  private rejectPending: ((error: Error) => void) | null = null
  private busy = false
  private cache = new Map<string, PositionEval>()
  private createWorker: () => Worker
  private timeoutMs: number
  constructor(createWorker: () => Worker = () => new Worker('/stockfish.js'), timeoutMs = 15000) {
    this.createWorker = createWorker
    this.timeoutMs = timeoutMs
  }
  cancel() {
    const reject = this.rejectPending
    this.rejectPending = null
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    reject?.(new EngineCancelled())
  }
  private start(): Promise<Worker> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      const worker = this.createWorker()
      this.worker = worker
      const cleanup = () => {
        clearTimeout(timer)
        worker.removeEventListener('message', message)
        worker.removeEventListener('error', error)
        this.rejectPending = null
      }
      const fail = (e: Error) => {
        cleanup()
        worker.terminate()
        this.worker = null
        this.ready = null
        reject(e)
      }
      const timer = setTimeout(
        () => fail(new Error('Stockfish took too long to load. Retry analysis.')),
        this.timeoutMs
      )
      const error = (event: ErrorEvent) => {
        event.preventDefault()
        fail(new Error('Stockfish could not load. Check your connection and retry.'))
      }
      const message = (event: MessageEvent) => {
        if (event.data === 'uciok') worker.postMessage('isready')
        if (event.data === 'readyok') {
          cleanup()
          resolve(worker)
        }
      }
      this.rejectPending = fail
      worker.addEventListener('message', message)
      worker.addEventListener('error', error)
      worker.postMessage('uci')
    })
    return this.ready
  }
  async evaluate(
    fen: string,
    options: { depth?: number; elo?: number; movetime?: number } = {}
  ): Promise<PositionEval> {
    if (this.busy) throw new Error('Engine is already analyzing a position')
    const depth = options.depth ?? 14
    const key = `${fen}|${depth}`
    if (!options.elo && this.cache.has(key)) return this.cache.get(key)!
    this.busy = true
    try {
      const worker = await this.start()
      const result = await new Promise<PositionEval>((resolve, reject) => {
        let score: number | null = null,
          mate: number | null = null,
          pv: string[] = []
        const cleanup = () => {
          clearTimeout(timer)
          worker.removeEventListener('message', message)
          worker.removeEventListener('error', error)
          this.rejectPending = null
        }
        const fail = (e: Error) => {
          cleanup()
          worker.terminate()
          this.worker = null
          this.ready = null
          reject(e)
        }
        const timer = setTimeout(
          () =>
            fail(new Error('Stockfish stopped responding. Your game is saved; retry analysis.')),
          this.timeoutMs
        )
        const error = (event: ErrorEvent) => {
          event.preventDefault()
          fail(new Error('Stockfish encountered an error. Retry analysis.'))
        }
        const message = (event: MessageEvent) => {
          if (typeof event.data !== 'string') return
          const line = event.data
          if (line.startsWith('info ') && !/\b(lowerbound|upperbound)\b/.test(line)) {
            const cp = line.match(/score cp (-?\d+)/),
              m = line.match(/score mate (-?\d+)/)
            if (cp) {
              score = Number(cp[1])
              mate = null
            }
            if (m) {
              mate = Number(m[1])
              score = mate > 0 ? 9999 : -9999
            }
            const variation = line.match(/\bpv (.+)/)
            if (variation) pv = variation[1].trim().split(/\s+/)
          }
          if (line.startsWith('bestmove ')) {
            cleanup()
            const bestMove = line.split(' ')[1]
            if (score === null && bestMove !== '(none)' && bestMove !== '0000') {
              fail(new Error('Stockfish returned no evaluation. Retry analysis.'))
              return
            }
            resolve({
              score: score ?? 0,
              mate,
              bestMove: ['(none)', '0000'].includes(bestMove) ? null : bestMove,
              pv,
            })
          }
        }
        this.rejectPending = fail
        worker.addEventListener('message', message)
        worker.addEventListener('error', error)
        worker.postMessage(`setoption name UCI_LimitStrength value ${!!options.elo}`)
        if (options.elo) worker.postMessage(`setoption name UCI_Elo value ${options.elo}`)
        worker.postMessage(`position fen ${fen}`)
        worker.postMessage(`go depth ${depth} movetime ${options.movetime ?? 1200}`)
      })
      if (!options.elo) {
        if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!)
        this.cache.set(key, result)
      }
      return result
    } catch (error) {
      this.cancel()
      throw error
    } finally {
      this.busy = false
    }
  }
}
