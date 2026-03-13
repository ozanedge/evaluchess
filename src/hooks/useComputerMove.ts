import { useRef, useCallback, useEffect } from 'react'

export function useComputerMove() {
  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)

  useEffect(() => {
    const worker = new Worker('/stockfish.js')
    workerRef.current = worker

    worker.addEventListener('message', (e: MessageEvent) => {
      const line: string = e.data
      if (typeof line !== 'string') return
      if (line.includes('uciok')) {
        // ~1200 Elo strength
        worker.postMessage('setoption name UCI_LimitStrength value true')
        worker.postMessage('setoption name UCI_Elo value 1200')
        readyRef.current = true
      }
    })

    worker.postMessage('uci')
    return () => worker.terminate()
  }, [])

  const getMove = useCallback((fen: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current
      if (!worker || !readyRef.current) return reject('not ready')

      const handler = (e: MessageEvent) => {
        const line: string = e.data
        if (typeof line !== 'string') return
        if (line.startsWith('bestmove')) {
          worker.removeEventListener('message', handler)
          const move = line.split(' ')[1]
          if (move && move !== '(none)') resolve(move)
          else reject('no move')
        }
      }

      worker.addEventListener('message', handler)
      worker.postMessage('ucinewgame')
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage('go movetime 800')
    })
  }, [])

  return { getMove }
}
