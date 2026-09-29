import { useEffect, useState } from 'react'

interface LeaderboardRow {
  uid: string
  username: string
  elo: number | null
  ratingChange: number
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
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let loading = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function load() {
      if (cancelled || loading) return
      loading = true
      clearTimeout(timer)
      try {
        const res = await fetch('/api/leaderboard', { signal: controller.signal })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const json = (await res.json()) as LeaderboardResponse
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Failed to load leaderboard.')
      } finally {
        loading = false
        if (!cancelled) timer = setTimeout(load, 30000)
      }
    }
    const wake = () => {
      if (!document.hidden) void load()
    }
    load()
    document.addEventListener('visibilitychange', wake)
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [attempt])

  const medalColor = (i: number) =>
    i === 0
      ? 'text-amber-300'
      : i === 1
        ? 'text-gray-200'
        : i === 2
          ? 'text-orange-300'
          : 'text-gray-500'

  const rowStyle = (i: number) =>
    i === 0
      ? 'bg-amber-300/8'
      : i === 1
        ? 'bg-slate-200/5'
        : i === 2
          ? 'bg-orange-300/5'
          : 'bg-white/[0.02]'

  return (
    <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0">
      <div className="flex items-baseline justify-between">
        <div className="text-gray-500 text-[11px] font-semibold uppercase tracking-[0.12em]">
          Top 10 by wins <span className="text-gray-600">· Last 24 hours</span>
        </div>
        {data && (
          <div className="text-[10px] text-gray-600 font-mono">
            Updated {formatRelativeTime(Date.now() - data.computedAt)}
          </div>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="text-xs text-red-300 bg-red-500/10 ring-1 ring-red-400/30 rounded-lg px-3 py-2"
        >
          {error}
          <button
            type="button"
            className="ml-3 underline font-semibold"
            onClick={() => {
              setError(null)
              setAttempt((value) => value + 1)
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!data && !error && <div className="text-xs text-gray-500 text-center py-6">Loading…</div>}
      {data && data.rows.length === 0 && (
        <div className="text-xs text-gray-500 text-center py-6">
          No rated games in the last 24 hours. Be the first.
        </div>
      )}
      {data && data.rows.length > 0 && (
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Scrollable leaderboard"
        >
          <table className="leaderboard-table" aria-label="Leaderboard for the last 24 hours">
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              <col style={{ width: 60 }} />
              <col style={{ width: 62 }} />
              <col style={{ width: 62 }} />
              <col style={{ width: 66 }} />
              <col style={{ width: 76 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="text-emerald-300">
                  Wins
                </th>
                <th scope="col">Losses</th>
                <th scope="col">Draws</th>
                <th scope="col" title="Current rating">
                  Elo
                </th>
                <th scope="col" title="Rating change in the last 24 hours">
                  Δ Elo
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={row.uid} className={rowStyle(i)}>
                  <td
                    className={`font-bold ${medalColor(i)}`}
                    style={{
                      borderLeftColor: ['#fcd34d', '#cbd5e1', '#fdba74'][i] || 'transparent',
                    }}
                  >
                    {i + 1}
                  </td>
                  <td className="font-semibold text-white">
                    <span className="block truncate" title={row.username}>
                      {row.username}
                    </span>
                  </td>
                  <td className="font-mono font-bold text-emerald-300">{row.wins}</td>
                  <td className="font-mono text-red-300">{row.losses}</td>
                  <td className="font-mono text-gray-400">{row.draws}</td>
                  <td className="font-mono font-semibold text-gray-200">{row.elo ?? '—'}</td>
                  <td className="font-mono font-semibold text-indigo-300">
                    {row.ratingChange > 0 ? '+' : ''}
                    {row.ratingChange}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
