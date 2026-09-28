import { useCallback, useEffect, useRef } from 'react'
import { GameAudio } from '../lib/gameAudio'

export function useGameSounds({
  enabled,
  sessionId,
  playing,
  moves,
  ownTime,
  ownClockActive,
}: {
  enabled: boolean
  sessionId: string
  playing: boolean
  moves: string[]
  ownTime: number
  ownClockActive: boolean
}) {
  const audio = useRef<GameAudio | null>(null)
  const previous = useRef({ sessionId, playing, count: moves.length })
  const warned = useRef<string | null>(null)
  const unlock = useCallback(() => {
    audio.current ??= new GameAudio()
    audio.current.unlock()
  }, [])

  useEffect(() => {
    if (!enabled) {
      audio.current?.close()
      return
    }
    // Browser audio requires a user gesture, including when restoring saved settings.
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [enabled, unlock])
  useEffect(() => () => audio.current?.close(), [])

  useEffect(() => {
    const before = previous.current
    previous.current = { sessionId, playing, count: moves.length }
    if (
      !enabled ||
      !before.playing ||
      before.sessionId !== sessionId ||
      moves.length <= before.count
    )
      return
    const san = moves.at(-1) || ''
    audio.current?.play(/[+#]/.test(san) ? 'check' : san.includes('x') ? 'capture' : 'move')
  }, [enabled, sessionId, playing, moves])

  useEffect(() => {
    if (
      !enabled ||
      !playing ||
      !ownClockActive ||
      ownTime <= 0 ||
      ownTime > 20000 ||
      warned.current === sessionId
    )
      return
    warned.current = sessionId
    audio.current?.play('low-time')
  }, [enabled, playing, ownClockActive, ownTime, sessionId])

  return unlock
}
