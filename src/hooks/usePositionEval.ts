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
  // Counts how many "stop" commands are in-flight waiting for their bestmove ACK.
  // info messages are ignored while this is > 0 to prevent stale results from
  // a previous search bleeding into the current one.
  const ignoreCountRef = useRef(0)
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

      if (line.startsWith('bestmove')) {
        if (ignoreCountRef.current > 0) {
          // This bestmove acknowledges a stop we issued. Decrement the counter
          // but keep pendingRef = true since a new search is already running.
          ignoreCountRef.current -= 1
        } else {
          pendingRef.current = false
        }
        return
      }

      if (line.startsWith('info') && line.includes('score') && line.includes('depth')) {
        // Ignore info from a search we've already stopped
        if (ignoreCountRef.current > 0) return

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
      // Stop the running search; its bestmove ACK will decrement ignoreCountRef
      worker.postMessage('stop')
      ignoreCountRef.current += 1
    }
    pendingRef.current = true
    worker.postMessage('ucinewgame')
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage('go depth 16')
  }, [])

  const stop = useCallback(() => {
    if (workerRef.current && pendingRef.current) {
      workerRef.current.postMessage('stop')
      ignoreCountRef.current += 1
      pendingRef.current = false
    }
  }, [])

  return { evaluate, stop }
}
