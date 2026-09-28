import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { Square } from 'chess.js'
import type { SavedGame } from '../lib/library'
import { reconstruct, recordAttempt } from '../lib/library'
import { useStockfish } from '../hooks/useStockfish'
import { boardAppearance } from './boardAppearance'
import type { PlayerSettings } from '../lib/settings'

export default function MistakePractice({
  game,
  ply,
  onClose,
  settings,
}: {
  game: SavedGame
  ply: number
  onClose: () => void
  settings: PlayerSettings
}) {
  const initial = reconstruct(game.moves.slice(0, ply)).game.fen()
  const move = game.analysis!.moves[ply]
  const [fen, setFen] = useState(initial)
  const [message, setMessage] = useState('Find the strongest move. The engine answer is hidden.')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [line, setLine] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [promotion, setPromotion] = useState<string>(settings.promotion)
  const [selected, setSelected] = useState<string | null>(null)
  const { evaluatePosition, destroy } = useStockfish()
  const generation = useRef(0)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tracker = generation
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => {
      tracker.current++
      previous?.focus()
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
      await new Promise((resolve) => window.setTimeout(resolve, 600))
      if (run !== generation.current) return
      showStep(next, moves)
    }
  }
  async function attempt(from: string, to: string) {
    if (busy || revealed) return false
    const chess = new Chess(initial)
    let played
    try {
      played = chess.move({ from, to, promotion })
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
        setMessage('Good move! Explore the engine continuation below.')
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
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 overflow-y-auto p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          destroy()
          onClose()
        }
        if (e.key === 'Tab') {
          const items = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select'
          )
          if (!items?.length) return
          const first = items[0],
            last = items[items.length - 1]
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === dialog.current)
          ) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-title"
        className="mx-auto max-w-xl bg-gray-950 rounded-2xl p-4 space-y-3"
      >
        <div className="flex justify-between">
          <h2 id="practice-title" className="font-bold">
            Practice move {move.moveNumber} · {move.player} to move
          </h2>
          <button
            aria-label="Close practice"
            onClick={() => {
              destroy()
              onClose()
            }}
          >
            Close ×
          </button>
        </div>
        <p role="status" className="text-sm text-gray-300">
          {message}
        </p>
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
        {!revealed && (
          <label className="text-sm">
            Promote to{' '}
            <select
              aria-label="Practice promotion"
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
              className="bg-gray-800 p-2 rounded"
            >
              <option value="q">Queen</option>
              <option value="r">Rook</option>
              <option value="b">Bishop</option>
              <option value="n">Knight</option>
            </select>
          </label>
        )}
        <div className="flex gap-2 flex-wrap">
          {!revealed && (
            <button
              disabled={busy}
              className="btn-primary rounded-lg px-3 py-2"
              onClick={() => void reveal()}
            >
              Reveal answer
            </button>
          )}
          {revealed && (
            <>
              <button disabled={step === 0} onClick={() => showStep(step - 1)}>
                ← Previous
              </button>
              <span aria-label="Continuation progress" aria-live="polite">
                {step}/{line.length}
              </span>
              <button disabled={step === line.length} onClick={() => showStep(step + 1)}>
                Next →
              </button>
              <button
                onClick={() => {
                  setRevealed(false)
                  setFen(initial)
                  setStep(0)
                  setMessage('Find the strongest move.')
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
