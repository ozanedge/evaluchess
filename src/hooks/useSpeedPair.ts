import { useState, useRef, useCallback, useEffect } from 'react'

export type SpeedPairStatus = 'idle' | 'searching' | 'matched'

export interface SpeedPairMatch {
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
}

export interface SpeedPairIdentity {
  uid?: string
  username?: string
  elo?: number
}

export interface OpponentMove {
  san: string
  ms: number | null
}

// Polling cadence tuned for responsiveness. Hidden-tab intervals are longer
// purely because nobody's watching — they don't affect perceived feel.
const MOVE_POLL_MS = 500
const MOVE_POLL_HIDDEN_MS = 5000
const JOIN_POLL_MS = 1500
const JOIN_POLL_HIDDEN_MS = 5000

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
  const [pendingOpponentMove, setPendingOpponentMove] = useState<OpponentMove | null>(null)
  const [opponentResigned, setOpponentResigned] = useState(false)

  const myId = useRef(getPlayerId())
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const joinActiveRef = useRef(false)
  const moveActiveRef = useRef(false)
  const joinTickRef = useRef<(() => void) | null>(null)
  const moveTickRef = useRef<(() => void) | null>(null)
  const knownMoveCountRef = useRef(0)
  const opponentMoveQueue = useRef<OpponentMove[]>([])
  const tcRef = useRef<string>('')
  const matchRef = useRef<SpeedPairMatch | null>(null)

  useEffect(() => { matchRef.current = match }, [match])

  const stopPolling = useCallback(() => {
    joinActiveRef.current = false
    moveActiveRef.current = false
    joinTickRef.current = null
    moveTickRef.current = null
    if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null }
    if (moveTimerRef.current) { clearTimeout(moveTimerRef.current); moveTimerRef.current = null }
  }, [])

  const enqueueOpponentMove = useCallback((move: OpponentMove) => {
    opponentMoveQueue.current.push(move)
    if (opponentMoveQueue.current.length === 1) setPendingOpponentMove(move)
  }, [])

  const clearPendingMove = useCallback(() => {
    opponentMoveQueue.current.shift()
    setPendingOpponentMove(opponentMoveQueue.current[0] ?? null)
  }, [])

  // Wake the active poller early whenever the tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) return
      if (moveActiveRef.current && moveTickRef.current) {
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
        moveTickRef.current()
      }
      if (joinActiveRef.current && joinTickRef.current) {
        if (joinTimerRef.current) clearTimeout(joinTimerRef.current)
        joinTickRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const startWatchingMoves = useCallback((gameId: string, myColor: 'white' | 'black') => {
    knownMoveCountRef.current = 0
    moveActiveRef.current = true

    const tick = async () => {
      if (!moveActiveRef.current) return
      if (document.hidden) {
        moveTimerRef.current = setTimeout(tick, MOVE_POLL_HIDDEN_MS)
        return
      }
      try {
        const res = await fetch(`/api/move?gameId=${gameId}&since=${knownMoveCountRef.current}&playerId=${myId.current}`)
        const { moves, resigned } = await res.json() as { moves: OpponentMove[]; resigned: boolean }
        if (resigned) {
          setOpponentResigned(true)
          stopPolling()
          return
        }
        if (moves && moves.length > 0) {
          for (let i = 0; i < moves.length; i++) {
            const globalIdx = knownMoveCountRef.current + i
            const isWhiteTurn = globalIdx % 2 === 0
            const isMyMove = (isWhiteTurn && myColor === 'white') || (!isWhiteTurn && myColor === 'black')
            if (!isMyMove) enqueueOpponentMove(moves[i])
          }
          knownMoveCountRef.current += moves.length
        }
      } catch { /* ignore */ }
      if (!moveActiveRef.current) return
      moveTimerRef.current = setTimeout(tick, MOVE_POLL_MS)
    }

    moveTickRef.current = tick
    tick()
  }, [enqueueOpponentMove, stopPolling])

  const finaliseMatch = useCallback((m: SpeedPairMatch) => {
    if (joinTimerRef.current) { clearTimeout(joinTimerRef.current); joinTimerRef.current = null }
    joinActiveRef.current = false
    joinTickRef.current = null
    setOpponentResigned(false)
    setMatch(m)
    setStatus('matched')
    startWatchingMoves(m.gameId, m.myColor)
  }, [startWatchingMoves])

  const joinPool = useCallback(async (tcLabel: string, identity?: SpeedPairIdentity) => {
    tcRef.current = tcLabel
    opponentMoveQueue.current = []
    knownMoveCountRef.current = 0
    setOpponentResigned(false)
    setStatus('searching')

    // Always clear any stale match record for this player ID before polling.
    try {
      await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: myId.current, tc: tcLabel, leave: true }),
      })
    } catch { /* ignore */ }

    joinActiveRef.current = true

    const tick = async () => {
      if (!joinActiveRef.current) return
      if (document.hidden) {
        joinTimerRef.current = setTimeout(tick, JOIN_POLL_HIDDEN_MS)
        return
      }
      try {
        const res = await fetch('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: myId.current,
            tc: tcLabel,
            ...(identity?.uid ? { uid: identity.uid } : {}),
            ...(identity?.username ? { username: identity.username } : {}),
            ...(typeof identity?.elo === 'number' ? { elo: identity.elo } : {}),
          }),
        })
        const data = await res.json() as {
          matched: boolean
          gameId?: string
          myColor?: 'white' | 'black'
          opponentId?: string
          token?: string
          opponentUsername?: string
          opponentElo?: number
          opponentUid?: string
        }
        if (data.matched && data.gameId && data.token) {
          finaliseMatch({
            gameId: data.gameId,
            myColor: data.myColor!,
            opponentId: data.opponentId!,
            token: data.token,
            opponentUsername: data.opponentUsername,
            opponentElo: data.opponentElo,
            opponentUid: data.opponentUid,
          })
          return
        }
      } catch { /* ignore */ }
      if (!joinActiveRef.current) return
      joinTimerRef.current = setTimeout(tick, JOIN_POLL_MS)
    }

    joinTickRef.current = tick
    tick()
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

  const sendMove = useCallback((san: string, remainingMs?: number) => {
    const m = matchRef.current
    if (!m) return
    fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: m.gameId, san, playerId: myId.current, token: m.token,
        ...(typeof remainingMs === 'number' ? { remainingMs: Math.round(remainingMs) } : {}),
      }),
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
