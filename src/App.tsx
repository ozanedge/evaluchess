import { useState, useCallback, useEffect } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { useStockfish } from './hooks/useStockfish'
import { useChessClock } from './hooks/useChessClock'
import { usePositionEval } from './hooks/usePositionEval'
import { buildAnalysis } from './utils/analysis'
import type { GameAnalysisResult } from './utils/analysis'
import Analysis from './components/Analysis'
import ClockDisplay from './components/ClockDisplay'
import EvalBar from './components/EvalBar'
import type { LiveEval } from './hooks/usePositionEval'

type GameState = 'idle' | 'playing' | 'analyzing' | 'analyzed'

const TIME_CONTROLS = [
  { label: '1+0', seconds: 60, increment: 0 },
  { label: '2+1', seconds: 120, increment: 1 },
  { label: '3+0', seconds: 180, increment: 0 },
  { label: '3+2', seconds: 180, increment: 2 },
  { label: '5+0', seconds: 300, increment: 0 },
  { label: '5+3', seconds: 300, increment: 3 },
  { label: '10+0', seconds: 600, increment: 0 },
  { label: '10+5', seconds: 600, increment: 5 },
  { label: '15+10', seconds: 900, increment: 10 },
  { label: '30+0', seconds: 1800, increment: 0 },
]

export default function App() {
  const [game, setGame] = useState(new Chess())
  const [gameState, setGameState] = useState<GameState>('idle')
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()])
  const [analysisResult, setAnalysisResult] = useState<GameAnalysisResult | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 })
  const [gameOverMsg, setGameOverMsg] = useState('')
  const [selectedTC, setSelectedTC] = useState(4) // default 5+0
  const [clockEnabled, setClockEnabled] = useState(true)
  const [liveEval, setLiveEval] = useState<LiveEval | null>(null)
  const [reviewMoveIndex, setReviewMoveIndex] = useState<number | null>(null)
  const [analysisFens, setAnalysisFens] = useState<string[]>([])
  const [moveSquaresHistory, setMoveSquaresHistory] = useState<{ from: string; to: string }[]>([])

  const tc = TIME_CONTROLS[selectedTC]
  const clock = useChessClock(tc.seconds, tc.increment)
  const { analyzeGame, destroy } = useStockfish()
  const { evaluate: evalPosition, stop: stopEval } = usePositionEval((ev) => setLiveEval(ev))

  useEffect(() => () => destroy(), [destroy])

  // After analysis completes, jump to first blunder
  useEffect(() => {
    if (gameState === 'analyzed' && analysisResult) {
      const firstBlunder = analysisResult.moves.findIndex((m) => m.classification === 'blunder')
      if (firstBlunder !== -1) setReviewMoveIndex(firstBlunder)
    }
  }, [gameState, analysisResult])

  // Handle flag (timeout)
  useEffect(() => {
    if (clock.flagged && gameState === 'playing') {
      const winner = clock.flagged === 'white' ? 'Black' : 'White'
      const msg = `${winner} wins on time!`
      setGameOverMsg(msg)
      clock.stop()
      triggerAnalysis(fenHistory, moveHistory)
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

  function onDrop({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) {
    if (gameState !== 'playing' && gameState !== 'idle') return false
    if (!targetSquare) return false

    try {
      const gameCopy = new Chess(game.fen())
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false

      const movedColor: 'white' | 'black' = move.color === 'w' ? 'white' : 'black'
      const newFenHistory = [...fenHistory, gameCopy.fen()]
      const newMoveHistory = [...moveHistory, move.san]

      setGame(gameCopy)
      setMoveHistory(newMoveHistory)
      setFenHistory(newFenHistory)
      setMoveSquaresHistory((prev) => [...prev, { from: sourceSquare, to: targetSquare }])

      // Start game on first move
      if (gameState === 'idle') {
        setGameState('playing')
        if (clockEnabled) clock.start()
      }

      // Switch clock after move
      if (clockEnabled) clock.onMove(movedColor)

      // Update live eval
      evalPosition(gameCopy.fen())

      const overMsg = checkGameOver(gameCopy)
      if (overMsg) {
        setGameOverMsg(overMsg)
        clock.stop()
        stopEval()
        triggerAnalysis(newFenHistory, newMoveHistory)
      }

      return true
    } catch {
      return false
    }
  }

  async function triggerAnalysis(fens: string[], moves: string[]) {
    setGameState('analyzing')
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
    const newGame = new Chess()
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
  }

  // Reset clock when time control changes (only when idle)
  function handleTCChange(idx: number) {
    setSelectedTC(idx)
    if (gameState === 'idle') {
      clock.reset(TIME_CONTROLS[idx].seconds)
    }
  }

  // Board position: show reviewed move position, or current game position
  const displayFen = reviewMoveIndex !== null && analysisFens[reviewMoveIndex + 1]
    ? analysisFens[reviewMoveIndex + 1]
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

  const isPlaying = gameState === 'playing' || gameState === 'idle'

  return (
    <div className="min-h-screen bg-gray-900 flex items-start justify-center p-6">
      <div className="flex gap-8 w-full max-w-5xl">
        {/* Board column */}
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold text-white">Evaluchess</h1>

          {/* Black clock + label */}
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-gray-900 border border-gray-600 shrink-0" />
            <span className="text-gray-300 text-sm font-medium w-12">Black</span>
            {clockEnabled && (
              <ClockDisplay
                timeMs={clock.timeBlack}
                isActive={clock.activeColor === 'black' && isPlaying}
                isFlagged={clock.flagged === 'black'}
                color="black"
              />
            )}
          </div>

          {/* Board + eval bar */}
          <div className="flex gap-2 items-stretch">
            <EvalBar ev={liveEval} height={500} />
            <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ width: 500, height: 500 }}>
              <Chessboard
                key={reviewMoveIndex !== null ? `review-${reviewMoveIndex}` : 'game'}
                options={{
                  position: displayFen,
                  onPieceDrop: isPlaying ? onDrop : undefined,
                  squareStyles,
                  boardStyle: { borderRadius: '4px' },
                  darkSquareStyle: { backgroundColor: '#769656' },
                  lightSquareStyle: { backgroundColor: '#eeeed2' },
                  showAnimations: false,
                }}
              />
            </div>
          </div>

          {/* White clock + label */}
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-white shrink-0" />
            <span className="text-gray-300 text-sm font-medium w-12">White</span>
            {clockEnabled && (
              <ClockDisplay
                timeMs={clock.timeWhite}
                isActive={clock.activeColor === 'white' && isPlaying}
                isFlagged={clock.flagged === 'white'}
                color="white"
              />
            )}
          </div>

          {/* Move list */}
          {moveHistory.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Moves</div>
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
          {(gameState === 'idle' || gameState === 'playing') && (
            <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-4">
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
                <div className="grid grid-cols-5 gap-1">
                  {TIME_CONTROLS.map((tc, i) => (
                    <button
                      key={tc.label}
                      onClick={() => handleTCChange(i)}
                      disabled={gameState === 'playing'}
                      className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${
                        selectedTC === i
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      {tc.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Turn indicator */}
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  game.turn() === 'w' ? 'bg-white' : 'bg-gray-900 border border-gray-400'
                }`} />
                <span className="text-gray-300 text-sm">
                  {gameState === 'idle' ? 'Drag a piece to start' : game.turn() === 'w' ? "White's turn" : "Black's turn"}
                </span>
              </div>

              <button
                onClick={handleNewGame}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
              >
                Reset Board
              </button>
            </div>
          )}

          {gameState === 'analyzing' && (
            <div className="bg-gray-800 rounded-xl p-6 text-center">
              <div className="text-white font-semibold text-lg mb-1">{gameOverMsg}</div>
              <div className="text-gray-400 mb-4">Analyzing with Stockfish...</div>
              <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: analysisProgress.total
                      ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="text-gray-500 text-sm">
                {analysisProgress.current} / {analysisProgress.total} positions
              </div>
            </div>
          )}

          {gameState === 'analyzed' && analysisResult && (
            <>
              {gameOverMsg && (
                <div className="bg-gray-800 rounded-xl p-3 text-center">
                  <span className="text-white font-semibold">{gameOverMsg}</span>
                </div>
              )}
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
