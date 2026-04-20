import { useState, useCallback, useEffect, useRef } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { useStockfish } from './hooks/useStockfish'
import { useChessClock } from './hooks/useChessClock'
import { usePositionEval } from './hooks/usePositionEval'
import { useComputerMove } from './hooks/useComputerMove'
import { useSpeedPair } from './hooks/useSpeedPair'
import { useOnlineCount } from './hooks/useOnlineCount'
import { buildAnalysis } from './utils/analysis'
import { clientLog } from './lib/clientLog'
import { clientMetric } from './lib/clientMetric'
import type { GameAnalysisResult } from './utils/analysis'
import Analysis from './components/Analysis'
import ClockDisplay from './components/ClockDisplay'
import EvalBar from './components/EvalBar'
import AuthModal from './components/AuthModal'
import UserBadge from './components/UserBadge'
import Leaderboard from './components/Leaderboard'
import { useAuth, recordGameResult } from './hooks/useAuth'
import { ref as dbRef, get as dbGet } from 'firebase/database'
import { db as firebaseDb } from './lib/firebase'
import type { LiveEval } from './hooks/usePositionEval'

type GameState = 'idle' | 'matching' | 'playing' | 'analyzing' | 'analyzed'

function buildMoveMetrics(
  source: string, gameMode: string, moveNumber: number,
  moveTimeMs: number, clockRemainingMs: number,
  evalScore: number | null, evalDepth: number | null,
  extraAttrs: Record<string, string | number | boolean> = {}
) {
  const attrs = { source, gameMode, ...extraAttrs }
  return [
    ...(evalScore !== null ? [{ name: 'chess.eval_cp', value: evalScore, attrs }] : []),
    ...(evalDepth !== null ? [{ name: 'chess.eval_depth', value: evalDepth, attrs }] : []),
    { name: 'chess.move_time_ms', value: moveTimeMs, attrs },
    { name: 'chess.clock_remaining_ms', value: clockRemainingMs, attrs },
    { name: 'chess.game_move_count', value: moveNumber, attrs },
  ]
}

const DIFFICULTIES = [
  { label: 'Novice', elo: 800, description: '~800' },
  { label: 'Enthusiast', elo: 1200, description: '~1200' },
  { label: 'Expert', elo: 1800, description: '~1800' },
  { label: 'Master', elo: 2200, description: '~2200' },
]

const TIME_CONTROLS = [
  { label: '3+0', seconds: 180, increment: 0 },
  { label: '5+0', seconds: 300, increment: 0 },
  { label: '10+0', seconds: 600, increment: 0 },
]

export default function App() {
  const [game, setGame] = useState(new Chess())
  const [gameState, setGameState] = useState<GameState>('idle')
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()])
  const [analysisResult, setAnalysisResult] = useState<GameAnalysisResult | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 })
  const [gameOverMsg, setGameOverMsg] = useState('')
  const [selectedTC, setSelectedTC] = useState(1) // default 5+0
  const [clockEnabled] = useState(true)
  const [gameMode, setGameMode] = useState<'computer' | 'speed-pair'>('speed-pair')
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const [selectedDifficulty, setSelectedDifficulty] = useState(1) // default Enthusiast
  const [liveEval, setLiveEval] = useState<LiveEval | null>(null)
  const [computerThinking, setComputerThinking] = useState(false)
  const [reviewMoveIndex, setReviewMoveIndex] = useState<number | null>(null)
  const [analysisFens, setAnalysisFens] = useState<string[]>([])
  const [moveSquaresHistory, setMoveSquaresHistory] = useState<{ from: string; to: string }[]>([])
  const [analysisPlayerColor, setAnalysisPlayerColor] = useState<'white' | 'black'>('white')
  const [lastMoveEvalSnapshot, setLastMoveEvalSnapshot] = useState<{ score: number; mate: number | null } | null>(null)
  const [lastMovedColor, setLastMovedColor] = useState<'white' | 'black' | null>(null)

  // Refs that mirror state so async functions always see current values
  const fenHistoryRef = useRef<string[]>([new Chess().fen()])
  const moveHistoryRef = useRef<string[]>([])
  const moveSquaresHistoryRef = useRef<{ from: string; to: string }[]>([])
  const gameRef = useRef(game)
  const computerThinkingRef = useRef(false)
  const gameStateRef = useRef<GameState>('idle')
  const gameModeRef = useRef<'computer' | 'speed-pair'>('computer')
  const liveEvalRef = useRef<LiveEval | null>(null)
  const lastMoveTimestampRef = useRef<number>(0)
  const [premove, setPremove] = useState<{ from: string; to: string } | null>(null)
  const premoveRef = useRef<{ from: string; to: string } | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [legalMoveSquares, setLegalMoveSquares] = useState<Set<string>>(new Set())
  const [boardSize, setBoardSize] = useState(600)

  useEffect(() => {
    const EVAL_BAR = 28
    const GAP = 8
    const update = () => {
      const available = window.innerWidth - 32 // 16px padding each side on mobile
      const size = Math.min(600, available - EVAL_BAR - GAP)
      setBoardSize(Math.max(280, size))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Keep refs in sync with state so onDrop always reads fresh values
  gameRef.current = game
  computerThinkingRef.current = computerThinking
  gameStateRef.current = gameState
  gameModeRef.current = gameMode
  premoveRef.current = premove

  const tc = TIME_CONTROLS[selectedTC]
  const clock = useChessClock(tc.seconds, tc.increment)
  const { analyzeGame, destroy } = useStockfish()
  const { evaluate: evalPosition, stop: stopEval } = usePositionEval((ev) => {
    liveEvalRef.current = ev
    setLiveEval(ev)
  })
  const { getMove: getComputerMove } = useComputerMove()
  const speedPair = useSpeedPair()
  const onlineCount = useOnlineCount()
  const auth = useAuth()
  const [authModal, setAuthModal] = useState<null | 'signin' | 'signup'>(null)
  const [menuView, setMenuView] = useState<'speed-pair' | 'computer' | 'leaderboard'>('speed-pair')
  const [ratingChange, setRatingChange] = useState<{ delta: number; next: number } | null>(null)
  const [opponentProfile, setOpponentProfile] = useState<{ username?: string; elo?: number }>({})

  // When a Speed Pair match is made, fall back to Firebase if the matchmaking
  // payload didn't carry the opponent's username/elo (e.g. their profile was
  // still loading when they clicked Start Game).
  useEffect(() => {
    setOpponentProfile({})
    const m = speedPair.match
    if (!m || !firebaseDb) return
    if (!m.opponentUid) return
    if (m.opponentUsername && typeof m.opponentElo === 'number') return
    let cancelled = false
    dbGet(dbRef(firebaseDb, `users/${m.opponentUid}`)).then((snap) => {
      if (cancelled) return
      const val = snap.val() as { username?: string; elo?: number } | null
      if (!val) return
      setOpponentProfile({ username: val.username, elo: val.elo })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [speedPair.match])
  const gameResultRecordedRef = useRef(false)

  useEffect(() => () => destroy(), [destroy])

  // After analysis completes, jump to first mistake or blunder by the player
  useEffect(() => {
    if (gameState === 'analyzed' && analysisResult) {
      const firstError = analysisResult.moves.findIndex(
        (m) => m.player === analysisPlayerColor && (m.classification === 'mistake' || m.classification === 'blunder')
      )
      if (firstError !== -1) setReviewMoveIndex(firstError)
    }
  }, [gameState, analysisResult, analysisPlayerColor])

  // Update eval bar when reviewing moves after game
  useEffect(() => {
    if (reviewMoveIndex === null || !analysisResult) return
    const ev = analysisResult.moves[reviewMoveIndex]?.evalBefore
    if (ev) setLiveEval({ score: ev.score, mate: ev.mate, depth: 0 })
  }, [reviewMoveIndex, analysisResult])

  // Handle opponent resignation in Speed Pair
  useEffect(() => {
    if (speedPair.opponentResigned && gameState === 'playing') {
      setGameOverMsg('Opponent resigned. You win!')
      clock.stop()
      stopEval()
      applySpeedPairResult('win')
      triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, speedPair.match?.myColor ?? 'white')
    }
  }, [speedPair.opponentResigned]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle flag (timeout)
  useEffect(() => {
    if (clock.flagged && gameState === 'playing') {
      const winner = clock.flagged === 'white' ? 'Black' : 'White'
      const msg = `${winner} wins on time!`
      setGameOverMsg(msg)
      clock.stop()
      applySpeedPairResult(clock.flagged === playerColor ? 'loss' : 'win')
      triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, playerColor)
    }
  }, [clock.flagged]) // eslint-disable-line react-hooks/exhaustive-deps

  const applySpeedPairResult = useCallback(
    async (outcome: 'win' | 'loss' | 'draw') => {
      if (gameResultRecordedRef.current) return
      if (gameModeRef.current !== 'speed-pair') return
      if (!auth.user || !auth.profile) return
      const match = speedPair.match
      const oppElo = typeof match?.opponentElo === 'number'
        ? match.opponentElo
        : opponentProfile.elo
      if (typeof oppElo !== 'number') return
      gameResultRecordedRef.current = true
      const before = auth.profile.elo
      try {
        const next = await recordGameResult(auth.user.uid, before, oppElo, outcome)
        if (typeof next === 'number') {
          setRatingChange({ delta: next - before, next })
        }
      } catch (err) {
        console.error('Failed to record game result', err)
      }
    },
    [auth.user, auth.profile, speedPair.match, opponentProfile.elo]
  )

  const checkGameOver = useCallback((g: Chess): string => {
    if (g.isCheckmate()) return `Checkmate! ${g.turn() === 'w' ? 'Black' : 'White'} wins.`
    if (g.isStalemate()) return 'Stalemate — Draw'
    if (g.isThreefoldRepetition()) return 'Draw by repetition'
    if (g.isInsufficientMaterial()) return 'Draw — Insufficient material'
    if (g.isDraw()) return 'Draw'
    return ''
  }, [])

  const computerColor = playerColor === 'white' ? 'black' : 'white'

  // Ref-based pattern so the effect can always call the latest version of this function
  const applyOpponentMoveRef = useRef<(move: { san: string; ms: number | null }) => void>(() => {})
  applyOpponentMoveRef.current = ({ san, ms }) => {
    const currentFen = fenHistoryRef.current[fenHistoryRef.current.length - 1]
    const g = new Chess(currentFen)
    try {
      const move = g.move(san)
      if (!move) return
      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistoryRef.current, g.fen()]
      const newMoveHistory = [...moveHistoryRef.current, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistoryRef.current, { from: move.from, to: move.to }]
      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory
      setGame(g)
      setFenHistory(newFenHistory)
      setMoveHistory(newMoveHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)
      // Sync the mover's clock to the authoritative value they reported so local
      // drift (caused by network latency + poll delay) never accumulates.
      if (clockEnabled) clock.onMove(movedColor, ms ?? undefined)
      setLastMoveEvalSnapshot(liveEvalRef.current ? { score: liveEvalRef.current.score, mate: liveEvalRef.current.mate } : null)
      setLastMovedColor(movedColor)
      evalPosition(g.fen())
      const _oppMoveTimeMs = lastMoveTimestampRef.current ? Date.now() - lastMoveTimestampRef.current : 0
      lastMoveTimestampRef.current = Date.now()
      const _oppClockMs = clockEnabled ? (playerColor === 'white' ? clock.timeBlack : clock.timeWhite) : 0
      clientLog('info', 'client move played', {
        san: move.san, fen: g.fen(), moveNumber: newMoveHistory.length,
        source: 'opponent', gameMode: gameModeRef.current,
        moveTimeMs: _oppMoveTimeMs, clockRemainingMs: _oppClockMs,
        ...(speedPair.match ? { gameId: speedPair.match.gameId } : {}),
        ...(liveEvalRef.current ? { evalCp: liveEvalRef.current.score, evalDepth: liveEvalRef.current.depth, ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}) } : {}),
      })
      clientMetric(buildMoveMetrics(
        'opponent', gameModeRef.current, newMoveHistory.length, _oppMoveTimeMs, _oppClockMs,
        liveEvalRef.current?.score ?? null, liveEvalRef.current?.depth ?? null,
        speedPair.match ? { gameId: speedPair.match.gameId } : {}
      ))
      const overMsg = checkGameOver(g)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        applySpeedPairResult(g.isCheckmate() ? 'loss' : 'draw')
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else {
        tryPremove(g)
      }
    } catch {
      console.error('Failed to apply opponent move:', san)
    }
  }

  // When Speed Pair match is found, start the game
  useEffect(() => {
    if (speedPair.status === 'matched' && speedPair.match && gameState === 'matching') {
      setPlayerColor(speedPair.match.myColor)
      setGameState('playing')
      if (clockEnabled) clock.start()
    }
  }, [speedPair.status, speedPair.match, gameState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending opponent moves in Speed Pair
  useEffect(() => {
    if (!speedPair.pendingOpponentMove || gameState !== 'playing' || gameMode !== 'speed-pair') return
    applyOpponentMoveRef.current(speedPair.pendingOpponentMove)
    speedPair.clearPendingMove()
  }, [speedPair.pendingOpponentMove, gameState, gameMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function tryPremove(currentGame: InstanceType<typeof Chess>) {
    const pm = premoveRef.current
    if (!pm) return
    setPremove(null)
    try {
      const gameCopy = new Chess(currentGame.fen())
      const move = gameCopy.move({ from: pm.from, to: pm.to, promotion: 'q' })
      if (!move) return
      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistoryRef.current, gameCopy.fen()]
      const newMoveHistory = [...moveHistoryRef.current, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistoryRef.current, { from: pm.from, to: pm.to }]
      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory
      // Capture local authoritative remaining time BEFORE onMove swaps the clock,
      // so the value we report to the opponent matches what we just saw.
      const moverRemainingMs = clockEnabled
        ? (movedColor === 'white' ? clock.timeWhite : clock.timeBlack)
        : undefined
      setGame(gameCopy)
      setFenHistory(newFenHistory)
      setMoveHistory(newMoveHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)
      if (clockEnabled) clock.onMove(movedColor)
      setLastMoveEvalSnapshot(liveEvalRef.current ? { score: liveEvalRef.current.score, mate: liveEvalRef.current.mate } : null)
      setLastMovedColor(movedColor)
      evalPosition(gameCopy.fen())
      if (gameModeRef.current === 'speed-pair') speedPair.sendMove(move.san, moverRemainingMs)
      const _preMoveTimeMs = lastMoveTimestampRef.current ? Date.now() - lastMoveTimestampRef.current : 0
      lastMoveTimestampRef.current = Date.now()
      const _preClockMs = clockEnabled ? (playerColor === 'white' ? clock.timeWhite : clock.timeBlack) : 0
      clientLog('info', 'client move played', {
        san: move.san, fen: gameCopy.fen(), moveNumber: newMoveHistory.length,
        source: 'premove', gameMode: gameModeRef.current,
        moveTimeMs: _preMoveTimeMs, clockRemainingMs: _preClockMs,
        ...(gameModeRef.current === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}),
        ...(liveEvalRef.current ? { evalCp: liveEvalRef.current.score, evalDepth: liveEvalRef.current.depth, ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}) } : {}),
      })
      clientMetric(buildMoveMetrics(
        'premove', gameModeRef.current, newMoveHistory.length, _preMoveTimeMs, _preClockMs,
        liveEvalRef.current?.score ?? null, liveEvalRef.current?.depth ?? null,
        gameModeRef.current === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}
      ))
      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        applySpeedPairResult(gameCopy.isCheckmate() ? 'win' : 'draw')
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else if (gameModeRef.current === 'computer') {
        triggerComputerMove(gameCopy.fen())
      }
    } catch { /* premove was illegal — silently discard */ }
  }

  async function triggerComputerMove(fen: string) {
    setComputerThinking(true)
    try {
      const uciMove = await getComputerMove(fen, DIFFICULTIES[selectedDifficulty].elo)
      const from = uciMove.substring(0, 2)
      const to = uciMove.substring(2, 4)
      const promotion = uciMove[4] || 'q'

      const g = new Chess(fen)
      const move = g.move({ from, to, promotion })
      if (!move) return

      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistoryRef.current, g.fen()]
      const newMoveHistory = [...moveHistoryRef.current, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistoryRef.current, { from, to }]

      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory

      setGame(g)
      setFenHistory(newFenHistory)
      setMoveHistory(newMoveHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)

      if (clockEnabled) clock.onMove(movedColor)
      setLastMoveEvalSnapshot(liveEvalRef.current ? { score: liveEvalRef.current.score, mate: liveEvalRef.current.mate } : null)
      setLastMovedColor(movedColor)
      evalPosition(g.fen())
      const _compMoveTimeMs = lastMoveTimestampRef.current ? Date.now() - lastMoveTimestampRef.current : 0
      lastMoveTimestampRef.current = Date.now()
      const _compClockMs = clockEnabled ? (playerColor === 'white' ? clock.timeBlack : clock.timeWhite) : 0
      clientLog('info', 'client move played', {
        san: move.san, fen: g.fen(), moveNumber: newMoveHistory.length,
        source: 'computer', gameMode: 'computer', elo: DIFFICULTIES[selectedDifficulty].elo,
        moveTimeMs: _compMoveTimeMs, clockRemainingMs: _compClockMs,
        ...(liveEvalRef.current ? { evalCp: liveEvalRef.current.score, evalDepth: liveEvalRef.current.depth, ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}) } : {}),
      })
      clientMetric(buildMoveMetrics(
        'computer', 'computer', newMoveHistory.length, _compMoveTimeMs, _compClockMs,
        liveEvalRef.current?.score ?? null, liveEvalRef.current?.depth ?? null,
        { elo: DIFFICULTIES[selectedDifficulty].elo }
      ))

      const overMsg = checkGameOver(g)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else {
        tryPremove(g)
      }
    } catch {
      // computer had no move
    } finally {
      setComputerThinking(false)
    }
  }

  function handleStartGame() {
    if (gameMode === 'speed-pair') {
      setGameState('matching')
      speedPair.joinPool(tc.label, auth.user && auth.profile ? {
        uid: auth.user.uid,
        username: auth.profile.username,
        elo: auth.profile.elo,
      } : undefined)
      return
    }
    setGameState('playing')
    if (clockEnabled) clock.start()
    // Always evaluate the starting position immediately so liveEvalRef has a real
    // eval by the time the first move is made (by either side).
    // Seed first so the snapshot is never null even if Stockfish hasn't responded yet.
    const seed = { score: 0, mate: null, depth: 0 }
    liveEvalRef.current = seed
    setLiveEval(seed)
    evalPosition(new Chess().fen())
    // If playing vs computer and player chose black, computer (white) goes first
    if (gameMode === 'computer' && playerColor === 'black') {
      triggerComputerMove(new Chess().fen())
    }
  }

  function onDrop({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) {
    const currentGame = gameRef.current
    const currentMode = gameModeRef.current
    if (gameStateRef.current !== 'playing') return false
    if (!targetSquare) return false

    const isOpponentTurn =
      (currentMode === 'computer' && ((currentGame.turn() === 'w') === (computerColor === 'white'))) ||
      (currentMode === 'speed-pair' && ((currentGame.turn() === 'w') !== (playerColor === 'white')))

    // During opponent's turn — save as premove if it's the player's own piece
    if (isOpponentTurn || computerThinkingRef.current) {
      const piece = currentGame.get(sourceSquare as Parameters<typeof currentGame.get>[0])
      if (!piece) return false
      const isMyPiece = (piece.color === 'w') === (playerColor === 'white')
      if (!isMyPiece) return false
      setPremove({ from: sourceSquare, to: targetSquare })
      return false
    }

    try {
      const gameCopy = new Chess(currentGame.fen())
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false

      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistory, gameCopy.fen()]
      const newMoveHistory = [...moveHistory, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistory, { from: sourceSquare, to: targetSquare }]

      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory

      // Capture remaining time before onMove swaps the active color so the value
      // reported to the opponent matches what the player just saw on their clock.
      const moverRemainingMs = clockEnabled
        ? (movedColor === 'white' ? clock.timeWhite : clock.timeBlack)
        : undefined

      setPremove(null)
      setSelectedSquare(null)
      setLegalMoveSquares(new Set())
      setGame(gameCopy)
      setMoveHistory(newMoveHistory)
      setFenHistory(newFenHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)

      // Switch clock after move
      if (clockEnabled) clock.onMove(movedColor)

      // Update live eval
      setLastMoveEvalSnapshot(liveEvalRef.current ? { score: liveEvalRef.current.score, mate: liveEvalRef.current.mate } : null)
      setLastMovedColor(movedColor)
      evalPosition(gameCopy.fen())

      // In Speed Pair, send the move with the mover's authoritative clock reading.
      if (gameMode === 'speed-pair') speedPair.sendMove(move.san, moverRemainingMs)

      const _playerMoveTimeMs = lastMoveTimestampRef.current ? Date.now() - lastMoveTimestampRef.current : 0
      lastMoveTimestampRef.current = Date.now()
      const _playerClockMs = clockEnabled ? (playerColor === 'white' ? clock.timeWhite : clock.timeBlack) : 0
      clientLog('info', 'client move played', {
        san: move.san, fen: gameCopy.fen(), moveNumber: newMoveHistory.length,
        source: 'player', gameMode,
        moveTimeMs: _playerMoveTimeMs, clockRemainingMs: _playerClockMs,
        ...(gameMode === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}),
        ...(liveEvalRef.current ? { evalCp: liveEvalRef.current.score, evalDepth: liveEvalRef.current.depth, ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}) } : {}),
      })
      clientMetric(buildMoveMetrics(
        'player', gameMode, newMoveHistory.length, _playerMoveTimeMs, _playerClockMs,
        liveEvalRef.current?.score ?? null, liveEvalRef.current?.depth ?? null,
        gameMode === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}
      ))

      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        applySpeedPairResult(gameCopy.isCheckmate() ? 'win' : 'draw')
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else if (gameMode === 'computer') {
        triggerComputerMove(gameCopy.fen())
      }

      return true
    } catch {
      return false
    }
  }

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    if (gameStateRef.current !== 'playing') return

    const currentGame = gameRef.current
    const currentMode = gameModeRef.current

    const isOpponentTurn =
      (currentMode === 'computer' && (currentGame.turn() === 'w') === (computerColor === 'white')) ||
      (currentMode === 'speed-pair' && (currentGame.turn() === 'w') !== (playerColor === 'white'))

    // During opponent's turn: handle premove clicks
    if (isOpponentTurn || computerThinkingRef.current) {
      const piece = currentGame.get(square as Parameters<typeof currentGame.get>[0])
      const isMyPiece = piece && (piece.color === 'w') === (playerColor === 'white')
      if (selectedSquare && !isMyPiece) {
        // Second click: save premove
        setPremove({ from: selectedSquare, to: square })
        setSelectedSquare(null)
        setLegalMoveSquares(new Set())
      } else if (isMyPiece) {
        // First click or re-select: pick piece
        setSelectedSquare(square)
        setLegalMoveSquares(new Set())
      } else {
        setSelectedSquare(null)
        setLegalMoveSquares(new Set())
      }
      return
    }

    const piece = currentGame.get(square as Parameters<typeof currentGame.get>[0])
    const isMyPiece = piece && (piece.color === 'w') === (playerColor === 'white')

    if (!selectedSquare) {
      // First click: select own piece
      if (!isMyPiece) return
      const moves = currentGame.moves({ square: square as Parameters<typeof currentGame.moves>[0] extends { square?: infer S } ? S : never, verbose: true })
      setSelectedSquare(square)
      setLegalMoveSquares(new Set(moves.map((m: { to: string }) => m.to)))
      return
    }

    // Second click
    if (square === selectedSquare) {
      // Deselect
      setSelectedSquare(null)
      setLegalMoveSquares(new Set())
      return
    }

    if (isMyPiece) {
      // Re-select different own piece
      const moves = currentGame.moves({ square: square as Parameters<typeof currentGame.moves>[0] extends { square?: infer S } ? S : never, verbose: true })
      setSelectedSquare(square)
      setLegalMoveSquares(new Set(moves.map((m: { to: string }) => m.to)))
      return
    }

    // Attempt move
    const result = onDrop({ piece: null, sourceSquare: selectedSquare, targetSquare: square })
    setSelectedSquare(null)
    setLegalMoveSquares(new Set())
    if (!result) {
      // Illegal move — deselect
    }
  }

  async function triggerAnalysis(fens: string[], moves: string[], pColor: 'white' | 'black') {
    setGameState('analyzing')
    setAnalysisPlayerColor(pColor)
    setAnalysisProgress({ current: 0, total: fens.length })
    const evals = await analyzeGame(fens, (current, total) => {
      setAnalysisProgress({ current, total })
    })
    const result = buildAnalysis(moves, evals)
    setAnalysisResult(result)
    setAnalysisFens(fens)
    setGameState('analyzed')
  }

  function handleNewGame() {
    speedPair.leavePool()
    stopEval()
    lastMoveTimestampRef.current = 0
    gameResultRecordedRef.current = false
    setRatingChange(null)
    setLastMoveEvalSnapshot(null)
    setLastMovedColor(null)
    const newGame = new Chess()
    fenHistoryRef.current = [newGame.fen()]
    moveHistoryRef.current = []
    moveSquaresHistoryRef.current = []
    setGame(newGame)
    setGameState('idle')
    setMoveHistory([])
    setFenHistory([newGame.fen()])
    setAnalysisResult(null)
    setGameOverMsg('')
    setAnalysisProgress({ current: 0, total: 0 })
    clock.reset(tc.seconds)
    setLiveEval(null)
    liveEvalRef.current = null
    setLastMoveEvalSnapshot(null)
    setLastMovedColor(null)
    setReviewMoveIndex(null)
    setAnalysisFens([])
    setMoveSquaresHistory([])
    setPremove(null)
    setSelectedSquare(null)
    setLegalMoveSquares(new Set())
    setComputerThinking(false)
    setAnalysisPlayerColor('white')
  }

  async function handlePlayAgain() {
    // Await leavePool so the server deletes the previous match record before we
    // rejoin. Otherwise /api/join returns the stale match and we instantly see
    // the old "opponent resigned" state.
    await speedPair.leavePool()
    handleNewGame()
    handleStartGame()
  }

  // Reset clock when time control changes (only when idle)
  function handleTCChange(idx: number) {
    setSelectedTC(idx)
    if (gameState === 'idle') {
      clock.reset(TIME_CONTROLS[idx].seconds)
    }
  }

  // Board position: show the position BEFORE the reviewed move (so best-move arrow makes sense),
  // or current game position during play.
  const displayFen = reviewMoveIndex !== null && analysisFens[reviewMoveIndex]
    ? analysisFens[reviewMoveIndex]
    : game.fen()

  // Last move highlight: during review use that move's squares, otherwise use the latest move
  const lastMoveSquares = reviewMoveIndex !== null
    ? moveSquaresHistory[reviewMoveIndex]
    : moveSquaresHistory[moveSquaresHistory.length - 1]

  const squareStyles: Record<string, { backgroundColor: string }> = {}

  if (lastMoveSquares) {
    squareStyles[lastMoveSquares.from] = { backgroundColor: 'rgba(255, 255, 0, 0.35)' }
    squareStyles[lastMoveSquares.to] = { backgroundColor: 'rgba(255, 255, 0, 0.5)' }
  }

  if (selectedSquare) {
    squareStyles[selectedSquare] = { backgroundColor: 'rgba(255, 255, 100, 0.6)' }
  }
  for (const sq of legalMoveSquares) {
    squareStyles[sq] = { backgroundColor: 'rgba(255, 255, 100, 0.25)' }
  }
  if (premove) {
    squareStyles[premove.from] = { backgroundColor: 'rgba(100, 150, 255, 0.5)' }
    squareStyles[premove.to] = { backgroundColor: 'rgba(100, 150, 255, 0.65)' }
  }

  if (reviewMoveIndex === null && game.inCheck()) {
    const kingSquare = game.board().flat().find(
      (p) => p && p.type === 'k' && p.color === game.turn()
    )
    if (kingSquare) squareStyles[kingSquare.square] = { backgroundColor: 'rgba(255,0,0,0.4)' }
  }

  // Arrows: green for best move, red for the actual move played (when reviewing).
  // If the played move is the best move, skip the red arrow so the green one is visible.
  const reviewArrows = (() => {
    if (reviewMoveIndex === null || !analysisResult) return []
    const arrows = []
    const uci = analysisResult.moves[reviewMoveIndex]?.bestMove
    const played = moveSquaresHistory[reviewMoveIndex]
    const bestFrom = uci && uci.length >= 4 ? uci.substring(0, 2) : null
    const bestTo   = uci && uci.length >= 4 ? uci.substring(2, 4) : null
    const playedWasBest = played && bestFrom && bestTo && played.from === bestFrom && played.to === bestTo
    if (played && !playedWasBest) {
      arrows.push({ startSquare: played.from, endSquare: played.to, color: 'rgba(239, 68, 68, 0.85)' })
    }
    if (bestFrom && bestTo) {
      arrows.push({ startSquare: bestFrom, endSquare: bestTo, color: 'rgba(16, 185, 129, 0.85)' })
    }
    return arrows
  })()

  const isPlaying = gameState === 'playing'

  const liveClassification = (() => {
    if (!lastMoveEvalSnapshot || !liveEval || !lastMovedColor) return null
    const cpLoss = lastMovedColor === 'white'
      ? Math.max(0, lastMoveEvalSnapshot.score - liveEval.score)
      : Math.max(0, liveEval.score - lastMoveEvalSnapshot.score)
    if (cpLoss <= 0)   return { label: 'Best',       color: 'text-green-400' }
    if (cpLoss <= 20)  return { label: 'Good',       color: 'text-emerald-400' }
    if (cpLoss <= 50)  return { label: 'Inaccuracy', color: 'text-yellow-400' }
    if (cpLoss <= 150) return { label: 'Mistake',    color: 'text-orange-400' }
    return               { label: 'Blunder',     color: 'text-red-500' }
  })()

  return (
    <div className="app-bg min-h-screen flex items-start justify-center p-3 lg:p-8">
      <div className="flex flex-col lg:flex-row gap-5 lg:gap-8 w-full max-w-6xl">
        {/* Board column */}
        <div className="flex flex-col gap-2.5 lg:shrink-0" style={{ width: boardSize <= 500 ? '100%' : 660 }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-900/50 ring-1 ring-white/15">
                <span className="text-xl leading-none text-white drop-shadow-sm">♞</span>
              </div>
              <div className="leading-tight">
                <h1 className="text-xl font-bold tracking-tight gradient-text">Evaluchess</h1>
                <p className="text-[11px] font-medium text-gray-500 tracking-wide">Play · Analyze · Improve</p>
              </div>
            </div>
            <UserBadge auth={auth} onlineCount={onlineCount} onOpenAuth={(m) => setAuthModal(m)} />
          </div>

          {/* Opponent clock (top) */}
          {(() => {
            const opponent = playerColor === 'white' ? 'black' : 'white'
            const oppTimeMs = opponent === 'white' ? clock.timeWhite : clock.timeBlack
            const oppActive = clock.activeColor === opponent && isPlaying
            const oppFlagged = clock.flagged === opponent
            return (
              <div className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all duration-200 ${
                oppActive ? 'glass glow-active' : 'glass-subtle'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full shrink-0 ${opponent === 'white' ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.35)]' : 'bg-gray-900 border-2 border-gray-500'}`} />
                  {(() => {
                    const oppName = speedPair.match?.opponentUsername ?? opponentProfile.username
                    const oppElo = typeof speedPair.match?.opponentElo === 'number'
                      ? speedPair.match.opponentElo
                      : (typeof opponentProfile.elo === 'number' ? opponentProfile.elo : undefined)
                    return (
                      <div className="flex items-center gap-2.5">
                        <span className={`text-base font-semibold tracking-tight ${oppActive ? 'text-white' : 'text-gray-300'}`}>
                          {gameMode === 'computer'
                            ? `Computer · ${DIFFICULTIES[selectedDifficulty].label}`
                            : oppName
                              ? oppName
                              : opponent === 'white' ? 'White' : 'Black'}
                        </span>
                        {gameMode === 'speed-pair' && typeof oppElo === 'number' && (
                          <>
                            <span className="w-px h-4 bg-white/15" />
                            <span className="text-sm font-mono font-semibold text-indigo-300 tabular-nums">
                              {oppElo}
                            </span>
                          </>
                        )}
                      </div>
                    )
                  })()}
                  {computerThinking && (
                    <span className="flex items-center gap-1.5 text-xs text-indigo-300 font-medium">
                      <span className="flex gap-0.5">
                        <span className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse" style={{ animationDelay: '180ms' }} />
                        <span className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse" style={{ animationDelay: '360ms' }} />
                      </span>
                      thinking
                    </span>
                  )}
                </div>
                {clockEnabled && (
                  <ClockDisplay
                    timeMs={oppTimeMs}
                    isActive={oppActive}
                    isFlagged={oppFlagged}
                    color={opponent}
                  />
                )}
              </div>
            )
          })()}

          {/* Opponent move classification (below opponent clock) */}
          <div className="h-8 flex items-center justify-center">
            {isPlaying && liveClassification && lastMovedColor !== playerColor && (
              <span className={`text-2xl font-bold tracking-wide [text-shadow:0_2px_12px_rgba(0,0,0,0.85)] ${liveClassification.color}`}>
                {liveClassification.label}
              </span>
            )}
          </div>

          {/* Board + eval bar */}
          <div className="flex gap-2 items-stretch">
            <EvalBar ev={liveEval} height={boardSize} />
            <div
              className="rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
              style={{
                width: boardSize,
                height: boardSize,
                boxShadow: '0 40px 80px -30px rgba(99, 102, 241, 0.45), 0 0 0 1px rgba(255,255,255,0.08)',
              }}
            >
              <Chessboard
                key={reviewMoveIndex !== null ? `review-${reviewMoveIndex}` : 'game'}
                options={{
                  position: displayFen,
                  boardOrientation: playerColor,
                  onPieceDrop: isPlaying ? onDrop : undefined,
                  onSquareClick: isPlaying ? onSquareClick : undefined,
                  squareStyles,
                  arrows: reviewArrows,
                  boardStyle: { borderRadius: '4px' },
                  darkSquareStyle: { backgroundColor: '#6b8c5a' },
                  lightSquareStyle: { backgroundColor: '#eaded0' },
                  showAnimations: false,
                }}
              />
            </div>
          </div>

          {/* Player move classification (above player clock) */}
          <div className="h-8 flex items-center justify-center">
            {isPlaying && liveClassification && lastMovedColor === playerColor && (
              <span className={`text-2xl font-bold tracking-wide [text-shadow:0_2px_12px_rgba(0,0,0,0.85)] ${liveClassification.color}`}>
                {liveClassification.label}
              </span>
            )}
          </div>

          {/* Player clock (bottom) */}
          {(() => {
            const playerTimeMs = playerColor === 'white' ? clock.timeWhite : clock.timeBlack
            const playerActive = clock.activeColor === playerColor && isPlaying
            const playerFlagged = clock.flagged === playerColor
            return (
              <div className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all duration-200 ${
                playerActive ? 'glass glow-active' : 'glass-subtle'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full shrink-0 ${playerColor === 'white' ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.35)]' : 'bg-gray-900 border-2 border-gray-500'}`} />
                  <div className="flex items-center gap-2.5">
                    <span className={`text-base font-semibold tracking-tight ${playerActive ? 'text-white' : 'text-gray-300'}`}>
                      {gameMode === 'speed-pair' && auth.profile
                        ? auth.profile.username
                        : gameMode === 'computer'
                          ? 'You'
                          : playerColor === 'white' ? 'White' : 'Black'}
                    </span>
                    {gameMode === 'speed-pair' && auth.profile && (
                      <>
                        <span className="w-px h-4 bg-white/15" />
                        <span className="text-sm font-mono font-semibold text-indigo-300 tabular-nums">
                          {auth.profile.elo}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {clockEnabled && (
                  <ClockDisplay
                    timeMs={playerTimeMs}
                    isActive={playerActive}
                    isFlagged={playerFlagged}
                    color={playerColor}
                  />
                )}
              </div>
            )
          })()}

        </div>

        {/* Side panel — on mobile, float above the board while the game hasn't started
            so users don't see an un-interactable board before the configurator. */}
        <div className={`w-full lg:flex-1 lg:min-w-64 flex flex-col gap-4 ${
          gameState === 'idle' || gameState === 'matching' ? 'order-first lg:order-none' : ''
        }`}>
          {/* Configurator — idle only. Always stretch the panel to match the
              board column's height on desktop. The Start Game button anchors to
              the bottom via mt-auto so the form feels grounded. */}
          {gameState === 'idle' && (
            <div className="glass rounded-2xl p-5 flex flex-col gap-5 lg:flex-1">
              {/* Mode / view selector */}
              <div className="flex gap-1 bg-black/30 p-1 rounded-xl ring-1 ring-white/5">
                {(['speed-pair', 'computer', 'leaderboard'] as const).map((view) => {
                  const active = menuView === view
                  return (
                    <button
                      key={view}
                      onClick={() => {
                        setMenuView(view)
                        if (view === 'speed-pair' || view === 'computer') setGameMode(view)
                      }}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                        active
                          ? 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-900/40'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
                      }`}
                    >
                      {view === 'computer' ? 'Computer' : view === 'leaderboard' ? 'Leaderboard' : (
                        <span className="flex items-center justify-center gap-1.5">
                          Speed Pair
                          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${active ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                            {onlineCount}
                          </span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {menuView === 'leaderboard' && <Leaderboard />}

              {menuView !== 'leaderboard' && <>
              {/* Difficulty selector — computer mode only */}
              {gameMode === 'computer' && (
                <div>
                  <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em] mb-2.5">Computer Difficulty</div>
                  <div className="grid grid-cols-2 gap-2">
                    {DIFFICULTIES.map((d, i) => (
                      <button
                        key={d.label}
                        onClick={() => setSelectedDifficulty(i)}
                        className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all text-left ring-1 ${
                          selectedDifficulty === i
                            ? 'bg-gradient-to-br from-indigo-500/90 to-fuchsia-500/90 text-white ring-white/20 shadow-md shadow-indigo-900/30'
                            : 'bg-white/5 text-gray-200 ring-white/5 hover:bg-white/10 hover:ring-white/10'
                        }`}
                      >
                        <div className="leading-tight">{d.label}</div>
                        <div className={`text-[11px] font-mono mt-0.5 ${selectedDifficulty === i ? 'text-indigo-100/90' : 'text-gray-500'}`}>{d.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Time control — stacks vertically on desktop to fill empty panel space */}
              <div className="flex flex-col lg:flex-1 lg:min-h-0">
                <div className="mb-2.5">
                  <span className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em]">Time Control</span>
                </div>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:flex-1 lg:min-h-0 lg:grid-rows-3">
                  {TIME_CONTROLS.map((tc, i) => (
                    <button
                      key={tc.label}
                      onClick={() => handleTCChange(i)}
                      className={`py-2 text-sm font-mono font-semibold rounded-xl transition-all ring-1 lg:h-full lg:text-5xl lg:font-bold lg:tracking-tight lg:rounded-2xl ${
                        selectedTC === i
                          ? 'bg-gradient-to-br from-indigo-500/90 to-fuchsia-500/90 text-white ring-white/20 shadow-md shadow-indigo-900/30 lg:shadow-lg lg:shadow-indigo-900/50 lg:ring-white/30'
                          : 'bg-white/5 text-gray-200 ring-white/5 hover:bg-white/10 hover:ring-white/10'
                      }`}
                    >
                      {tc.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color selector — computer mode only */}
              {gameMode === 'computer' && (
                <div>
                  <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em] mb-2.5">Play as</div>
                  <div className="flex gap-2">
                    {(['white', 'black'] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setPlayerColor(c)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ring-1 ${
                          playerColor === c
                            ? 'bg-gradient-to-br from-indigo-500/90 to-fuchsia-500/90 text-white ring-white/20 shadow-md shadow-indigo-900/30'
                            : 'bg-white/5 text-gray-200 ring-white/5 hover:bg-white/10 hover:ring-white/10'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full ${c === 'white' ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-gray-900 border border-gray-400'}`} />
                        <span className="capitalize">{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleStartGame}
                className="btn-primary w-full py-3 rounded-xl text-sm tracking-tight"
              >
                Start Game
              </button>
              </>}
            </div>
          )}

          {/* Matchmaking panel */}
          {gameState === 'matching' && (
            <div className="glass rounded-2xl p-7 flex flex-col items-center gap-5 text-center">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 opacity-25 blur-xl animate-pulse" />
                <div className="absolute inset-2 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" style={{ animationDuration: '1.2s' }} />
                <div className="relative w-2 h-2 rounded-full bg-indigo-300 shadow-[0_0_10px_rgba(165,180,252,1)]" />
              </div>
              <div>
                <div className="text-white font-semibold text-base mb-1.5 tracking-tight">Looking for a human opponent…</div>
                <div className="flex items-center justify-center gap-1.5 text-sm text-gray-300 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  <span>{onlineCount} player{onlineCount !== 1 ? 's' : ''} online</span>
                </div>
                <div className="text-gray-500 text-sm leading-relaxed">
                  If this takes too long, try playing against the computer.
                </div>
              </div>
              <button
                onClick={() => { speedPair.leavePool(); setGameState('idle') }}
                className="text-sm text-gray-500 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* In-game panel */}
          {gameState === 'playing' && (
            <div className="glass rounded-2xl p-4 flex flex-col gap-3">
              {!computerThinking && (
                <div className="flex items-center gap-2.5 px-1">
                  <div className={`w-2.5 h-2.5 rounded-full ${game.turn() === 'w' ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-gray-300'}`} />
                  <span className="text-gray-200 text-sm font-semibold tracking-tight">
                    {game.turn() === 'w' ? "White to move" : "Black to move"}
                  </span>
                </div>
              )}
              <button
                onClick={async () => {
                  if (gameMode === 'speed-pair') {
                    await speedPair.resignGame()
                    applySpeedPairResult('loss')
                  }
                  setGameOverMsg('You resigned.')
                  clock.stop()
                  stopEval()
                  triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, gameMode === 'speed-pair' ? (speedPair.match?.myColor ?? 'white') : playerColor)
                }}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-gray-200 hover:text-white text-sm font-semibold rounded-xl transition-all"
              >
                Resign / New Game
              </button>
            </div>
          )}

          {gameState === 'analyzing' && (
            <div className="glass rounded-2xl p-6 text-center">
              <div className="text-white font-bold text-lg mb-1 tracking-tight">{gameOverMsg}</div>
              <div className="text-gray-400 text-sm mb-5">Analyzing with Stockfish…</div>
              <div className="w-full bg-white/5 rounded-full h-1.5 mb-3 overflow-hidden ring-1 ring-white/5">
                <div
                  className="h-1.5 rounded-full transition-all duration-300 bg-gradient-to-r from-indigo-500 to-fuchsia-500 shadow-[0_0_10px_rgba(139,92,246,0.8)]"
                  style={{
                    width: analysisProgress.total
                      ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="text-gray-500 text-xs font-mono">
                {analysisProgress.current} / {analysisProgress.total} positions
              </div>
            </div>
          )}

          {gameState === 'analyzed' && analysisResult && (
            <>
              {gameOverMsg && (
                <div className="glass rounded-2xl px-4 py-3 text-center">
                  <span className="text-white font-bold text-base tracking-tight">{gameOverMsg}</span>
                  {ratingChange && (
                    <div className="mt-1.5 text-xs font-mono tabular-nums flex items-center justify-center gap-1.5">
                      <span className="text-gray-500">Rating</span>
                      <span className={`${ratingChange.delta > 0 ? 'text-emerald-300' : ratingChange.delta < 0 ? 'text-red-300' : 'text-gray-300'} font-semibold`}>
                        {ratingChange.delta > 0 ? '+' : ''}{ratingChange.delta}
                      </span>
                      <span className="text-gray-500">→</span>
                      <span className="text-indigo-300 font-semibold">{ratingChange.next}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-2xl p-4 flex gap-3 items-start bg-gradient-to-br from-indigo-500/10 to-fuchsia-500/10 ring-1 ring-indigo-400/20 backdrop-blur">
                <span className="text-indigo-300 text-base mt-0.5 shrink-0">💡</span>
                <p className="text-sm text-indigo-100/90 leading-relaxed">
                  We're showing your first mistake so you can learn from it. Click any move to see Stockfish's take.
                </p>
              </div>
              <Analysis
                result={analysisResult}
                onPlayAgain={handlePlayAgain}
                onBackToMenu={handleNewGame}
                playAgainLabel={gameMode === 'speed-pair' ? 'New Opponent' : 'Play Again'}
                onMoveClick={setReviewMoveIndex}
                selectedMoveIndex={reviewMoveIndex}
              />
            </>
          )}
        </div>
      </div>

      {authModal && (
        <AuthModal auth={auth} onClose={() => setAuthModal(null)} initialMode={authModal} />
      )}
    </div>
  )
}
