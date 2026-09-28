import { useRef, useCallback, useEffect } from 'react'
import { Engine } from '../lib/engine'
import type { PositionEval } from '../lib/engine'
export type { PositionEval } from '../lib/engine'
export function useStockfish() {
  const engine = useRef<Engine | null>(null)
  const generation = useRef(0)
  const destroy = useCallback(() => {
    generation.current++
    engine.current?.cancel()
    engine.current = null
  }, [])
  const evaluatePosition = useCallback((fen: string) => {
    if (!engine.current) engine.current = new Engine()
    return engine.current.evaluate(fen)
  }, [])
  const analyzeGame = useCallback(
    async (
      positions: string[],
      progress: (current: number, total: number) => void
    ): Promise<PositionEval[]> => {
      const run = generation.current
      const results: PositionEval[] = []
      for (const fen of positions) {
        if (run !== generation.current) throw new DOMException('Analysis cancelled', 'AbortError')
        results.push(await evaluatePosition(fen))
        progress(results.length, positions.length)
      }
      return results
    },
    [evaluatePosition]
  )
  useEffect(() => destroy, [destroy])
  return { analyzeGame, evaluatePosition, destroy }
}
