interface ClockDisplayProps {
  timeMs: number
  isActive: boolean
  isFlagged: boolean
  color: 'white' | 'black'
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 10) return `${minutes}:${String(seconds).padStart(2, '0')}`
  const tenths = Math.floor((ms % 1000) / 100)
  if (ms < 10000) return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function ClockDisplay({ timeMs, isActive, isFlagged, color: _color }: ClockDisplayProps) {
  const isLow = timeMs < 10000
  const isVeryLow = timeMs < 5000

  const containerClass = isFlagged
    ? 'bg-red-500/90 ring-red-300/40 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
    : isActive
      ? isVeryLow
        ? 'bg-red-500/10 ring-red-400/40 shadow-[0_0_18px_rgba(239,68,68,0.35)]'
        : isLow
          ? 'bg-orange-500/10 ring-orange-400/40 shadow-[0_0_18px_rgba(249,115,22,0.35)]'
          : 'bg-white/10 ring-white/20'
      : 'bg-white/[0.03] ring-white/5'

  const textColor = isFlagged
    ? 'text-white'
    : isActive
      ? isVeryLow
        ? 'text-red-300'
        : isLow
          ? 'text-orange-300'
          : 'text-white'
      : 'text-gray-500'

  return (
    <div
      className={`rounded-xl px-4 py-2 flex items-center justify-center transition-all duration-200 ring-1 backdrop-blur-sm ${containerClass}`}
    >
      <span className={`font-mono text-2xl font-bold tabular-nums tracking-tight ${textColor}`}>
        {isFlagged ? '0:00' : formatTime(timeMs)}
      </span>
    </div>
  )
}
