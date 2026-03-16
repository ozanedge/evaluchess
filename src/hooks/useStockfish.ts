import { useRef, useCallback } from 'react'

export interface PositionEval {
  score: number // centipawns (positive = white advantage)
  mate: number | null
  bestMove: string | null // UCI format e.g. "e2e4"
}

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)

  const getWorker = useCallback((): Promise<Worker> => {
    if (workerRef.current && readyRef.current) {
      return Promise.resolve(workerRef.current)
    }

    return new Promise((resolve) => {
      const worker = new Worker('/stockfish.js')
      workerRef.current = worker

      const onReady = (e: MessageEvent) => {
        if (typeof e.data === 'string' && e.data.includes('uciok')) {
          readyRef.current = true
          worker.removeEventListener('message', onReady)
          resolve(worker)
        }
      }
      worker.addEventListener('message', onReady)
      worker.postMessage('uci')
    })
  }, [])

  const evaluatePosition = useCallback(async (fen: string, depth = 14): Promise<PositionEval> => {
    const worker = await getWorker()

    return new Promise((resolve) => {
      let lastScore = 0
      let lastMate: number | null = null

      const handler = (e: MessageEvent) => {
        const line: string = e.data
        if (typeof line !== 'string') return

        if (line.startsWith('info') && line.includes('score')) {
          const mateMatch = line.match(/score mate (-?\d+)/)
          const cpMatch = line.match(/score cp (-?\d+)/)
          if (mateMatch) {
            lastMate = parseInt(mateMatch[1])
            lastScore = lastMate > 0 ? 9999 : -9999
          } else if (cpMatch) {
            lastScore = parseInt(cpMatch[1])
            lastMate = null
          }
        }

        if (line.startsWith('bestmove')) {
          worker.removeEventListener('message', handler)
          const parts = line.split(' ')
          const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null
          resolve({ score: lastScore, mate: lastMate, bestMove })
        }
      }

      worker.addEventListener('message', handler)
      worker.postMessage('ucinewgame')
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage(`go depth ${depth}`)
    })
  }, [getWorker])

  const analyzeGame = useCallback(async (
    positions: string[],
    onProgress: (current: number, total: number) => void
  ): Promise<PositionEval[]> => {
    const evals: PositionEval[] = []
    for (let i = 0; i < positions.length; i++) {
      onProgress(i + 1, positions.length)
      const ev = await evaluatePosition(positions[i], 14)
      evals.push(ev)
    }
    return evals
  }, [evaluatePosition])

  const destroy = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    readyRef.current = false
  }, [])

  return { analyzeGame, destroy }
}
