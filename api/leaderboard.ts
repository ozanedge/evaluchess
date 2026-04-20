import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkStrictRateLimit } from './_lib.js'
import { tracer, flush, recordError, log } from './_otel.js'

const CACHE_KEY = 'evaluchess:leaderboard:v2'
const CACHE_TTL_SECONDS = 300
const WINDOW_MS = 24 * 60 * 60 * 1000

interface LeaderboardRow {
  uid: string
  username: string
  elo: number
  wins: number
  losses: number
  draws: number
}

interface RawUser {
  username?: string
  elo?: number
}

interface GameEvent {
  o?: 'win' | 'loss' | 'draw'
  at?: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('leaderboard')

  try {
    if (req.method !== 'GET') { return res.status(405).end() }
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    const force = req.query.force === '1'

    if (!force) {
      const cached = await redis.get(CACHE_KEY) as { rows: LeaderboardRow[]; computedAt: number } | null
      if (cached) {
        span.setAttributes({ 'cache.hit': true, 'rows.count': cached.rows.length })
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
        return res.json({ rows: cached.rows, computedAt: cached.computedAt, windowHours: 24, cached: true })
      }
    }

    const dbUrl = process.env.VITE_FIREBASE_DATABASE_URL
    if (!dbUrl) {
      span.setAttribute('error.reason', 'no-db-url')
      return res.status(500).json({ error: 'Firebase database URL not configured' })
    }

    // Pull both in parallel via the RTDB REST API. The leaderboard re-computes
    // at most once per CACHE_TTL_SECONDS, so this heavy read is well-amortized.
    const [usersRes, eventsRes] = await Promise.all([
      fetch(`${dbUrl}/users.json`),
      fetch(`${dbUrl}/gameEvents.json`),
    ])

    if (!usersRes.ok) {
      log('error', 'users fetch failed', { status: usersRes.status })
      return res.status(502).json({ error: 'Failed to read users', status: usersRes.status })
    }
    if (!eventsRes.ok) {
      log('error', 'events fetch failed', { status: eventsRes.status })
      return res.status(502).json({ error: 'Failed to read game events', status: eventsRes.status })
    }

    const usersData = (await usersRes.json()) as Record<string, RawUser> | null
    const eventsData = (await eventsRes.json()) as Record<string, Record<string, GameEvent>> | null

    const cutoff = Date.now() - WINDOW_MS

    // Count wins/losses/draws per uid within the 24h window.
    const tallies = new Map<string, { wins: number; losses: number; draws: number }>()
    if (eventsData && typeof eventsData === 'object') {
      for (const [uid, events] of Object.entries(eventsData)) {
        if (!events || typeof events !== 'object') continue
        let wins = 0, losses = 0, draws = 0
        for (const ev of Object.values(events)) {
          if (!ev || typeof ev !== 'object') continue
          if (typeof ev.at !== 'number' || ev.at < cutoff) continue
          if (ev.o === 'win') wins++
          else if (ev.o === 'loss') losses++
          else if (ev.o === 'draw') draws++
        }
        if (wins || losses || draws) tallies.set(uid, { wins, losses, draws })
      }
    }

    // Join tallies with user profiles for display data (username, current elo).
    const rows: LeaderboardRow[] = []
    for (const [uid, t] of tallies) {
      if (t.wins === 0) continue // only users with wins appear on the leaderboard
      const profile = usersData?.[uid]
      rows.push({
        uid,
        username: profile?.username ?? 'unknown',
        elo: typeof profile?.elo === 'number' ? profile.elo : 1200,
        wins: t.wins,
        losses: t.losses,
        draws: t.draws,
      })
    }

    rows.sort((a, b) => b.wins - a.wins || b.elo - a.elo)
    const top = rows.slice(0, 10)

    const computedAt = Date.now()
    await redis.set(CACHE_KEY, { rows: top, computedAt }, { ex: CACHE_TTL_SECONDS })

    log('info', 'leaderboard computed (24h)', { players: tallies.size, topCount: top.length })
    span.setAttributes({ 'cache.hit': false, 'rows.count': top.length, 'players.total': tallies.size })
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    return res.json({ rows: top, computedAt, windowHours: 24, cached: false })
  } catch (err) {
    recordError(span, err)
    log('error', 'leaderboard handler error', { error: String(err) })
    return res.status(500).json({ error: 'internal error' })
  } finally {
    span.end()
    flush()
  }
}
