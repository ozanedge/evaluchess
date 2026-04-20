import { ChessComputer } from './chesscomputer.js'
import { reportOnline } from './api.js'
import { db } from './firebase.js'
import {
  CHESSCOMPUTER_PROFILES,
  TICK_INTERVAL_MS,
  DAILY_ELO_MIN,
  DAILY_ELO_MAX,
  encodeUsernameKey,
  randInt,
} from './config.js'

// Server treats presence entries older than 90s as stale, so refresh well under that.
const PRESENCE_INTERVAL_MS = 50_000

async function loadChessComputers(): Promise<ChessComputer[]> {
  const cpus: ChessComputer[] = []
  for (const profile of CHESSCOMPUTER_PROFILES) {
    const snap = await db().ref(`usernames/${encodeUsernameKey(profile.username)}`).get()
    const uid = snap.val() as string | null
    if (!uid) {
      console.warn(`Account not found: ${profile.username} — run 'npm run setup' first`)
      continue
    }
    cpus.push(new ChessComputer({
      uid,
      username: profile.username,
      avgGamesPerDay: profile.avgGamesPerDay,
    }))
  }
  return cpus
}

async function dailyReset(cpus: ChessComputer[]): Promise<void> {
  console.log('=== daily reset ===')
  for (const cc of cpus) {
    const newElo = randInt(DAILY_ELO_MIN, DAILY_ELO_MAX)
    await db().ref(`users/${cc.uid}`).update({
      elo: newElo,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
    })
    await db().ref(`gameEvents/${cc.uid}`).remove()
    cc.elo = newElo
    cc.wins = 0
    cc.losses = 0
    cc.draws = 0
    console.log(`  [${cc.username}] elo → ${newElo}`)
  }
}

function msUntilNextMidnightUtc(): number {
  const now = new Date()
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 5, // 5s past midnight to avoid race with our own tick
  ))
  return next.getTime() - now.getTime()
}

function scheduleDailyReset(cpus: ChessComputer[]): void {
  const run = async () => {
    try {
      await dailyReset(cpus)
    } catch (err) {
      console.error('daily reset failed', err)
    }
    setTimeout(run, msUntilNextMidnightUtc())
  }
  setTimeout(run, msUntilNextMidnightUtc())
}

/**
 * Publish each chesscomputer's presence every PRESENCE_INTERVAL_MS so they show
 * up in the site's "X online" pill the same way logged-in humans do.
 */
function startPresenceLoop(cpus: ChessComputer[]): void {
  const ping = async () => {
    // Sequential so 10 simultaneous requests don't hit the strict per-IP rate limit.
    for (const cc of cpus) {
      try {
        await reportOnline(cc.playerId)
      } catch (err) {
        console.warn(`[${cc.username}] presence ping failed: ${(err as Error).message}`)
      }
    }
  }
  ping()
  setInterval(ping, PRESENCE_INTERVAL_MS)
}

async function main(): Promise<void> {
  console.log(`Evaluchess chesscomputer worker starting (${new Date().toISOString()})`)
  const cpus = await loadChessComputers()
  if (cpus.length === 0) {
    console.error('No chesscomputer accounts configured. Run `npm run setup` first.')
    process.exit(1)
  }
  console.log(`Loaded ${cpus.length} chesscomputers`)

  // Reset on startup: ensures if the worker restarts mid-day, ratings still
  // respect the daily band.
  await dailyReset(cpus)

  // Initialize each chesscomputer (loads profile, clears stale matches, sets initial wait).
  await Promise.all(cpus.map((c) => c.init()))

  scheduleDailyReset(cpus)
  startPresenceLoop(cpus)

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('Shutting down…')
    setTimeout(() => process.exit(0), 2000)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Main tick loop.
  while (!shuttingDown) {
    const now = Date.now()
    await Promise.all(cpus.map((c) => c.tick(now)))
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS))
  }
}

main().catch((err) => {
  console.error('Fatal worker error', err)
  process.exit(1)
})
