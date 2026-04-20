import { useRef, useCallback, useEffect } from 'react'

export interface LiveEval {
  score: number       // centipawns from white's perspective
  mate: number | null // mate in N (positive = white mating, negative = black mating)
  depth: number
}

export function usePositionEval(onEval: (ev: LiveEval) => void) {
  const workerRef    = useRef<Worker | null>(null)
  const readyRef     = useRef(false)
  const onEvalRef    = useRef(onEval)
  onEvalRef.current  = onEval

  // True while a 'go' search is actively running.
  const searchRunningRef = useRef(false)
  // True after we send 'stop', until we receive the bestmove that acks it.
  // All info messages are ignored in this window.
  const waitingStopRef   = useRef(false)
  // FEN to evaluate once the current stop is acked (only the latest matters).
  const pendingFenRef    = useRef<string | null>(null)
  // Side to move for the active search (used for perspective flip).
  const activeSideRef    = useRef<'w' | 'b'>('w')
  // Ref-wrapped helper so both useEffect and evaluate can call it.
  const startSearchRef   = useRef<(fen: string) => void>(() => {})

  useEffect(() => {
    const worker = new Worker('/stockfish.js')
    workerRef.current = worker

    startSearchRef.current = (fen: string) => {
      activeSideRef.current  = fen.split(' ')[1] as 'w' | 'b'
      searchRunningRef.current = true
      worker.postMessage('ucinewgame')
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage('go depth 16')
    }

    worker.addEventListener('message', (e: MessageEvent) => {
      const line: string = e.data
      if (typeof line !== 'string') return

      if (line.includes('uciok')) {
        readyRef.current = true
        return
      }

      if (line.startsWith('bestmove')) {
        // This bestmove either acks our stop or ends a natural search.
        searchRunningRef.current = false
        waitingStopRef.current   = false
        // Start the queued search if one is waiting.
        const pending = pendingFenRef.current
        if (pending !== null) {
          pendingFenRef.current = null
          startSearchRef.current(pending)
        }
        return
      }

      if (line.startsWith('info') && line.includes('score') && line.includes('depth')) {
        // Drop results from a search we've already stopped.
        if (waitingStopRef.current) return

        const depthMatch = line.match(/depth (\d+)/)
        const cpMatch    = line.match(/score cp (-?\d+)/)
        const mateMatch  = line.match(/score mate (-?\d+)/)
        if (!depthMatch) return

        const depth = parseInt(depthMatch[1])
        let score = 0
        let mate: number | null = null

        if (mateMatch) {
          mate  = parseInt(mateMatch[1])
          score = mate > 0 ? 9999 : -9999
        } else if (cpMatch) {
          score = parseInt(cpMatch[1])
        }

        const flip = activeSideRef.current === 'b' ? -1 : 1
        onEvalRef.current({
          score: score * flip,
          mate:  mate !== null ? mate * flip : null,
          depth,
        })
      }
    })

    worker.postMessage('uci')
    return () => worker.terminate()
  }, [])

  const evaluate = useCallback((fen: string) => {
    const worker = workerRef.current
    if (!worker || !readyRef.current) return

    if (searchRunningRef.current) {
      // Stop the running search; startSearch will fire when bestmove arrives.
      worker.postMessage('stop')
      waitingStopRef.current   = true
      searchRunningRef.current = false
      pendingFenRef.current    = fen
    } else if (waitingStopRef.current) {
      // Already stopping — just update the queued fen.
      pendingFenRef.current = fen
    } else {
      // No search running, start immediately.
      startSearchRef.current(fen)
    }
  }, [])

  const stop = useCallback(() => {
    const worker = workerRef.current
    if (!worker) return
    if (searchRunningRef.current) {
      worker.postMessage('stop')
      waitingStopRef.current   = true
      searchRunningRef.current = false
    }
    pendingFenRef.current = null
  }, [])

  return { evaluate, stop }
}
