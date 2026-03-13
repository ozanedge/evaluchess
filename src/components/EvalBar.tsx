import type { LiveEval } from '../hooks/usePositionEval'

interface EvalBarProps {
  ev: LiveEval | null
  height: number
}

// Convert centipawns to white's win percentage for the bar
function cpToWhitePct(cp: number): number {
  // Sigmoid scaled to give ~75% at +3 pawns, ~90% at +7 pawns
  const pct = 50 + 50 * Math.tanh(cp / 600)
  return Math.min(95, Math.max(5, pct))
}

function formatEval(ev: LiveEval): string {
  if (ev.mate !== null) {
    return ev.mate > 0 ? `M${ev.mate}` : `M${Math.abs(ev.mate)}`
  }
  const absScore = Math.abs(ev.score)
  return (ev.score >= 0 ? '+' : '-') + (absScore / 100).toFixed(1)
}

function evalColor(ev: LiveEval): string {
  if (ev.mate !== null) return ev.mate > 0 ? 'text-white' : 'text-gray-900'
  return ev.score >= 0 ? 'text-white' : 'text-gray-900'
}

export default function EvalBar({ ev, height }: EvalBarProps) {
  const whitePct = ev
    ? ev.mate !== null
      ? ev.mate > 0 ? 95 : 5
      : cpToWhitePct(ev.score)
    : 50

  const blackPct = 100 - whitePct

  const label = ev ? formatEval(ev) : '0.0'
  const labelOnBlack = whitePct < 50

  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden w-8 shrink-0 relative select-none"
      style={{ height }}
    >
      {/* Black portion (top) */}
      <div
        className="bg-gray-800 transition-all duration-300 flex items-start justify-center pt-1"
        style={{ height: `${blackPct}%` }}
      >
        {labelOnBlack && (
          <span className="text-gray-100 text-xs font-bold font-mono leading-none">
            {label}
          </span>
        )}
      </div>

      {/* White portion (bottom) */}
      <div
        className="bg-gray-100 transition-all duration-300 flex items-end justify-center pb-1"
        style={{ height: `${whitePct}%` }}
      >
        {!labelOnBlack && ev && (
          <span className={`text-xs font-bold font-mono leading-none ${evalColor(ev)}`}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
