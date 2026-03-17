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
import type { GameAnalysisResult } from './utils/analysis'
import Analysis from './components/Analysis'
import ClockDisplay from './components/ClockDisplay'
import EvalBar from './components/EvalBar'
import type { LiveEval } from './hooks/usePositionEval'

type GameState = 'idle' | 'matching' | 'playing' | 'analyzing' | 'analyzed'

const DIFFICULTIES = [
  { label: 'Novice', elo: 800, description: '~800' },
  { label: 'Enthusiast', elo: 1200, description: '~1200' },
  { label: 'Expert', elo: 1800, description: '~1800' },
  { label: 'Master', elo: 2200, description: '~2200' },
]

const TIME_CONTROLS = [
  { label: '1+0', seconds: 60, increment: 0 },
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
  const [selectedTC, setSelectedTC] = useState(2) // default 5+0
  const [clockEnabled, setClockEnabled] = useState(true)
  const [gameMode, setGameMode] = useState<'computer' | 'speed-pair'>('computer')
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const [selectedDifficulty, setSelectedDifficulty] = useState(1) // default Enthusiast
  const [liveEval, setLiveEval] = useState<LiveEval | null>(null)
  const [computerThinking, setComputerThinking] = useState(false)
  const [reviewMoveIndex, setReviewMoveIndex] = useState<number | null>(null)
  const [analysisFens, setAnalysisFens] = useState<string[]>([])
  const [moveSquaresHistory, setMoveSquaresHistory] = useState<{ from: string; to: string }[]>([])
  const [analysisPlayerColor, setAnalysisPlayerColor] = useState<'white' | 'black'>('white')

  // Refs that mirror state so async functions always see current values
  const fenHistoryRef = useRef<string[]>([new Chess().fen()])
  const moveHistoryRef = useRef<string[]>([])
  const moveSquaresHistoryRef = useRef<{ from: string; to: string }[]>([])

  const tc = TIME_CONTROLS[selectedTC]
  const clock = useChessClock(tc.seconds, tc.increment)
  const { analyzeGame, destroy } = useStockfish()
  const { evaluate: evalPosition, stop: stopEval } = usePositionEval((ev) => setLiveEval(ev))
  const { getMove: getComputerMove } = useComputerMove()
  const speedPair = useSpeedPair()
  const onlineCount = useOnlineCount()

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
      triggerAnalysis(fenHistory, moveHistory, gameMode === 'computer' ? playerColor : 'white')
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

  // Ref-based pattern so the effect can always call the latest version of this function
  const applyOpponentMoveRef = useRef<(san: string) => void>(() => {})
  applyOpponentMoveRef.current = (san: string) => {
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
      if (clockEnabled) clock.onMove(movedColor)
      evalPosition(g.fen())
      const overMsg = checkGameOver(g)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
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
      evalPosition(g.fen())

      const overMsg = checkGameOver(g)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory, playerColor)
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
      speedPair.joinPool(tc.label)
      return
    }
    setGameState('playing')
    if (clockEnabled) clock.start()
    // If playing vs computer and player chose black, computer (white) goes first
    if (gameMode === 'computer' && playerColor === 'black') {
      triggerComputerMove(new Chess().fen())
    }
  }

  function onDrop({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) {
    if (gameState !== 'playing' || computerThinking) return false
    // In computer mode, block moves for the computer's color
    if (gameMode === 'computer' && (game.turn() === 'w') === (computerColor === 'white')) return false
    // In speed-pair mode, block moves when it's the opponent's turn
    if (gameMode === 'speed-pair' && ((game.turn() === 'w') !== (playerColor === 'white'))) return false
    if (!targetSquare) return false

    try {
      const gameCopy = new Chess(game.fen())
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false

      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistory, gameCopy.fen()]
      const newMoveHistory = [...moveHistory, move.san]
      const newMoveSquaresHistory = [...moveSquaresHistory, { from: sourceSquare, to: targetSquare }]

      fenHistoryRef.current = newFenHistory
      moveHistoryRef.current = newMoveHistory
      moveSquaresHistoryRef.current = newMoveSquaresHistory

      setGame(gameCopy)
      setMoveHistory(newMoveHistory)
      setFenHistory(newFenHistory)
      setMoveSquaresHistory(newMoveSquaresHistory)

      // Switch clock after move
      if (clockEnabled) clock.onMove(movedColor)

      // Update live eval
      evalPosition(gameCopy.fen())

      // In Speed Pair, send the move to Firebase
      if (gameMode === 'speed-pair') speedPair.sendMove(move.san)

      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory, gameMode === 'computer' ? playerColor : 'white')
      } else if (gameMode === 'computer') {
        triggerComputerMove(gameCopy.fen())
      }

      return true
    } catch {
      return false
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
    setReviewMoveIndex(null)
    setAnalysisFens([])
    setMoveSquaresHistory([])
    setComputerThinking(false)
    setAnalysisPlayerColor('white')
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

  if (reviewMoveIndex === null && game.inCheck()) {
    const kingSquare = game.board().flat().find(
      (p) => p && p.type === 'k' && p.color === game.turn()
    )
    if (kingSquare) squareStyles[kingSquare.square] = { backgroundColor: 'rgba(255,0,0,0.4)' }
  }

  // Arrows: green for best move, red for the actual move played (when reviewing)
  const reviewArrows = (() => {
    if (reviewMoveIndex === null || !analysisResult) return []
    const arrows = []
    const uci = analysisResult.moves[reviewMoveIndex]?.bestMove
    if (uci && uci.length >= 4) {
      arrows.push({ startSquare: uci.substring(0, 2), endSquare: uci.substring(2, 4), color: 'rgba(16, 185, 129, 0.85)' })
    }
    const played = moveSquaresHistory[reviewMoveIndex]
    if (played) {
      arrows.push({ startSquare: played.from, endSquare: played.to, color: 'rgba(239, 68, 68, 0.85)' })
    }
    return arrows
  })()

  const isPlaying = gameState === 'playing'

  return (
    <div className="min-h-screen bg-gray-950 flex items-start justify-center p-6">
      <div className="flex gap-6 w-full max-w-6xl">
        {/* Board column */}
        <div className="flex flex-col gap-2 shrink-0" style={{ width: 660 }}>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-2xl leading-none">♟</span>
            <h1 className="text-xl font-bold text-white tracking-tight">Evaluchess</h1>
          </div>

          {/* Opponent clock (top) */}
          {(() => {
            const opponent = playerColor === 'white' ? 'black' : 'white'
            const oppTimeMs = opponent === 'white' ? clock.timeWhite : clock.timeBlack
            const oppActive = clock.activeColor === opponent && isPlaying
            const oppFlagged = clock.flagged === opponent
            return (
              <div className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors ${
                oppActive ? 'bg-gray-800 border-gray-700' : 'bg-gray-800/40 border-gray-700/30'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full shrink-0 ${opponent === 'white' ? 'bg-white shadow-sm' : 'bg-gray-950 border-2 border-gray-500'}`} />
                  <div>
                    <span className={`text-sm font-semibold ${oppActive ? 'text-white' : 'text-gray-500'}`}>
                      {gameMode === 'computer' ? `Computer · ${DIFFICULTIES[selectedDifficulty].label}` : opponent === 'white' ? 'White' : 'Black'}
                    </span>
                  </div>
                  {computerThinking && (
                    <span className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                      thinking…
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
            <EvalBar ev={liveEval} height={600} />
            <div className="rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5" style={{ width: 600, height: 600 }}>
              <Chessboard
                key={reviewMoveIndex !== null ? `review-${reviewMoveIndex}` : 'game'}
                options={{
                  position: displayFen,
                  boardOrientation: playerColor,
                  onPieceDrop: isPlaying ? onDrop : undefined,
                  squareStyles,
                  arrows: reviewArrows,
                  boardStyle: { borderRadius: '4px' },
                  darkSquareStyle: { backgroundColor: '#769656' },
                  lightSquareStyle: { backgroundColor: '#eeeed2' },
                  showAnimations: false,
                }}
              />
            </div>
          </div>

          {/* Player clock (bottom) */}
          {(() => {
            const playerTimeMs = playerColor === 'white' ? clock.timeWhite : clock.timeBlack
            const playerActive = clock.activeColor === playerColor && isPlaying
            const playerFlagged = clock.flagged === playerColor
            return (
              <div className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors ${
                playerActive ? 'bg-gray-800 border-gray-700' : 'bg-gray-800/40 border-gray-700/30'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full shrink-0 ${playerColor === 'white' ? 'bg-white shadow-sm' : 'bg-gray-950 border-2 border-gray-500'}`} />
                  <span className={`text-sm font-semibold ${playerActive ? 'text-white' : 'text-gray-500'}`}>
                    {gameMode === 'computer' ? 'You' : playerColor === 'white' ? 'White' : 'Black'}
                  </span>
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

          {/* Move list */}
          {moveHistory.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/40">
              <div className="text-gray-500 text-xs font-medium uppercase tracking-widest mb-2">Moves</div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {moveHistory.map((move, i) => (
                  <span key={i} className="text-sm font-mono">
                    {i % 2 === 0 && (
                      <span className="text-gray-500 mr-1">{Math.floor(i / 2) + 1}.</span>
                    )}
                    <span className="text-white">{move} </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="flex-1 min-w-64 flex flex-col gap-4">
          {/* Configurator — idle only */}
          {gameState === 'idle' && (
            <div className="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex flex-col gap-4">
              {/* Mode selector */}
              <div className="flex gap-1 bg-gray-900 p-1 rounded-lg">
                {(['computer', 'speed-pair'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setGameMode(mode)}
                    className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
                      gameMode === mode
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {mode === 'computer' ? 'Computer' : (
                      <span className="flex items-center justify-center gap-1.5">
                        Speed Pair
                        <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-normal ${gameMode === mode ? 'bg-indigo-500/60 text-indigo-100' : 'bg-gray-700 text-gray-400'}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                          {onlineCount}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Difficulty selector — computer mode only */}
              {gameMode === 'computer' && (
                <div>
                  <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Computer Difficulty</div>
                  <div className="grid grid-cols-2 gap-1">
                    {DIFFICULTIES.map((d, i) => (
                      <button
                        key={d.label}
                        onClick={() => setSelectedDifficulty(i)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors text-left ${
                          selectedDifficulty === i
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        <div>{d.label}</div>
                        <div className={`text-xs ${selectedDifficulty === i ? 'text-indigo-200' : 'text-gray-500'}`}>{d.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Time control */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Time Control</span>
                  <button
                    onClick={() => setClockEnabled((e) => !e)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors ${
                      clockEnabled ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {clockEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {TIME_CONTROLS.map((tc, i) => (
                    <button
                      key={tc.label}
                      onClick={() => handleTCChange(i)}
                      className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${
                        selectedTC === i
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
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
                  <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Play as</div>
                  <div className="flex gap-2">
                    {(['white', 'black'] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setPlayerColor(c)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                          playerColor === c
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded-full ${c === 'white' ? 'bg-white' : 'bg-gray-900 border border-gray-400'}`} />
                        <span className="capitalize">{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleStartGame}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors"
              >
                Start Game
              </button>
            </div>
          )}

          {/* Matchmaking panel */}
          {gameState === 'matching' && (
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl p-6 flex flex-col items-center gap-4 text-center">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '200ms' }} />
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '400ms' }} />
              </div>
              <div>
                <div className="text-white font-semibold text-base mb-1">Looking for a human opponent…</div>
                <div className="flex items-center justify-center gap-1.5 text-sm text-gray-400 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  <span>{onlineCount} player{onlineCount !== 1 ? 's' : ''} online</span>
                </div>
                <div className="text-gray-400 text-sm leading-relaxed">
                  If this takes too long, try playing against the computer.
                </div>
              </div>
              <button
                onClick={() => { speedPair.leavePool(); setGameState('idle') }}
                className="text-sm text-gray-500 hover:text-gray-300 underline transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* In-game panel */}
          {gameState === 'playing' && (
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl p-4 flex flex-col gap-3">
              {!computerThinking && (
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${game.turn() === 'w' ? 'bg-white' : 'bg-gray-400'}`} />
                  <span className="text-gray-300 text-sm font-medium">
                    {game.turn() === 'w' ? "White to move" : "Black to move"}
                  </span>
                </div>
              )}
              <button
                onClick={async () => {
                  if (gameMode === 'speed-pair') {
                    await speedPair.resignGame()
                    setGameOverMsg('You resigned.')
                    clock.stop()
                    stopEval()
                    triggerAnalysis(fenHistoryRef.current, moveHistoryRef.current, speedPair.match?.myColor ?? 'white')
                  } else {
                    handleNewGame()
                  }
                }}
                className="w-full py-2 bg-gray-700/80 hover:bg-gray-700 border border-gray-600/50 text-gray-300 hover:text-white text-sm font-medium rounded-lg transition-colors"
              >
                Resign / New Game
              </button>
            </div>
          )}

          {gameState === 'analyzing' && (
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl p-6 text-center">
              <div className="text-white font-bold text-lg mb-1">{gameOverMsg}</div>
              <div className="text-gray-400 text-sm mb-5">Analyzing with Stockfish…</div>
              <div className="w-full bg-gray-700/60 rounded-full h-1.5 mb-3 overflow-hidden">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: analysisProgress.total
                      ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="text-gray-600 text-xs">
                {analysisProgress.current} / {analysisProgress.total} positions
              </div>
            </div>
          )}

          {gameState === 'analyzed' && analysisResult && (
            <>
              {gameOverMsg && (
                <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl px-4 py-3 text-center">
                  <span className="text-white font-bold text-base">{gameOverMsg}</span>
                </div>
              )}
              <div className="bg-indigo-950/60 border border-indigo-800/60 rounded-xl p-3.5 flex gap-3 items-start">
                <span className="text-indigo-400 text-base mt-0.5 shrink-0">💡</span>
                <p className="text-sm text-indigo-200/90 leading-relaxed">
                  We're now showing your first mistake in this game so you can learn from it. Feel free to look through your other moves to see their accuracy.
                </p>
              </div>
              <Analysis
                result={analysisResult}
                onNewGame={handleNewGame}
                onMoveClick={setReviewMoveIndex}
                selectedMoveIndex={reviewMoveIndex}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
