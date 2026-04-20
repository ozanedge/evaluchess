import { useEffect, useRef } from 'react'
import type { GameAnalysisResult, MoveClassification, PlayerStats } from '../utils/analysis'

interface AnalysisProps {
  result: GameAnalysisResult
  onPlayAgain: () => void
  onBackToMenu: () => void
  playAgainLabel: string
  onMoveClick: (index: number) => void
  selectedMoveIndex: number | null
}

const classificationColors: Record<MoveClassification, string> = {
  brilliant: 'text-cyan-300',
  best: 'text-emerald-300',
  good: 'text-emerald-200',
  inaccuracy: 'text-yellow-300',
  mistake: 'text-orange-300',
  blunder: 'text-red-400',
}

const classificationBg: Record<MoveClassification, string> = {
  brilliant: 'bg-cyan-500/10 ring-cyan-400/30',
  best: 'bg-emerald-500/10 ring-emerald-400/25',
  good: 'bg-emerald-500/5 ring-emerald-400/15',
  inaccuracy: 'bg-yellow-500/10 ring-yellow-400/25',
  mistake: 'bg-orange-500/10 ring-orange-400/30',
  blunder: 'bg-red-500/10 ring-red-400/30',
}

const CLASSIFICATION_FILL: Record<MoveClassification, string> = {
  brilliant: '#22d3ee',
  best: '#34d399',
  good: '#6ee7b7',
  inaccuracy: '#facc15',
  mistake: '#fb923c',
  blunder: '#ef4444',
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 text-[11px]">{label}</span>
      <span className={`font-semibold text-[11px] font-mono tabular-nums ${color}`}>{value}</span>
    </div>
  )
}

function accuracyGradient(acc: number): string {
  if (acc >= 90) return 'from-emerald-300 to-cyan-300'
  if (acc >= 75) return 'from-emerald-200 to-emerald-400'
  if (acc >= 60) return 'from-yellow-200 to-yellow-400'
  if (acc >= 45) return 'from-orange-300 to-orange-400'
  return 'from-red-300 to-red-500'
}

function PlayerCard({ name, stats, color }: { name: string; stats: PlayerStats; color: string }) {
  return (
    <div className="glass rounded-2xl p-3.5 flex-1">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full shrink-0 ${color === 'white' ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]' : 'bg-gray-900 border-2 border-gray-500'}`} />
          <span className="font-semibold text-xs text-gray-200 tracking-tight">{name}</span>
        </div>
        <span className={`text-2xl font-bold leading-none bg-gradient-to-br ${accuracyGradient(stats.accuracy)} bg-clip-text text-transparent`}>
          {stats.accuracy}%
        </span>
      </div>
      <div className="flex flex-col gap-y-0.5 border-t border-white/5 pt-2">
        {stats.brilliant > 0 && <MiniStat label="Brilliant" value={stats.brilliant} color="text-cyan-300" />}
        <MiniStat label="Best"       value={stats.best}       color="text-emerald-300" />
        <MiniStat label="Good"       value={stats.good}       color="text-emerald-200" />
        <MiniStat label="Inaccuracy" value={stats.inaccuracy} color="text-yellow-300" />
        <MiniStat label="Mistake"    value={stats.mistake}    color="text-orange-300" />
        <MiniStat label="Blunder"    value={stats.blunder}    color="text-red-400" />
      </div>
    </div>
  )
}

function AccuracyChart({ moves, onMoveClick, selectedMoveIndex }: {
  moves: AnalysisProps['result']['moves']
  onMoveClick: (i: number) => void
  selectedMoveIndex: number | null
}) {
  const n = moves.length
  if (n === 0) return null

  const CHART_H = 64
  const xPct = (i: number) => n === 1 ? 50 : (i / (n - 1)) * 100
  const yU   = (acc: number) => CHART_H * (1 - acc / 100)

  const pts = moves.map((m, i) => [xPct(i), yU(m.accuracy)] as [number, number])
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  const areaPath = `${linePath}L${pts[n - 1][0]},${CHART_H}L${pts[0][0]},${CHART_H}Z`

  const labelStep = Math.max(5, Math.round(n / 12 / 2) * 2)

  return (
    <div className="glass rounded-2xl p-3.5">
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.12em] mb-2.5">Accuracy by Move</h3>

      <div
        className="relative cursor-pointer"
        style={{ height: CHART_H }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const xPct = (e.clientX - rect.left) / rect.width
          const idx = Math.round(xPct * (n - 1))
          onMoveClick(Math.max(0, Math.min(n - 1, idx)))
        }}
      >
        <svg
          className="absolute inset-0"
          viewBox={`0 0 100 ${CHART_H}`}
          width="100%" height="100%"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="accLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#818cf8" />
              <stop offset="100%" stopColor="#e879f9" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map(pct => (
            <line key={pct} x1="0" y1={yU(pct)} x2="100" y2={yU(pct)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="1 1.5" />
          ))}
          <path d={areaPath} fill="url(#accGrad)" />
          <polyline
            points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none" stroke="url(#accLine)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"
          />
        </svg>

        {moves.map((m, i) => {
          const isSelected = selectedMoveIndex === i
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${xPct(i)}%`,
                top: `${(1 - m.accuracy / 100) * 100}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            >
              <div
                className="rounded-full transition-all"
                style={{
                  width:  isSelected ? 10 : 5,
                  height: isSelected ? 10 : 5,
                  backgroundColor: CLASSIFICATION_FILL[m.classification],
                  boxShadow: isSelected
                    ? `0 0 0 2px rgba(255,255,255,0.85), 0 0 14px ${CLASSIFICATION_FILL[m.classification]}`
                    : `0 0 6px ${CLASSIFICATION_FILL[m.classification]}60`,
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="relative mt-1.5" style={{ height: 12 }}>
        {moves.map((m, i) => {
          if (m.player !== 'white') return null
          if (m.moveNumber !== 1 && m.moveNumber % labelStep !== 0) return null
          return (
            <div
              key={i}
              className="absolute text-gray-600 font-mono"
              style={{ left: `${xPct(i)}%`, fontSize: 9, transform: 'translateX(-50%)' }}
            >
              {m.moveNumber}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Analysis({ result, onPlayAgain, onBackToMenu, playAgainLabel, onMoveClick, selectedMoveIndex }: AnalysisProps) {
  const selectedRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selectedRef.current && scrollContainerRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedMoveIndex])

  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="text-xs font-bold text-gray-400 tracking-[0.15em] uppercase px-1">Game Analysis</h2>

      <div className="flex gap-2.5">
        <PlayerCard name="White" stats={result.white} color="white" />
        <PlayerCard name="Black" stats={result.black} color="black" />
      </div>

      <AccuracyChart moves={result.moves} onMoveClick={onMoveClick} selectedMoveIndex={selectedMoveIndex} />

      <div className="glass rounded-2xl p-3.5">
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.12em] mb-2">Move Review</h3>
        <div ref={scrollContainerRef} className="thin-scroll max-h-56 overflow-y-auto space-y-1 pr-1">
          {result.moves.map((m, i) => (
            <div
              key={i}
              ref={selectedMoveIndex === i ? selectedRef : null}
              onClick={() => onMoveClick(i)}
              className={`flex items-center justify-between px-3 py-1.5 rounded-lg ring-1 text-xs cursor-pointer transition-all ${
                classificationBg[m.classification]
              } ${selectedMoveIndex === i ? 'ring-white/40 bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
            >
              <span className="text-gray-500 w-7 font-mono tabular-nums">
                {m.player === 'white' ? `${m.moveNumber}.` : `${m.moveNumber}…`}
              </span>
              <span className="font-mono font-semibold text-white w-14">{m.move}</span>
              <span className={`font-semibold capitalize ${classificationColors[m.classification]}`}>
                {m.classification}
              </span>
              <span className="text-gray-500 w-12 text-right font-mono tabular-nums">
                {m.cpLoss > 0 ? `-${m.cpLoss}cp` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={onPlayAgain}
          className="btn-primary w-full py-3 rounded-xl text-sm tracking-tight"
        >
          {playAgainLabel}
        </button>
        <button
          onClick={onBackToMenu}
          className="w-full py-2.5 rounded-xl text-sm font-semibold tracking-tight bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-gray-200 hover:text-white transition-all"
        >
          Back to Menu
        </button>
      </div>
    </div>
  )
}
