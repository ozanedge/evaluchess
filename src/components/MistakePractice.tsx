import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { Square } from 'chess.js'
import type { SavedGame } from '../lib/library'
import { reconstruct, recordAttempt } from '../lib/library'
import { useStockfish } from '../hooks/useStockfish'
import { boardAppearance } from './boardAppearance'
import type { PlayerSettings } from '../lib/settings'
import Icon from './Icon'

export default function MistakePractice({
  game,
  ply,
  onClose,
  settings,
  boardSize,
  returnLabel,
}: {
  game: SavedGame
  ply: number
  onClose: () => void
  settings: PlayerSettings
  boardSize: number
  returnLabel: string
}) {
  const initial = reconstruct(game.moves.slice(0, ply)).game.fen()
  const move = game.analysis!.moves[ply]
  const [fen, setFen] = useState(initial)
  const [message, setMessage] = useState('Find the strongest move. The engine answer is hidden.')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [line, setLine] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const { evaluatePosition, destroy } = useStockfish()
  const generation = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const tracker = generation
    heading.current?.focus()
    return () => {
      tracker.current++
    }
  }, [])
  function save(solved: boolean) {
    try {
      recordAttempt(game.id, ply, solved)
    } catch {
      setMessage('Practice completed, but browser storage is full. Progress could not be saved.')
    }
  }
  async function playContinuation(moves: string[], start: number, run: number) {
    for (let next = start + 1; next <= moves.length; next++) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      if (run !== generation.current) return
      showStep(next, moves)
    }
  }
  async function attempt(from: string, to: string) {
    if (busy || revealed) return false
    const chess = new Chess(initial)
    let played
    try {
      played = chess.move({ from, to, promotion: settings.promotion })
    } catch {
      setMessage('That move is not legal. Try another square.')
      return false
    }
    const run = ++generation.current
    setBusy(true)
    setFen(chess.fen())
    setSelected(null)
    setMessage('Checking your move…')
    try {
      const best = await evaluatePosition(initial)
      if (run !== generation.current) return false
      const after = await evaluatePosition(chess.fen())
      if (run !== generation.current) return false
      const uci = played.from + played.to + (played.promotion || '')
      const beforeCp = best.mate === null ? best.score : best.mate > 0 ? 9999 : -9999
      const afterCp = after.mate === null ? -after.score : after.mate > 0 ? -9999 : 9999
      const correct = uci === best.bestMove || beforeCp - afterCp <= 20
      save(correct)
      if (correct) {
        const continuation = [uci, ...(after.pv || []).slice(0, 5)]
        setRevealed(true)
        setMessage('Good move! Watch the continuation on the board.')
        setLine(continuation)
        setStep(1)
        await playContinuation(continuation, 1, run)
      } else {
        setFen(initial)
        setMessage(
          'That move gives up more than the engine’s choice. Try again, or reveal the answer.'
        )
      }
    } catch (e) {
      if (run === generation.current) {
        setFen(initial)
        setMessage((e as Error).message)
      }
    } finally {
      if (run === generation.current) setBusy(false)
    }
    return false
  }
  async function reveal() {
    if (busy) return
    const run = ++generation.current
    setBusy(true)
    try {
      const best = await evaluatePosition(initial)
      if (run !== generation.current) return
      const continuation = best.pv?.length
        ? best.pv.slice(0, 6)
        : best.bestMove
          ? [best.bestMove]
          : []
      setLine(continuation)
      setRevealed(true)
      setStep(0)
      setFen(initial)
      setMessage('Engine answer revealed. Watch the continuation, then try again.')
      save(false)
      await playContinuation(continuation, 0, run)
    } catch (e) {
      if (run === generation.current) setMessage((e as Error).message)
    } finally {
      if (run === generation.current) setBusy(false)
    }
  }
  function showStep(next: number, moves = line) {
    const chess = new Chess(initial)
    for (const uci of moves.slice(0, next)) {
      try {
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      } catch {
        break
      }
    }
    setFen(chess.fen())
    setStep(next)
  }
  function reset() {
    generation.current++
    destroy()
    setBusy(false)
    setRevealed(false)
    setFen(initial)
    setLine([])
    setStep(0)
    setSelected(null)
    setMessage('Find the strongest move. The engine answer is hidden.')
  }
  return (
    <>
      <div className="board-column" style={{ width: boardSize <= 500 ? '100%' : boardSize + 40 }}>
        <div className="player-strip glass flex items-center gap-3 px-4 py-3">
          <span className="accent-text">
            <Icon name="spark" size={24} />
          </span>
          <div>
            <span className="eyebrow accent-text">YOUR SECOND CHANCE</span>
            <h2 ref={heading} tabIndex={-1} className="font-semibold text-white outline-none">
              Practice move {move.moveNumber} · {move.player} to move
            </h2>
          </div>
        </div>
        <div
          className="board-frame overflow-hidden ml-9"
          style={{ width: boardSize, height: boardSize }}
        >
          <Chessboard
            options={{
              position: fen,
              ...boardAppearance(settings),
              boardOrientation: game.playerColor,
              allowDragging: !busy && !revealed,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (targetSquare) void attempt(sourceSquare, targetSquare)
                return false
              },
              onSquareClick: ({ square }) => {
                if (busy || revealed) return
                if (selected) {
                  void attempt(selected, square)
                  setSelected(null)
                } else if (
                  new Chess(initial).get(square as Square)?.color === new Chess(initial).turn()
                )
                  setSelected(square)
              },
              squareStyles: selected ? { [selected]: { backgroundColor: '#fbbf2470' } } : {},
              showAnimations: false,
            }}
          />
        </div>
        <p className="text-sm text-gray-400 text-center">No clock. Take your time.</p>
      </div>
      <div className="side-panel w-full lg:flex-1 lg:min-w-64 flex flex-col gap-4">
        <section className="glass rounded-2xl p-5 space-y-4" aria-label="Practice controls">
          <span className="eyebrow accent-text">
            {revealed ? 'EXPLORE THE LINE' : 'FIND A BETTER MOVE'}
          </span>
          <h3 className="text-xl font-bold text-white">
            {revealed ? 'See what happens next.' : 'Turn this moment around.'}
          </h3>
          <p role="status" className="text-sm text-gray-300 leading-relaxed">
            {message}
          </p>
          {!revealed && (
            <button
              disabled={busy}
              className="btn-primary rounded-xl w-full px-3 py-3"
              onClick={() => void reveal()}
            >
              {busy ? 'Checking your move…' : 'Reveal answer'}
            </button>
          )}
          {revealed && (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm"
                  disabled={busy || step === 0}
                  onClick={() => showStep(step - 1)}
                >
                  ← Previous
                </button>
                <span
                  className="text-sm font-mono text-gray-300"
                  aria-label="Continuation progress"
                  aria-live="polite"
                >
                  {step}/{line.length}
                </span>
                <button
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm"
                  disabled={busy || step === line.length}
                  onClick={() => showStep(step + 1)}
                >
                  Next →
                </button>
              </div>
              <button className="btn-primary rounded-xl w-full px-3 py-3" onClick={reset}>
                Try again
              </button>
            </>
          )}
        </section>
        <button
          className="glass-subtle rounded-xl px-4 py-3 text-sm font-semibold"
          onClick={() => {
            generation.current++
            destroy()
            onClose()
          }}
        >
          ← {returnLabel}
        </button>
      </div>
    </>
  )
}
