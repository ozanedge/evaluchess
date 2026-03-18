import { useState, useRef, useCallback, useEffect } from 'react'

export type SpeedPairStatus = 'idle' | 'searching' | 'matched'

export interface SpeedPairMatch {
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
}

function getPlayerId(): string {
  let id = sessionStorage.getItem('evalu_pid')
  if (!id) {
    id = Math.random().toString(36).substring(2, 12) + Date.now().toString(36)
    sessionStorage.setItem('evalu_pid', id)
  }
  return id
}

export function useSpeedPair() {
  const [status, setStatus] = useState<SpeedPairStatus>('idle')
  const [match, setMatch] = useState<SpeedPairMatch | null>(null)
  const [pendingOpponentMove, setPendingOpponentMove] = useState<string | null>(null)
  const [opponentResigned, setOpponentResigned] = useState(false)

  const myId = useRef(getPlayerId())
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const moveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const knownMoveCountRef = useRef(0)
  const opponentMoveQueue = useRef<string[]>([])
  const tcRef = useRef<string>('')
  const matchRef = useRef<SpeedPairMatch | null>(null)

  // Keep matchRef in sync with match state
  useEffect(() => { matchRef.current = match }, [match])

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    if (moveIntervalRef.current) { clearInterval(moveIntervalRef.current); moveIntervalRef.current = null }
  }, [])

  const enqueueOpponentMove = useCallback((san: string) => {
    opponentMoveQueue.current.push(san)
    if (opponentMoveQueue.current.length === 1) setPendingOpponentMove(san)
  }, [])

  const clearPendingMove = useCallback(() => {
    opponentMoveQueue.current.shift()
    setPendingOpponentMove(opponentMoveQueue.current[0] ?? null)
  }, [])

  const startWatchingMoves = useCallback((gameId: string, myColor: 'white' | 'black') => {
    knownMoveCountRef.current = 0
    moveIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/move?gameId=${gameId}&since=${knownMoveCountRef.current}`)
        const { moves, resigned } = await res.json() as { moves: string[]; resigned: boolean }
        if (resigned) {
          setOpponentResigned(true)
          stopPolling()
          return
        }
        if (!moves || moves.length === 0) return
        for (let i = 0; i < moves.length; i++) {
          const globalIdx = knownMoveCountRef.current + i
          const isWhiteTurn = globalIdx % 2 === 0
          const isMyMove = (isWhiteTurn && myColor === 'white') || (!isWhiteTurn && myColor === 'black')
          if (!isMyMove) enqueueOpponentMove(moves[i])
        }
        knownMoveCountRef.current += moves.length
      } catch { /* ignore */ }
    }, 800)
  }, [enqueueOpponentMove, stopPolling])

  const finaliseMatch = useCallback((m: SpeedPairMatch) => {
    stopPolling()
    setOpponentResigned(false)
    setMatch(m)
    setStatus('matched')
    startWatchingMoves(m.gameId, m.myColor)
  }, [stopPolling, startWatchingMoves])

  const joinPool = useCallback((tcLabel: string) => {
    tcRef.current = tcLabel
    opponentMoveQueue.current = []
    setOpponentResigned(false)
    setStatus('searching')

    const poll = async () => {
      try {
        const res = await fetch('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: myId.current, tc: tcLabel }),
        })
        const data = await res.json() as { matched: boolean; gameId?: string; myColor?: 'white' | 'black'; opponentId?: string; token?: string }
        if (data.matched && data.gameId && data.token) {
          finaliseMatch({ gameId: data.gameId, myColor: data.myColor!, opponentId: data.opponentId!, token: data.token })
        }
      } catch { /* ignore */ }
    }

    poll()
    pollIntervalRef.current = setInterval(poll, 1500)
  }, [finaliseMatch])

  // Signal resignation to opponent without resetting state (call before analysis)
  const resignGame = useCallback(async () => {
    const m = matchRef.current
    if (!m) return
    stopPolling()
    try {
      await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: m.gameId, resign: true, playerId: myId.current, token: m.token }),
      })
    } catch { /* ignore */ }
  }, [stopPolling])

  const leavePool = useCallback(async () => {
    stopPolling()
    setStatus('idle')
    setMatch(null)
    setPendingOpponentMove(null)
    setOpponentResigned(false)
    knownMoveCountRef.current = 0
    opponentMoveQueue.current = []
    try {
      await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: myId.current, tc: tcRef.current, leave: true }),
      })
    } catch { /* ignore */ }
  }, [stopPolling])

  const sendMove = useCallback((san: string) => {
    const m = matchRef.current
    if (!m) return
    fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: m.gameId, san, playerId: myId.current, token: m.token }),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    return () => { stopPolling() }
  }, [stopPolling])

  return {
    status,
    match,
    pendingOpponentMove,
    opponentResigned,
    clearPendingMove,
    joinPool,
    leavePool,
    resignGame,
    sendMove,
    isConfigured: true,
  }
}
