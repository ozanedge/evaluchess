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

  // Called when the active player makes a move — adds increment and switches clock.
  // When `remainingMs` is provided (authoritative time reported by the mover), the
  // mover's clock is reset to that value before the increment is applied.
  //
  // Do NOT clear the tick interval here: when two onMove calls happen in the same
  // sync block (opponent move + premove), the batched activeColor can end up equal
  // to its previous value, in which case the tick effect doesn't re-run and a
  // manual clearTick would leave the clock permanently frozen. Let the effect's
  // own cleanup/setup drive the interval lifecycle instead.
  const onMove = useCallback((colorWhoMoved: 'white' | 'black', remainingMs?: number) => {
    const inc = incrementSeconds * 1000
    if (colorWhoMoved === 'white') {
      if (remainingMs !== undefined) setTimeWhite(Math.max(0, remainingMs) + inc)
      else setTimeWhite((prev) => prev + inc)
      setActiveColor('black')
    } else {
      if (remainingMs !== undefined) setTimeBlack(Math.max(0, remainingMs) + inc)
      else setTimeBlack((prev) => prev + inc)
      setActiveColor('white')
    }
  }, [incrementSeconds])

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
