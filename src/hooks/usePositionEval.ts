import { useRef, useCallback, useEffect } from 'react'

export interface LiveEval {
  score: number       // centipawns from white's perspective
  mate: number | null // mate in N (positive = white mating, negative = black mating)
  depth: number
}

export function usePositionEval(onEval: (ev: LiveEval) => void) {
  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)
  const pendingRef = useRef(false)
  const activeSideRef = useRef<'w' | 'b'>('w')
  const onEvalRef = useRef(onEval)
  onEvalRef.current = onEval

  useEffect(() => {
    const worker = new Worker('/stockfish.js')
    workerRef.current = worker

    worker.addEventListener('message', (e: MessageEvent) => {
      const line: string = e.data
      if (typeof line !== 'string') return

      if (line.includes('uciok')) {
        readyRef.current = true
        return
      }

      if (line.startsWith('info') && line.includes('score') && line.includes('depth')) {
        const depthMatch = line.match(/depth (\d+)/)
        const cpMatch = line.match(/score cp (-?\d+)/)
        const mateMatch = line.match(/score mate (-?\d+)/)
        if (!depthMatch) return

        const depth = parseInt(depthMatch[1])
        let score = 0
        let mate: number | null = null

        if (mateMatch) {
          mate = parseInt(mateMatch[1])
          score = mate > 0 ? 9999 : -9999
        } else if (cpMatch) {
          score = parseInt(cpMatch[1])
        }

        // Convert to white's absolute perspective
        const flip = activeSideRef.current === 'b' ? -1 : 1
        onEvalRef.current({ score: score * flip, mate: mate !== null ? mate * flip : null, depth })
      }

      if (line.startsWith('bestmove')) {
        pendingRef.current = false
      }
    })

    worker.postMessage('uci')

    return () => {
      worker.terminate()
    }
  }, [])

  const evaluate = useCallback((fen: string) => {
    const worker = workerRef.current
    if (!worker || !readyRef.current) return

    // Track whose turn it is so we can convert to white's perspective
    const activeColor = fen.split(' ')[1] // 'w' or 'b'
    activeSideRef.current = activeColor as 'w' | 'b'

    if (pendingRef.current) {
      worker.postMessage('stop')
    }
    pendingRef.current = true
    worker.postMessage('ucinewgame')
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage('go depth 16')
  }, [])

  const stop = useCallback(() => {
    if (workerRef.current && pendingRef.current) {
      workerRef.current.postMessage('stop')
      pendingRef.current = false
    }
  }, [])

  return { evaluate, stop }
}
