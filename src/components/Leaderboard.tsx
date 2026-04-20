import { useEffect, useState } from 'react'

interface LeaderboardRow {
  uid: string
  username: string
  elo: number
  wins: number
  losses: number
  draws: number
}

interface LeaderboardResponse {
  rows: LeaderboardRow[]
  computedAt: number
  cached: boolean
}

function formatRelativeTime(ms: number): string {
  if (ms < 60_000) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/leaderboard')
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const json = await res.json() as LeaderboardResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Failed to load leaderboard.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const medalColor = (i: number) =>
    i === 0 ? 'text-amber-300' :
    i === 1 ? 'text-gray-200' :
    i === 2 ? 'text-orange-300' :
    'text-gray-500'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em]">
          Top 10 by Wins <span className="text-gray-600">· Last 24h</span>
        </div>
        {data && (
          <div className="text-[10px] text-gray-600 font-mono">
            Updated {formatRelativeTime(Date.now() - data.computedAt)}
          </div>
        )}
      </div>
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 ring-1 ring-red-400/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {!data && !error && (
        <div className="text-xs text-gray-500 text-center py-6">Loading…</div>
      )}
      {data && data.rows.length === 0 && (
        <div className="text-xs text-gray-500 text-center py-6">No wins in the last 24 hours yet. Be the first.</div>
      )}
      {data && data.rows.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[1.25rem_1fr_3rem_2.5rem_auto] items-center gap-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-600">
            <span className="text-center">#</span>
            <span>Player</span>
            <span className="text-right">Elo</span>
            <span className="text-right text-emerald-300/80">Wins</span>
            <span className="text-right">L / D</span>
          </div>
          {data.rows.map((row, i) => (
            <div
              key={row.uid}
              className="grid grid-cols-[1.25rem_1fr_3rem_2.5rem_auto] items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] ring-1 ring-white/5"
            >
              <span className={`text-center text-sm font-bold tabular-nums ${medalColor(i)}`}>
                {i + 1}
              </span>
              <span className="text-sm font-semibold text-white truncate">{row.username}</span>
              <span className="text-right text-sm font-mono font-semibold text-indigo-300 tabular-nums">
                {row.elo}
              </span>
              <span className="text-right text-base font-mono font-bold text-emerald-300 tabular-nums">
                {row.wins}
              </span>
              <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums shrink-0 justify-end">
                <span className="text-red-300">{row.losses}L</span>
                <span className="text-gray-400">{row.draws}D</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
