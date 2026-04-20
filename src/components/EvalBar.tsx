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
      className="flex flex-col rounded-xl overflow-hidden w-8 shrink-0 relative select-none ring-1 ring-white/10 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)]"
      style={{ height }}
    >
      {/* Black portion (top) */}
      <div
        className="transition-all duration-500 ease-out flex items-start justify-center pt-1.5"
        style={{
          height: `${blackPct}%`,
          background: 'linear-gradient(180deg, #1a1a24 0%, #0e0e16 100%)',
        }}
      >
        {labelOnBlack && (
          <span className="text-gray-100 text-[11px] font-bold font-mono leading-none tracking-tight">
            {label}
          </span>
        )}
      </div>

      {/* White portion (bottom) */}
      <div
        className="transition-all duration-500 ease-out flex items-end justify-center pb-1.5"
        style={{
          height: `${whitePct}%`,
          background: 'linear-gradient(180deg, #f5f5f0 0%, #e8e8e0 100%)',
        }}
      >
        {!labelOnBlack && ev && (
          <span className={`text-[11px] font-bold font-mono leading-none tracking-tight ${evalColor(ev)}`}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
