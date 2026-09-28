import { useRef, useCallback, useEffect } from 'react'
import { Engine } from '../lib/engine'
export function useComputerMove() {
  const engine = useRef<Engine | null>(null)
  const cancel = useCallback(() => {
    engine.current?.cancel()
    engine.current = null
  }, [])
  const getMove = useCallback(async (fen: string, elo: number) => {
    if (!engine.current) engine.current = new Engine()
    const result = await engine.current.evaluate(fen, { elo, movetime: 800, depth: 18 })
    if (!result.bestMove) throw new Error('Computer could not choose a move. Please retry.')
    return result.bestMove
  }, [])
  useEffect(() => cancel, [cancel])
  return { getMove, cancel }
}
