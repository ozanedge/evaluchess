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

export default function ClockDisplay({ timeMs, isActive, isFlagged, color }: ClockDisplayProps) {
  const isLow = timeMs < 10000
  const isVeryLow = timeMs < 5000

  const bg = isFlagged
    ? 'bg-red-600'
    : isActive
      ? color === 'white'
        ? 'bg-white'
        : 'bg-gray-100'
      : 'bg-gray-700'

  const textColor = isFlagged
    ? 'text-white'
    : isActive
      ? isVeryLow
        ? 'text-red-600'
        : isLow
          ? 'text-orange-500'
          : 'text-gray-900'
      : 'text-gray-400'

  return (
    <div className={`rounded-xl px-4 py-2 flex items-center justify-center transition-colors duration-200 ${bg}`}>
      <span className={`font-mono text-2xl font-bold tabular-nums tracking-tight ${textColor}`}>
        {isFlagged ? '0:00' : formatTime(timeMs)}
      </span>
    </div>
  )
}
