import { useState, useEffect, useRef, useCallback } from 'react'

export interface ClockState {
  timeWhite: number  // milliseconds
  timeBlack: number
  activeColor: 'white' | 'black' | null
  flagged: 'white' | 'black' | null
}

export function useChessClock(initialSeconds: number, incrementSeconds: number) {
  const [timeWhite, setTimeWhite] = useState(initialSeconds * 1000)
  const [timeBlack, setTimeBlack] = useState(initialSeconds * 1000)
  const [activeColor, setActiveColor] = useState<'white' | 'black' | null>(null)
  const [flagged, setFlagged] = useState<'white' | 'black' | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTickRef = useRef<number>(0)

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Tick the active player's clock down
  useEffect(() => {
    if (!activeColor || flagged) {
      clearTick()
      return
    }

    lastTickRef.current = Date.now()

    intervalRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTickRef.current
      lastTickRef.current = now

      if (activeColor === 'white') {
        setTimeWhite((prev) => {
          const next = Math.max(0, prev - elapsed)
          if (next === 0) setFlagged('white')
          return next
        })
      } else {
        setTimeBlack((prev) => {
          const next = Math.max(0, prev - elapsed)
          if (next === 0) setFlagged('black')
          return next
        })
      }
    }, 100)

    return clearTick
  }, [activeColor, flagged, clearTick])

  // Called when the active player makes a move — adds increment and switches clock
  const onMove = useCallback((colorWhoMoved: 'white' | 'black') => {
    clearTick()
    const inc = incrementSeconds * 1000
    if (colorWhoMoved === 'white') {
      setTimeWhite((prev) => prev + inc)
      setActiveColor('black')
    } else {
      setTimeBlack((prev) => prev + inc)
      setActiveColor('white')
    }
  }, [incrementSeconds, clearTick])

  // Start white's clock (call at game start)
  const start = useCallback(() => {
    setActiveColor('white')
  }, [])

  const stop = useCallback(() => {
    clearTick()
    setActiveColor(null)
  }, [clearTick])

  const reset = useCallback((newInitialSeconds?: number) => {
    clearTick()
    const ms = (newInitialSeconds ?? initialSeconds) * 1000
    setTimeWhite(ms)
    setTimeBlack(ms)
    setActiveColor(null)
    setFlagged(null)
  }, [clearTick, initialSeconds])

  return { timeWhite, timeBlack, activeColor, flagged, onMove, start, stop, reset }
}
