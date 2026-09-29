import { useState, useRef, useCallback, useEffect } from 'react'
import type { OnlineGame } from '../lib/gameRules'

import type { SpeedPairMatch } from '../lib/savedGame'
export type { SpeedPairMatch } from '../lib/savedGame'
export interface SpeedPairIdentity {
  username?: string
  elo?: number
}
export type ServerGame = Omit<OnlineGame, 'requests'> & {
  clocks: { whiteMs: number; blackMs: number }
  serverNow: number
  receivedAt: number
}
function playerCredentials() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('evalu_session_v3') || 'null')
    if (saved?.id && saved?.secret) return saved as { id: string; secret: string }
  } catch {
    /* create a new private session */
  }
  const value = { id: crypto.randomUUID(), secret: crypto.randomUUID() }
  sessionStorage.setItem('evalu_session_v3', JSON.stringify(value))
  return value
}
async function request(path: string, init?: RequestInit) {
  const signal = AbortSignal.timeout(10000)
  let response: Response
  let data
  try {
    response = await fetch(path, { ...init, signal })
    data = await response.json()
  } catch (error) {
    const name = (error as Error).name
    if (signal.aborted || name === 'AbortError' || name === 'TimeoutError')
      throw new Error('The connection timed out')
    if (error instanceof TypeError) throw new Error('Could not connect to the game server')
    throw error
  }
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Unable to reach the game server'), {
      status: response.status,
      retryAfterMs: Math.max(1000, Number(response.headers.get('Retry-After')) * 1000 || 10000),
    })
  return data
}
export function useSpeedPair() {
  const [credentials, setCredentials] = useState(playerCredentials)
  const [status, setStatus] = useState<'idle' | 'searching' | 'matched'>('idle')
  const [match, setMatch] = useState<SpeedPairMatch | null>(null)
  const [game, setGame] = useState<ServerGame | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [resigning, setResigning] = useState(false)
  const pendingResignation = useRef(false)
  const gameRef = useRef<ServerGame | null>(null)
  const pending = useRef<{ requestId: string; san: string; expectedPly: number } | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const accept = useCallback((next: ServerGame) => {
    if (
      gameRef.current?.id === next.id &&
      (next.version < gameRef.current.version || next.serverNow < gameRef.current.serverNow)
    )
      return
    const snapshot = { ...next, receivedAt: Date.now() }
    gameRef.current = snapshot
    const action = pending.current
    if (next.result || (action && next.moves[action.expectedPly] === action.san))
      pending.current = null
    if (next.result) {
      pendingResignation.current = false
      setError('')
    }
    setGame(snapshot)
  }, [])
  const matchHeaders = useCallback(
    (m: SpeedPairMatch) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${m.token}`,
    }),
    []
  )
  const resumeMatch = useCallback((m: SpeedPairMatch) => {
    generation.current++
    if (m.playerId && m.playerSecret) {
      const restored = { id: m.playerId, secret: m.playerSecret }
      setCredentials(restored)
      sessionStorage.setItem('evalu_session_v3', JSON.stringify(restored))
    }
    gameRef.current = null
    setGame(null)
    pending.current = null
    pendingResignation.current = false
    inFlight.current = false
    setSending(false)
    setResigning(false)
    setMatch(m)
    setStatus('matched')
    setError('')
  }, [])
  useEffect(() => {
    if (status !== 'matched' || !match) return
    const run = generation.current
    let stopped = false,
      timer: ReturnType<typeof setTimeout>
    let polling = false
    async function poll() {
      if (polling || stopped) return
      polling = true
      try {
        const data = await request(
          `/api/move?gameId=${encodeURIComponent(match!.gameId)}&playerId=${credentials.id}`,
          { headers: matchHeaders(match!) }
        )
        if (!stopped && generation.current === run) {
          accept(data.game)
          if (!pending.current && !pendingResignation.current) setError('')
        }
      } catch (e) {
        if (
          !stopped &&
          generation.current === run &&
          !gameRef.current?.result &&
          !pendingResignation.current
        )
          setError((e as Error).message)
      } finally {
        polling = false
      }
      if (!stopped && generation.current === run && !gameRef.current?.result)
        timer = setTimeout(poll, document.hidden ? 3000 : 750)
    }
    const wake = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void poll()
      }
    }
    void poll()
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [status, match, credentials.id, accept, matchHeaders])
  const joinPool = useCallback(
    async (tc: string, identity?: SpeedPairIdentity) => {
      const run = ++generation.current
      setStatus('searching')
      setMatch(null)
      pending.current = null
      setError('')
      setGame(null)
      gameRef.current = null
      let failures = 0
      while (generation.current === run) {
        let delay = 2000
        try {
          const data = await request('/api/join', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-player-secret': credentials.secret,
            },
            body: JSON.stringify({ id: credentials.id, tc, username: identity?.username }),
          })
          if (generation.current !== run) return
          if (data.matched) {
            resumeMatch({
              ...data.match,
              playerId: credentials.id,
              playerSecret: credentials.secret,
            })
            return
          }
          failures = 0
          setError('')
        } catch (e) {
          const failure = e as Error & { status?: number; retryAfterMs?: number }
          delay = Math.max(
            failure.status === 429 ? failure.retryAfterMs || 10000 : 0,
            Math.min(30000, 2000 * 2 ** Math.min(++failures, 4))
          )
          if (generation.current === run)
            setError(
              failure.status === 429
                ? 'Matchmaking is busy. Retrying automatically in a moment.'
                : `${failure.message}. Retrying matchmaking automatically.`
            )
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    },
    [credentials, resumeMatch]
  )
  const leavePool = useCallback(async () => {
    generation.current++
    try {
      await request('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-player-secret': credentials.secret },
        body: JSON.stringify({ id: credentials.id, leave: true }),
      })
      setStatus('idle')
      setMatch(null)
      setGame(null)
      gameRef.current = null
      pending.current = null
      setError('')
      return true
    } catch (e) {
      setError((e as Error).message)
      if ((e as Error & { status?: number }).status === 409) {
        try {
          const current = await request(`/api/status?id=${credentials.id}`, {
            headers: { 'x-player-secret': credentials.secret },
          })
          if (current.matched)
            resumeMatch({
              ...current.match,
              playerId: credentials.id,
              playerSecret: credentials.secret,
            })
        } catch {
          /* Keep the error visible for a user retry. */
        }
      }
      return false
    }
  }, [credentials, resumeMatch])
  const sendMove = useCallback(
    async (san: string) => {
      if (
        !match ||
        inFlight.current ||
        pendingResignation.current ||
        !gameRef.current ||
        gameRef.current.result
      )
        return
      const run = generation.current
      const action = pending.current || {
        san,
        expectedPly: gameRef.current.moves.length,
        requestId: crypto.randomUUID(),
      }
      pending.current = action
      inFlight.current = true
      setSending(true)
      setError('')
      try {
        const data = await request('/api/move', {
          method: 'POST',
          headers: matchHeaders(match),
          body: JSON.stringify({ ...action, gameId: match.gameId, playerId: credentials.id }),
        })
        if (run !== generation.current) return
        pending.current = null
        accept(data.game)
      } catch (e) {
        if (run !== generation.current || !pending.current || gameRef.current?.result) return
        const status = (e as Error & { status?: number }).status
        if (status && [400, 403, 409].includes(status)) {
          pending.current = null
          setError((e as Error).message)
        } else setError(`${(e as Error).message}. Retry to confirm your move.`)
      } finally {
        if (run === generation.current) {
          inFlight.current = false
          setSending(false)
        }
      }
    },
    [match, credentials.id, accept, matchHeaders]
  )
  const retryMove = useCallback(() => {
    if (pending.current) void sendMove(pending.current.san)
  }, [sendMove])
  const resignGame = useCallback(async () => {
    if (!match || inFlight.current) return false
    if (gameRef.current?.result) return true
    const run = generation.current
    inFlight.current = true
    pendingResignation.current = true
    pending.current = null
    setSending(true)
    setResigning(true)
    setError('')
    try {
      // A lost response can still mean the server accepted the resignation.
      // Read the result before retrying the idempotent action once.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await request('/api/move', {
            method: 'POST',
            headers: matchHeaders(match),
            body: JSON.stringify({ gameId: match.gameId, playerId: credentials.id, resign: true }),
          })
          if (run !== generation.current) return false
          accept(data.game)
          setError('')
          return true
        } catch (e) {
          if (run !== generation.current) return false
          if (gameRef.current?.result) {
            setError('')
            return true
          }
          const status = (e as Error & { status?: number }).status
          if (status && [400, 403].includes(status)) {
            pendingResignation.current = false
            setError((e as Error).message)
            return false
          }
          try {
            const data = await request(
              `/api/move?gameId=${encodeURIComponent(match.gameId)}&playerId=${credentials.id}`,
              { headers: matchHeaders(match) }
            )
            if (run !== generation.current) return false
            accept(data.game)
          } catch {
            // Keep the confirmed intent available for retry if the connection stays down.
          }
          if (run !== generation.current) return false
          if (gameRef.current?.result) {
            setError('')
            return true
          }
          if (status === 429) break
        }
      }
      setError('Could not confirm your resignation. Check your connection and retry.')
      return false
    } finally {
      if (run === generation.current) {
        inFlight.current = false
        setSending(false)
        setResigning(false)
      }
    }
  }, [match, credentials.id, accept, matchHeaders])
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  return {
    status,
    match,
    game,
    error,
    sending,
    resigning,
    canRetryResignation: pendingResignation.current && !gameRef.current?.result,
    joinPool,
    leavePool,
    resumeMatch,
    resignGame,
    sendMove,
    retryMove,
    canRetryMove: pending.current !== null,
  }
}
