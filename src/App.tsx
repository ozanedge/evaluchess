import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
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
import MoveArrows from './components/MoveArrows'
import type { MoveFeedback } from './utils/moveFeedback'
import { moveFeedback, MOVE_COLORS } from './utils/moveFeedback'
import AuthModal from './components/AuthModal'
import UserBadge from './components/UserBadge'
import GameSettings from './components/GameSettings'
import { boardAppearance } from './components/boardAppearance'
import { readSettings, SETTINGS_KEY } from './lib/settings'
import type { PlayerSettings } from './lib/settings'
import { useGameSounds } from './hooks/useGameSounds'
import Leaderboard from './components/Leaderboard'
import GameLibrary from './components/GameLibrary'
import MistakePractice from './components/MistakePractice'
import { useAuth } from './hooks/useAuth'
import { reconstruct, readLibrary, saveGame, clearActive } from './lib/library'
import { TIME_CONTROL as tc } from './lib/gameRules'
import type { SavedGame } from './lib/library'
import type { LiveEval } from './hooks/usePositionEval'

type GameState = 'idle' | 'matching' | 'playing' | 'analyzing' | 'analyzed' | 'analysis-error'

function buildMoveMetrics(
  source: string,
  gameMode: string,
  moveNumber: number,
  moveTimeMs: number,
  clockRemainingMs: number,
  evalScore: number | null,
  evalDepth: number | null,
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

export default function App() {
  const [savedActive, setSavedActive] = useState(() => readLibrary().active)
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [storageError, setStorageError] = useState('')
  const [engineError, setEngineError] = useState('')
  const [practice, setPractice] = useState<{ game: SavedGame; ply: number } | null>(null)
  const [settings, setSettings] = useState(readSettings)
  const settingsRef = useRef(settings)
  const [confirmingResignation, setConfirmingResignation] = useState(false)
  const analysisGeneration = useRef(0)
  const computerGeneration = useRef(0)
  const lastSave = useRef(0)
  const [game, setGame] = useState(new Chess())
  const [gameState, setGameState] = useState<GameState>('idle')
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [, setFenHistory] = useState<string[]>([new Chess().fen()])
  const [analysisResult, setAnalysisResult] = useState<GameAnalysisResult | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 })
  const [gameOverMsg, setGameOverMsg] = useState('')
  const [clockEnabled] = useState(true)
  const [gameMode, setGameMode] = useState<'computer' | 'speed-pair'>('speed-pair')
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const [selectedDifficulty, setSelectedDifficulty] = useState(1) // default Enthusiast
  const [liveEval, setLiveEval] = useState<LiveEval | null>(null)
  const [ownArrows, setOwnArrows] = useState<{ feedback: MoveFeedback; id: number } | null>(null)
  const ownFeedbackGeneration = useRef(0)
  const requestedOwnFen = useRef<string | null>(null)
  const [computerThinking, setComputerThinking] = useState(false)
  const [reviewMoveIndex, setReviewMoveIndex] = useState<number | null>(null)
  const [showReviewAnswer, setShowReviewAnswer] = useState(false)
  const [analysisFens, setAnalysisFens] = useState<string[]>([])
  const [moveSquaresHistory, setMoveSquaresHistory] = useState<{ from: string; to: string }[]>([])
  const [analysisPlayerColor, setAnalysisPlayerColor] = useState<'white' | 'black'>('white')

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
  useEffect(() => {
    gameRef.current = game
    computerThinkingRef.current = computerThinking
    gameStateRef.current = gameState
    gameModeRef.current = gameMode
    premoveRef.current = premove
  }, [game, computerThinking, gameState, gameMode, premove, sessionId])

  const clock = useChessClock(tc.seconds, tc.increment)
  const unlockSound = useGameSounds({
    enabled: settings.sound,
    sessionId,
    playing: gameState === 'playing',
    moves: moveHistory,
    ownTime: playerColor === 'white' ? clock.timeWhite : clock.timeBlack,
    ownClockActive: clock.activeColor === playerColor,
  })
  function updateSettings(patch: Partial<PlayerSettings>) {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    if (patch.sound) unlockSound()
    if (patch.premoves === false) {
      premoveRef.current = null
      setPremove(null)
      setSelectedSquare(null)
      setLegalMoveSquares(new Set())
    }
    if (patch.moveFeedback === false) clearOwnArrows()
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // Preferences still apply for this session when browser storage is unavailable.
    }
  }
  const { analyzeGame, destroy } = useStockfish()
  const {
    evaluate: evalPosition,
    stop: stopEval,
    error: liveEvalError,
  } = usePositionEval((ev) => {
    liveEvalRef.current = ev
    setLiveEval(ev)
  })
  function clearOwnArrows() {
    ownFeedbackGeneration.current++
    setOwnArrows(null)
  }
  function evaluateCurrentPosition(fen: string, color = playerColor) {
    const moves = moveHistoryRef.current
    const fens = fenHistoryRef.current
    const ownPly = moves.length - (moves.length % 2 === (color === 'white' ? 1 : 0) ? 0 : 1)
    // A snapshot may include both our move and the opponent's reply.
    if (ownPly > 0 && requestedOwnFen.current !== fens[ownPly]) {
      requestedOwnFen.current = fens[ownPly]
      clearOwnArrows()
      const id = ownFeedbackGeneration.current
      void evalPosition(fens[ownPly], {
        fen: fens[ownPly - 1],
        move: moves[ownPly - 1],
        onFeedback: (feedback) => {
          if (id === ownFeedbackGeneration.current && settingsRef.current.moveFeedback)
            setOwnArrows({ feedback, id })
        },
      })
      if (ownPly === moves.length) return
    }
    const previousFen = fens[moves.length - 1]
    return evalPosition(
      fen,
      moves.length && previousFen ? { fen: previousFen, move: moves[moves.length - 1] } : undefined
    )
  }
  const { getMove: getComputerMove, cancel: cancelComputer } = useComputerMove()
  const speedPair = useSpeedPair()
  const auth = useAuth()
  const onlineCount = useOnlineCount(auth.profile?.username)
  const [authModal, setAuthModal] = useState<null | 'signin' | 'signup'>(null)
  const [menuView, setMenuView] = useState<'speed-pair' | 'computer' | 'leaderboard' | 'library'>(
    'speed-pair'
  )
  const [ratingChange, setRatingChange] = useState<{ delta: number; next: number } | null>(null)
  useEffect(() => () => destroy(), [destroy])

  // After analysis completes, jump to first mistake or blunder by the player
  useEffect(() => {
    if (gameState === 'analyzed' && analysisResult) {
      const firstError = analysisResult.moves.findIndex(
        (m) =>
          m.player === analysisPlayerColor &&
          (m.classification === 'mistake' || m.classification === 'blunder')
      )
      setShowReviewAnswer(false)
      if (firstError !== -1) setReviewMoveIndex(firstError)
    }
  }, [gameState, analysisResult, analysisPlayerColor])

  // Update eval bar when reviewing moves after game
  useEffect(() => {
    if (reviewMoveIndex === null || !analysisResult) return
    const ev = analysisResult.moves[reviewMoveIndex]?.evalBefore
    if (ev) {
      const sign = reviewMoveIndex % 2 === 0 ? 1 : -1
      setLiveEval({
        score: ev.score * sign,
        mate: ev.mate === null ? null : ev.mate * sign,
        depth: 0,
      })
    }
  }, [reviewMoveIndex, analysisResult])

  // Online results and clocks come only from the server.
  useEffect(() => {
    if (clock.flagged && gameState === 'playing' && gameMode === 'computer') {
      setGameOverMsg(`${clock.flagged === 'white' ? 'Black' : 'White'} wins on time!`)
      clock.stop()
      triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, playerColor)
    }
  }, [clock.flagged]) // eslint-disable-line react-hooks/exhaustive-deps

  const checkGameOver = useCallback((g: Chess): string => {
    if (g.isCheckmate()) return `Checkmate! ${g.turn() === 'w' ? 'Black' : 'White'} wins.`
    if (g.isStalemate()) return 'Stalemate — Draw'
    if (g.isThreefoldRepetition()) return 'Draw by repetition'
    if (g.isInsufficientMaterial()) return 'Draw — Insufficient material'
    if (g.isDraw()) return 'Draw'
    return ''
  }, [])

  const computerColor = playerColor === 'white' ? 'black' : 'white'

  useEffect(() => {
    if (speedPair.status === 'matched' && speedPair.match && gameState === 'matching') {
      setPlayerColor(speedPair.match.myColor)
      setGameState('playing')
    }
  }, [speedPair.status, speedPair.match, gameState])

  useEffect(() => {
    const snapshot = speedPair.game
    if (!snapshot || gameMode !== 'speed-pair' || gameStateRef.current !== 'playing') return
    const restored = reconstruct(snapshot.moves)
    const changed =
      restored.game.fen() !== gameRef.current.fen() ||
      snapshot.moves.length !== moveHistoryRef.current.length
    gameRef.current = restored.game
    fenHistoryRef.current = restored.fens
    moveHistoryRef.current = snapshot.moves
    moveSquaresHistoryRef.current = restored.squares
    if (changed) {
      setGame(restored.game)
      setMoveHistory(snapshot.moves)
      setFenHistory(restored.fens)
      setMoveSquaresHistory(restored.squares)
      evaluateCurrentPosition(restored.game.fen())
    }
    clock.sync(
      snapshot.clocks.whiteMs,
      snapshot.clocks.blackMs,
      snapshot.result ? null : restored.game.turn() === 'w' ? 'white' : 'black'
    )
    if (snapshot.result) {
      window.dispatchEvent(new Event('evaluchess-result'))
      const rating = snapshot.ratings?.[speedPair.match!.myColor]
      if (rating) setRatingChange({ delta: rating.after - rating.before, next: rating.after })
      const { winner, reason } = snapshot.result
      setGameOverMsg(
        winner
          ? `${winner === 'white' ? 'White' : 'Black'} wins by ${reason}.`
          : `Draw (${reason}).`
      )
      triggerAnalysis(restored.fens, snapshot.moves, speedPair.match!.myColor)
    } else if (changed && restored.game.turn() === playerColor[0]) tryPremove()
  }, [speedPair.game, gameState]) // eslint-disable-line react-hooks/exhaustive-deps

  function tryPremove() {
    const pm = premoveRef.current
    if (!pm || !settingsRef.current.premoves) return
    premoveRef.current = null
    setPremove(null)
    try {
      const gameCopy = reconstruct(moveHistoryRef.current).game
      const move = gameCopy.move({
        from: pm.from,
        to: pm.to,
        promotion: settingsRef.current.promotion,
      })
      if (!move) return
      clearOwnArrows()
      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      if (gameModeRef.current === 'speed-pair') {
        void speedPair.sendMove(move.san)
        return
      }
      const newFenHistory = [...fenHistoryRef.current, gameCopy.fen()]
      const newMoveHistory = [...moveHistoryRef.current, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistoryRef.current, { from: pm.from, to: pm.to }]
      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory
      // Capture local authoritative remaining time BEFORE onMove swaps the clock,
      // so the value we report to the opponent matches what we just saw.
      setGame(gameCopy)
      setFenHistory(newFenHistory)
      setMoveHistory(newMoveHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)
      if (clockEnabled) clock.onMove(movedColor)

      evaluateCurrentPosition(gameCopy.fen())

      const _preMoveTimeMs = lastMoveTimestampRef.current
        ? Date.now() - lastMoveTimestampRef.current
        : 0
      lastMoveTimestampRef.current = Date.now()
      const _preClockMs = clockEnabled
        ? playerColor === 'white'
          ? clock.timeWhite
          : clock.timeBlack
        : 0
      clientLog('info', 'client move played', {
        san: move.san,
        fen: gameCopy.fen(),
        moveNumber: newMoveHistory.length,
        source: 'premove',
        gameMode: gameModeRef.current,
        moveTimeMs: _preMoveTimeMs,
        clockRemainingMs: _preClockMs,

        ...(liveEvalRef.current
          ? {
              evalCp: liveEvalRef.current.score,
              evalDepth: liveEvalRef.current.depth,
              ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}),
            }
          : {}),
      })
      clientMetric(
        buildMoveMetrics(
          'premove',
          gameModeRef.current,
          newMoveHistory.length,
          _preMoveTimeMs,
          _preClockMs,
          liveEvalRef.current?.score ?? null,
          liveEvalRef.current?.depth ?? null,
          {}
        )
      )
      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()

        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else if (gameModeRef.current === 'computer') {
        triggerComputerMove(gameCopy.fen())
      }
    } catch {
      /* premove was illegal — silently discard */
    }
  }

  async function triggerComputerMove(fen: string) {
    const run = ++computerGeneration.current
    setEngineError('')
    setComputerThinking(true)
    try {
      const uciMove = await getComputerMove(fen, DIFFICULTIES[selectedDifficulty].elo)
      if (
        run !== computerGeneration.current ||
        gameStateRef.current !== 'playing' ||
        gameRef.current.fen() !== fen
      )
        return
      const from = uciMove.substring(0, 2)
      const to = uciMove.substring(2, 4)
      const promotion = uciMove[4] || 'q'

      const g = reconstruct(moveHistoryRef.current).game
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

      evaluateCurrentPosition(g.fen())
      const _compMoveTimeMs = lastMoveTimestampRef.current
        ? Date.now() - lastMoveTimestampRef.current
        : 0
      lastMoveTimestampRef.current = Date.now()
      const _compClockMs = clockEnabled
        ? playerColor === 'white'
          ? clock.timeBlack
          : clock.timeWhite
        : 0
      clientLog('info', 'client move played', {
        san: move.san,
        fen: g.fen(),
        moveNumber: newMoveHistory.length,
        source: 'computer',
        gameMode: 'computer',
        elo: DIFFICULTIES[selectedDifficulty].elo,
        moveTimeMs: _compMoveTimeMs,
        clockRemainingMs: _compClockMs,
        ...(liveEvalRef.current
          ? {
              evalCp: liveEvalRef.current.score,
              evalDepth: liveEvalRef.current.depth,
              ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}),
            }
          : {}),
      })
      clientMetric(
        buildMoveMetrics(
          'computer',
          'computer',
          newMoveHistory.length,
          _compMoveTimeMs,
          _compClockMs,
          liveEvalRef.current?.score ?? null,
          liveEvalRef.current?.depth ?? null,
          { elo: DIFFICULTIES[selectedDifficulty].elo }
        )
      )

      const overMsg = checkGameOver(g)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
      } else {
        tryPremove()
      }
    } catch (e) {
      if (run === computerGeneration.current) {
        clock.stop()
        setEngineError((e as Error).message)
      }
    } finally {
      if (run === computerGeneration.current) setComputerThinking(false)
    }
  }

  function handleStartGame() {
    setEngineError('')
    gameStateRef.current = gameMode === 'computer' ? 'playing' : 'matching'
    if (gameMode === 'speed-pair') {
      setGameState('matching')
      speedPair.joinPool(
        tc.label,
        auth.user && auth.profile
          ? {
              username: auth.profile.username,
              elo: auth.profile.elo,
            }
          : undefined
      )
      return
    }
    setGameState('playing')
    if (clockEnabled) clock.start()
    liveEvalRef.current = null
    setLiveEval(null)
    evaluateCurrentPosition(new Chess().fen())
    // If playing vs computer and player chose black, computer (white) goes first
    if (gameMode === 'computer' && playerColor === 'black') {
      triggerComputerMove(new Chess().fen())
    }
  }

  function onDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: unknown
    sourceSquare: string
    targetSquare: string | null
  }) {
    const currentGame = gameRef.current
    const currentMode = gameModeRef.current
    if (gameStateRef.current !== 'playing') return false
    if (!targetSquare) return false

    const isOpponentTurn =
      (currentMode === 'computer' &&
        (currentGame.turn() === 'w') === (computerColor === 'white')) ||
      (currentMode === 'speed-pair' && (currentGame.turn() === 'w') !== (playerColor === 'white'))

    // During opponent's turn — save as premove if it's the player's own piece
    if (isOpponentTurn || computerThinkingRef.current) {
      if (!settingsRef.current.premoves) return false
      const piece = currentGame.get(sourceSquare as Parameters<typeof currentGame.get>[0])
      if (!piece) return false
      const isMyPiece = (piece.color === 'w') === (playerColor === 'white')
      if (!isMyPiece) return false
      setPremove({ from: sourceSquare, to: targetSquare })
      return false
    }

    try {
      const gameCopy = reconstruct(moveHistoryRef.current).game
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: settingsRef.current.promotion,
      })
      if (!move) return false
      clearOwnArrows()
      if (currentMode === 'speed-pair') {
        void speedPair.sendMove(move.san)
        return false
      }

      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistoryRef.current, gameCopy.fen()]
      const newMoveHistory = [...moveHistoryRef.current, move.san]
      const newMoveSquaresHistory = [
        ...moveSquaresHistoryRef.current,
        { from: sourceSquare, to: targetSquare },
      ]

      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory

      // Capture remaining time before onMove swaps the active color so the value
      // reported to the opponent matches what the player just saw on their clock.

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

      evaluateCurrentPosition(gameCopy.fen())

      // In Speed Pair, send the move with the mover's authoritative clock reading.

      const _playerMoveTimeMs = lastMoveTimestampRef.current
        ? Date.now() - lastMoveTimestampRef.current
        : 0
      lastMoveTimestampRef.current = Date.now()
      const _playerClockMs = clockEnabled
        ? playerColor === 'white'
          ? clock.timeWhite
          : clock.timeBlack
        : 0
      clientLog('info', 'client move played', {
        san: move.san,
        fen: gameCopy.fen(),
        moveNumber: newMoveHistory.length,
        source: 'player',
        gameMode,
        moveTimeMs: _playerMoveTimeMs,
        clockRemainingMs: _playerClockMs,
        ...(gameMode === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}),
        ...(liveEvalRef.current
          ? {
              evalCp: liveEvalRef.current.score,
              evalDepth: liveEvalRef.current.depth,
              ...(liveEvalRef.current.mate !== null ? { evalMate: liveEvalRef.current.mate } : {}),
            }
          : {}),
      })
      clientMetric(
        buildMoveMetrics(
          'player',
          gameMode,
          newMoveHistory.length,
          _playerMoveTimeMs,
          _playerClockMs,
          liveEvalRef.current?.score ?? null,
          liveEvalRef.current?.depth ?? null,
          gameMode === 'speed-pair' && speedPair.match ? { gameId: speedPair.match.gameId } : {}
        )
      )

      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()

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
      (currentMode === 'computer' &&
        (currentGame.turn() === 'w') === (computerColor === 'white')) ||
      (currentMode === 'speed-pair' && (currentGame.turn() === 'w') !== (playerColor === 'white'))

    // During opponent's turn: handle premove clicks
    if (isOpponentTurn || computerThinkingRef.current) {
      if (!settingsRef.current.premoves) return
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
      const moves = currentGame.moves({
        square: square as Parameters<typeof currentGame.moves>[0] extends { square?: infer S }
          ? S
          : never,
        verbose: true,
      })
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
      const moves = currentGame.moves({
        square: square as Parameters<typeof currentGame.moves>[0] extends { square?: infer S }
          ? S
          : never,
        verbose: true,
      })
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
    const run = ++analysisGeneration.current
    computerGeneration.current++
    cancelComputer()
    setComputerThinking(false)
    stopEval()
    clock.stop()
    destroy()
    gameStateRef.current = 'analyzing'
    setGameState('analyzing')
    setEngineError('')
    setAnalysisPlayerColor(pColor)
    setAnalysisFens(fens)
    setAnalysisProgress({ current: 0, total: fens.length })
    try {
      const evals = await analyzeGame(fens, (current, total) => {
        if (run === analysisGeneration.current) setAnalysisProgress({ current, total })
      })
      if (run !== analysisGeneration.current) return
      setAnalysisResult(buildAnalysis(moves, evals))
      setGameState('analyzed')
    } catch (e) {
      if (run !== analysisGeneration.current) return
      setEngineError(
        (e as Error).name === 'AbortError'
          ? 'Analysis paused. You can retry whenever you are ready.'
          : (e as Error).message
      )
      setGameState('analysis-error')
    }
  }

  const savedSnapshot = useCallback((): SavedGame => {
    return {
      id: sessionId,
      updatedAt: Date.now(),
      mode: gameMode,
      playerColor,
      moves: moveHistory,
      tc: 1, // Keep the saved-library format: index 1 represents 5+0.
      difficulty: selectedDifficulty,
      whiteMs: clock.timeWhite,
      blackMs: clock.timeBlack,
      result: gameOverMsg,
      analysis: analysisResult,
      ...(speedPair.match && gameMode === 'speed-pair' ? { match: speedPair.match } : {}),
    }
  }, [
    sessionId,
    gameMode,
    playerColor,
    moveHistory,
    selectedDifficulty,
    clock.timeWhite,
    clock.timeBlack,
    gameOverMsg,
    analysisResult,
    speedPair.match,
  ])
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    const save = () => {
      if (['idle', 'matching'].includes(gameState)) return
      try {
        saveGame(savedSnapshot())
        setStorageError('')
      } catch {
        setStorageError(
          'Browser storage is unavailable or full. This game cannot be saved locally.'
        )
      }
    }
    saveRef.current = save
    if (Date.now() - lastSave.current > 1000 || gameState !== 'playing') {
      save()
      lastSave.current = Date.now()
    }
  }, [gameState, savedSnapshot])
  useEffect(() => {
    const save = () => saveRef.current()
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])

  function openSaved(saved: SavedGame) {
    clearOwnArrows()
    requestedOwnFen.current = null
    stopEval()
    setLiveEval(null)
    liveEvalRef.current = null
    destroy()
    cancelComputer()
    analysisGeneration.current++
    computerGeneration.current++
    const restored = reconstruct(saved.moves)
    setSessionId(saved.id)
    setGameMode(saved.mode)
    gameModeRef.current = saved.mode
    setSelectedDifficulty(saved.difficulty)
    setPlayerColor(saved.playerColor)
    setAnalysisPlayerColor(saved.playerColor)
    setGame(restored.game)
    gameRef.current = restored.game
    setMoveHistory(saved.moves)
    moveHistoryRef.current = saved.moves
    setFenHistory(restored.fens)
    fenHistoryRef.current = restored.fens
    setMoveSquaresHistory(restored.squares)
    moveSquaresHistoryRef.current = restored.squares
    setAnalysisFens(restored.fens)
    setAnalysisResult(saved.analysis)
    setGameOverMsg(saved.result)
    setReviewMoveIndex(null)
    setShowReviewAnswer(false)
    setEngineError('')
    setSavedActive(null)
    if (saved.result) {
      clock.sync(saved.whiteMs, saved.blackMs, null)
      gameStateRef.current = saved.analysis ? 'analyzed' : 'analysis-error'
      setGameState(gameStateRef.current)
      if (!saved.analysis) setEngineError('Your game is saved. Analyze it to review your moves.')
    } else if (saved.mode === 'speed-pair' && saved.match) {
      gameStateRef.current = 'matching'
      setGameState('matching')
      speedPair.resumeMatch(saved.match)
      evaluateCurrentPosition(restored.game.fen(), saved.playerColor)
    } else if (saved.mode === 'computer') {
      gameStateRef.current = 'playing'
      setGameState('playing')
      clock.sync(saved.whiteMs, saved.blackMs, restored.game.turn() === 'w' ? 'white' : 'black')
      evaluateCurrentPosition(restored.game.fen(), saved.playerColor)
      // Defer to an effect below so restored settings are used by the computer.
    } else {
      setGameState('analysis-error')
      setEngineError(
        'This older online session cannot be resumed. You can still analyze its saved moves.'
      )
    }
  }
  useEffect(() => {
    if (
      gameState === 'playing' &&
      gameMode === 'computer' &&
      !computerThinking &&
      game.turn() !== playerColor[0] &&
      !engineError
    )
      void triggerComputerMove(game.fen())
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleNewGame() {
    if (gameMode === 'speed-pair' && !(await speedPair.leavePool())) return
    resetGame()
  }

  function resetGame() {
    setConfirmingResignation(false)
    clearOwnArrows()
    requestedOwnFen.current = null
    destroy()
    cancelComputer()
    analysisGeneration.current++
    computerGeneration.current++
    try {
      clearActive()
    } catch {
      /* storage error is shown above */
    }
    setSavedActive(null)
    setSessionId(crypto.randomUUID())
    setEngineError('')
    setPractice(null)
    gameStateRef.current = 'idle'
    stopEval()
    lastMoveTimestampRef.current = 0
    setRatingChange(null)

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

    setReviewMoveIndex(null)
    setShowReviewAnswer(false)
    setAnalysisFens([])
    setMoveSquaresHistory([])
    setPremove(null)
    setSelectedSquare(null)
    setLegalMoveSquares(new Set())
    setComputerThinking(false)
    setAnalysisPlayerColor('white')
  }

  async function resign() {
    if (gameStateRef.current !== 'playing') return
    setConfirmingResignation(false)
    if (gameMode === 'speed-pair') {
      await speedPair.resignGame()
      return
    }
    setGameOverMsg('You resigned.')
    clock.stop()
    stopEval()
    void triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, playerColor)
  }

  async function handlePlayAgain() {
    // Await leavePool so the server deletes the previous match record before we
    // rejoin. Otherwise /api/join returns the stale match and we instantly see
    // the old "opponent resigned" state.
    if (gameMode === 'speed-pair' && !(await speedPair.leavePool())) return
    resetGame()
    handleStartGame()
  }

  // Board position: show the position BEFORE the reviewed move (so best-move arrow makes sense),
  // or current game position during play.
  const displayFen =
    reviewMoveIndex !== null && analysisFens[reviewMoveIndex]
      ? analysisFens[reviewMoveIndex]
      : game.fen()

  // Last move highlight: during review use that move's squares, otherwise use the latest move
  const lastMoveSquares =
    reviewMoveIndex !== null
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
    const kingSquare = game
      .board()
      .flat()
      .find((p) => p && p.type === 'k' && p.color === game.turn())
    if (kingSquare) squareStyles[kingSquare.square] = { backgroundColor: 'rgba(255,0,0,0.4)' }
  }

  const isPlaying = gameState === 'playing'
  const currentFeedback =
    isPlaying &&
    settings.moveFeedback &&
    liveEval?.feedback?.afterFen === game.fen() &&
    liveEval.feedback.player === playerColor
      ? liveEval.feedback
      : null
  const reviewFeedback = useMemo(() => {
    if (reviewMoveIndex === null || !analysisResult) return null
    const move = analysisResult.moves[reviewMoveIndex]
    const before = analysisFens[reviewMoveIndex],
      after = analysisFens[reviewMoveIndex + 1]
    if (!move || !before || !after) return null
    return moveFeedback(
      before,
      after,
      move.move,
      { ...move.evalBefore, bestMove: move.bestMove },
      move.evalAfter
    )
  }, [reviewMoveIndex, analysisResult, analysisFens])
  const practicePly =
    gameState === 'analyzed' &&
    reviewMoveIndex !== null &&
    analysisResult?.moves[reviewMoveIndex]?.player === playerColor &&
    ['mistake', 'blunder'].includes(analysisResult.moves[reviewMoveIndex].classification)
      ? reviewMoveIndex
      : null
  const boardArrows =
    (reviewMoveIndex === null
      ? isPlaying && settings.moveFeedback
        ? ownArrows?.feedback
        : null
      : practicePly !== null && !showReviewAnswer
        ? null
        : reviewFeedback
    )?.arrows ?? []
  const liveClassification = currentFeedback
    ? {
        label:
          currentFeedback.classification[0].toUpperCase() + currentFeedback.classification.slice(1),
        color: MOVE_COLORS[currentFeedback.classification],
      }
    : null

  return (
    <div className="app-bg min-h-screen flex items-start justify-center p-3 lg:p-8">
      <div className="flex flex-col lg:flex-row gap-5 lg:gap-8 w-full max-w-6xl">
        {/* Board column */}
        <div
          className="flex flex-col gap-2.5 lg:shrink-0"
          style={{ width: boardSize <= 500 ? '100%' : 660 }}
        >
          <div className="relative z-40 flex items-center justify-between mb-1">
            <a
              href="/"
              aria-label="Evaluchess home"
              className="flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400"
            >
              <div className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-900/50 ring-1 ring-white/15">
                <span className="text-xl leading-none text-white drop-shadow-sm">♞</span>
              </div>
              <div className="leading-tight">
                <h1 className="text-xl font-bold tracking-tight gradient-text">Evaluchess</h1>
                <p className="text-[11px] font-medium text-gray-500 tracking-wide">
                  Play · Analyze · Improve
                </p>
              </div>
            </a>
            <UserBadge auth={auth} onlineCount={onlineCount} onOpenAuth={(m) => setAuthModal(m)}>
              <GameSettings settings={settings} onChange={updateSettings} />
            </UserBadge>
          </div>

          {/* Opponent clock (top) */}
          {(() => {
            const opponent = playerColor === 'white' ? 'black' : 'white'
            const oppTimeMs = opponent === 'white' ? clock.timeWhite : clock.timeBlack
            const oppActive = clock.activeColor === opponent && isPlaying
            const oppFlagged = clock.flagged === opponent
            return (
              <div
                className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all duration-200 ${
                  oppActive ? 'glass glow-active' : 'glass-subtle'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full shrink-0 ${opponent === 'white' ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.35)]' : 'bg-gray-900 border-2 border-gray-500'}`}
                  />
                  {(() => {
                    const oppName = speedPair.match?.opponentUsername
                    const oppElo = speedPair.match?.opponentElo
                    return (
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`text-base font-semibold tracking-tight ${oppActive ? 'text-white' : 'text-gray-300'}`}
                        >
                          {gameMode === 'computer'
                            ? `Computer · ${DIFFICULTIES[selectedDifficulty].label}`
                            : oppName
                              ? oppName
                              : opponent === 'white'
                                ? 'White'
                                : 'Black'}
                        </span>
                        {gameMode === 'speed-pair' && speedPair.match?.opponentBot && (
                          <span className="text-xs text-gray-400">Bot</span>
                        )}
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
                        <span
                          className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse"
                          style={{ animationDelay: '180ms' }}
                        />
                        <span
                          className="w-1 h-1 bg-indigo-400 rounded-full dot-pulse"
                          style={{ animationDelay: '360ms' }}
                        />
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

          {/* Board + eval bar */}
          <div className="flex gap-2 items-stretch">
            <EvalBar ev={liveEval} height={boardSize} />
            <div
              className="relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
              style={{
                width: boardSize,
                height: boardSize,
                boxShadow:
                  '0 40px 80px -30px rgba(99, 102, 241, 0.45), 0 0 0 1px rgba(255,255,255,0.08)',
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
                  boardStyle: { borderRadius: '4px' },
                  ...boardAppearance(settings),
                  allowDragging: isPlaying && (settings.premoves || game.turn() === playerColor[0]),
                  showAnimations: false,
                }}
              />
              <MoveArrows
                key={
                  isPlaying ? `arrows-live-${ownArrows?.id}` : `arrows-review-${reviewMoveIndex}`
                }
                arrows={boardArrows}
                orientation={playerColor}
                fade={isPlaying}
              />
            </div>
          </div>

          {/* Player move classification (above player clock) */}
          <div className="h-8 flex items-center justify-center">
            {isPlaying && liveClassification && (
              <span
                data-testid="live-move-classification"
                style={{ color: liveClassification.color }}
                className="text-2xl font-bold tracking-wide [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]"
              >
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
              <div
                className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all duration-200 ${
                  playerActive ? 'glass glow-active' : 'glass-subtle'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full shrink-0 ${playerColor === 'white' ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.35)]' : 'bg-gray-900 border-2 border-gray-500'}`}
                  />
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-base font-semibold tracking-tight ${playerActive ? 'text-white' : 'text-gray-300'}`}
                    >
                      {gameMode === 'speed-pair' && auth.profile
                        ? auth.profile.username
                        : gameMode === 'computer'
                          ? 'You'
                          : playerColor === 'white'
                            ? 'White'
                            : 'Black'}
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
        <div
          className={`w-full lg:flex-1 lg:min-w-64 flex flex-col gap-4 ${
            gameState === 'idle' || gameState === 'matching' ? 'order-first lg:order-none' : ''
          }`}
        >
          {/* Configurator — idle only. Always stretch the panel to match the
              board column's height on desktop. The Start Game button anchors to
              the bottom via mt-auto so the form feels grounded. */}
          {gameState === 'idle' && (
            <div className="glass rounded-2xl p-5 flex flex-col gap-5 lg:flex-1">
              {/* Mode / view selector */}
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 p-1.5 ring-1 ring-white/5">
                {(['speed-pair', 'computer', 'leaderboard', 'library'] as const).map((view) => {
                  const active = menuView === view
                  return (
                    <button
                      key={view}
                      onClick={() => {
                        setMenuView(view)
                        if (view === 'speed-pair' || view === 'computer') setGameMode(view)
                      }}
                      aria-pressed={active}
                      className={`min-w-0 min-h-11 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                        active
                          ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/40'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
                      }`}
                    >
                      {view === 'computer' ? (
                        'Computer'
                      ) : view === 'leaderboard' ? (
                        'Leaderboard'
                      ) : view === 'library' ? (
                        'My games'
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          Speed Pair
                          <span
                            aria-label={`${onlineCount} players online`}
                            className={`shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${active ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}
                          >
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

              {menuView === 'library' && (
                <GameLibrary
                  onOpen={openSaved}
                  onPractice={(game, ply) => setPractice({ game, ply })}
                />
              )}
              {savedActive && menuView !== 'library' && (
                <button
                  className="rounded-xl p-3 bg-white/10 text-left"
                  onClick={() => openSaved(savedActive)}
                >
                  Resume your saved{' '}
                  {savedActive.mode === 'computer' ? 'computer game' : 'online game'}
                </button>
              )}
              {!['leaderboard', 'library'].includes(menuView) && (
                <>
                  {/* Difficulty selector — computer mode only */}
                  {gameMode === 'computer' && (
                    <div>
                      <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em] mb-2.5">
                        Computer Difficulty
                      </div>
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
                            <div
                              className={`text-[11px] font-mono mt-0.5 ${selectedDifficulty === i ? 'text-indigo-100/90' : 'text-gray-500'}`}
                            >
                              {d.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3">
                    <span className="text-lg font-mono font-semibold text-white">{tc.label}</span>
                    <span className="text-xs text-gray-400">
                      5 minutes per player · No increment
                    </span>
                  </div>

                  {/* Color selector — computer mode only */}
                  {gameMode === 'computer' && (
                    <div>
                      <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em] mb-2.5">
                        Play as
                      </div>
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
                            <div
                              className={`w-3 h-3 rounded-full ${c === 'white' ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-gray-900 border border-gray-400'}`}
                            />
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
                </>
              )}
            </div>
          )}

          {/* Matchmaking panel */}
          {gameState === 'matching' && (
            <div className="glass rounded-2xl p-7 flex flex-col items-center gap-5 text-center">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 opacity-25 blur-xl animate-pulse" />
                <div
                  className="absolute inset-2 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin"
                  style={{ animationDuration: '1.2s' }}
                />
                <div className="relative w-2 h-2 rounded-full bg-indigo-300 shadow-[0_0_10px_rgba(165,180,252,1)]" />
              </div>
              <div>
                <div className="text-white font-semibold text-base mb-1.5 tracking-tight">
                  Looking for an opponent…
                </div>
                <div className="flex items-center justify-center gap-1.5 text-sm text-gray-300 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  <span>
                    {onlineCount} player{onlineCount !== 1 ? 's' : ''} online
                  </span>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (await speedPair.leavePool()) setGameState('idle')
                }}
                className="text-sm text-gray-500 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {storageError && (
            <p role="alert" className="p-3 rounded bg-amber-950">
              {storageError}
            </p>
          )}
          {speedPair.error && gameMode === 'speed-pair' && (
            <div role="alert" className="p-3 rounded bg-amber-950">
              <p>{speedPair.error}</p>
              {speedPair.canRetryMove && (
                <button disabled={speedPair.sending} onClick={speedPair.retryMove}>
                  Retry move
                </button>
              )}
            </div>
          )}
          {liveEvalError && gameState === 'playing' && (
            <div role="status" className="p-3 rounded bg-amber-950">
              <p>Live evaluation unavailable.</p>
              <button onClick={() => void evaluateCurrentPosition(game.fen())}>
                Retry evaluation
              </button>
            </div>
          )}
          {engineError && gameState === 'playing' && (
            <div role="alert" className="p-3 rounded bg-amber-950">
              <p>{engineError}</p>
              <button
                onClick={() => {
                  clock.sync(
                    clock.timeWhite,
                    clock.timeBlack,
                    game.turn() === 'w' ? 'white' : 'black'
                  )
                  void triggerComputerMove(game.fen())
                }}
              >
                Retry computer move
              </button>
            </div>
          )}
          {/* In-game panel */}
          {gameState === 'playing' && (
            <div className="glass rounded-2xl p-4 flex flex-col gap-3">
              {gameMode === 'speed-pair' && speedPair.sending && (
                <p role="status">Confirming move…</p>
              )}
              {!computerThinking && (
                <div className="flex items-center gap-2.5 px-1">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${game.turn() === 'w' ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-gray-300'}`}
                  />
                  <span className="text-gray-200 text-sm font-semibold tracking-tight">
                    {game.turn() === 'w' ? 'White to move' : 'Black to move'}
                  </span>
                </div>
              )}
              {confirmingResignation ? (
                <div
                  role="group"
                  aria-label="Confirm resignation"
                  className="space-y-3"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setConfirmingResignation(false)
                  }}
                >
                  <p className="text-sm text-gray-200">Resign this game? Your opponent will win.</p>
                  <div className="flex gap-2">
                    <button
                      autoFocus
                      onClick={() => setConfirmingResignation(false)}
                      className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold"
                    >
                      Keep playing
                    </button>
                    <button
                      onClick={() => void resign()}
                      className="flex-1 rounded-xl bg-red-900 px-3 py-2 text-sm font-semibold"
                    >
                      Resign game
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() =>
                    settings.confirmResignation ? setConfirmingResignation(true) : void resign()
                  }
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-gray-200 hover:text-white text-sm font-semibold rounded-xl transition-all"
                >
                  Resign / New Game
                </button>
              )}
            </div>
          )}

          {gameState === 'analyzing' && (
            <div className="glass rounded-2xl p-6 text-center">
              <div className="text-white font-bold text-lg mb-1 tracking-tight">{gameOverMsg}</div>
              <div className="text-gray-400 text-sm mb-5">Analyzing with Stockfish…</div>
              <button className="px-3 py-2 rounded bg-white/10 mb-3" onClick={() => destroy()}>
                Pause analysis
              </button>
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

          {gameState === 'analysis-error' && (
            <div className="glass rounded-2xl p-4 space-y-3">
              <p role="alert">{engineError}</p>
              <button
                className="btn-primary p-3 rounded-xl"
                onClick={() =>
                  void triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, playerColor)
                }
              >
                Retry analysis
              </button>
              <button className="p-3" onClick={handleNewGame}>
                Back to menu
              </button>
            </div>
          )}
          {gameState === 'analyzed' && analysisResult && (
            <>
              {gameOverMsg && (
                <div className="glass rounded-2xl px-4 py-3 text-center">
                  <span className="text-white font-bold text-base tracking-tight">
                    {gameOverMsg}
                  </span>
                  {ratingChange && (
                    <div className="mt-1.5 text-xs font-mono tabular-nums flex items-center justify-center gap-1.5">
                      <span className="text-gray-500">Rating</span>
                      <span
                        className={`${ratingChange.delta > 0 ? 'text-emerald-300' : ratingChange.delta < 0 ? 'text-red-300' : 'text-gray-300'} font-semibold`}
                      >
                        {ratingChange.delta > 0 ? '+' : ''}
                        {ratingChange.delta}
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
                  {analysisResult.moves.some(
                    (m) =>
                      m.player === playerColor && ['mistake', 'blunder'].includes(m.classification)
                  )
                    ? 'Try your mistake again before revealing the engine’s answer.'
                    : 'No mistakes or blunders found in your moves. Select any move to explore the engine recommendation.'}
                </p>
              </div>
              {practicePly !== null && (
                <>
                  <button
                    className="btn-primary p-3 rounded-xl"
                    onClick={() => {
                      setShowReviewAnswer(false)
                      setPractice({ game: savedSnapshot(), ply: practicePly })
                    }}
                  >
                    Try this position again
                  </button>
                  <button
                    className="text-sm text-gray-400 hover:text-white self-center px-3 py-1"
                    aria-pressed={showReviewAnswer}
                    onClick={() => setShowReviewAnswer((shown) => !shown)}
                  >
                    {showReviewAnswer ? 'Hide answer' : 'Show answer'}
                  </button>
                </>
              )}
              <Analysis
                key={sessionId}
                playerColor={playerColor}
                result={analysisResult}
                onPlayAgain={handlePlayAgain}
                onBackToMenu={handleNewGame}
                playAgainLabel={gameMode === 'speed-pair' ? 'New Opponent' : 'Play Again'}
                onMoveClick={(index) => {
                  setShowReviewAnswer(false)
                  setReviewMoveIndex(index)
                }}
                selectedMoveIndex={reviewMoveIndex}
              />
            </>
          )}
        </div>
      </div>

      {practice && (
        <MistakePractice
          settings={settings}
          key={practice.game.id + ':' + practice.ply}
          game={practice.game}
          ply={practice.ply}
          onClose={() => setPractice(null)}
        />
      )}
      {authModal && (
        <AuthModal auth={auth} onClose={() => setAuthModal(null)} initialMode={authModal} />
      )}
    </div>
  )
}
