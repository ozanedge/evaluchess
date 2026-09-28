import { useRef, useCallback, useEffect, useState } from 'react'
import { Engine } from '../lib/engine'
import { moveFeedback } from '../utils/moveFeedback'
import type { MoveFeedback } from '../utils/moveFeedback'
export interface LiveEval {
  score: number
  mate: number | null
  depth: number
  fen?: string
  feedback?: MoveFeedback | null
}
interface PositionRequest {
  fen: string
  previous?: { fen: string; move: string; onFeedback?: (feedback: MoveFeedback) => void }
}
export function usePositionEval(onEval: (ev: LiveEval) => void) {
  const onEvalRef = useRef(onEval)
  const engine = useRef<Engine | null>(null)
  const pending = useRef<PositionRequest[]>([])
  const running = useRef(false)
  const generation = useRef(0)
  const [error, setError] = useState('')
  useEffect(() => {
    onEvalRef.current = onEval
  }, [onEval])
  const stop = useCallback(() => {
    generation.current++
    pending.current = []
    running.current = false
    engine.current?.cancel()
    engine.current = null
  }, [])
  const evaluate = useCallback(async (fen: string, previous?: PositionRequest['previous']) => {
    // Keep the latest own-move analysis when a newer board position arrives.
    pending.current = pending.current.filter((p) => p.previous?.onFeedback && !previous?.onFeedback)
    pending.current.push({ fen, previous })
    if (running.current) return
    running.current = true
    const run = generation.current
    try {
      while (pending.current.length && run === generation.current) {
        const position = pending.current.shift()!
        if (!engine.current) engine.current = new Engine()
        const before = position.previous
          ? await engine.current.evaluate(position.previous.fen, { depth: 16, movetime: 400 })
          : null
        if (run !== generation.current) return
        if (pending.current.length && !position.previous?.onFeedback) continue
        const ev = await engine.current.evaluate(position.fen, { depth: 16, movetime: 400 })
        if (run !== generation.current) return
        const feedback =
          before && position.previous
            ? moveFeedback(position.previous.fen, position.fen, position.previous.move, before, ev)
            : null
        if (feedback) position.previous?.onFeedback?.(feedback)
        if (pending.current.length) continue
        const sign = position.fen.split(' ')[1] === 'b' ? -1 : 1
        onEvalRef.current({
          score: ev.score * sign,
          mate: ev.mate === null ? null : ev.mate * sign,
          depth: 16,
          fen: position.fen,
          feedback,
        })
        setError('')
      }
    } catch (e) {
      if (run === generation.current) {
        setError((e as Error).message)
        engine.current = null
      }
    } finally {
      if (run === generation.current) running.current = false
    }
  }, [])
  useEffect(() => stop, [stop])
  return { evaluate, stop, error }
}
