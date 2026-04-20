import { Bot } from './bot.js'
import { db } from './firebase.js'
import {
  BOT_PROFILES,
  TICK_INTERVAL_MS,
  DAILY_ELO_MIN,
  DAILY_ELO_MAX,
  encodeUsernameKey,
  randInt,
} from './config.js'

async function loadBots(): Promise<Bot[]> {
  const bots: Bot[] = []
  for (const profile of BOT_PROFILES) {
    const snap = await db().ref(`usernames/${encodeUsernameKey(profile.username)}`).get()
    const uid = snap.val() as string | null
    if (!uid) {
      console.warn(`Bot account not found: ${profile.username} — run 'npm run setup' first`)
      continue
    }
    bots.push(new Bot({
      uid,
      username: profile.username,
      avgGamesPerDay: profile.avgGamesPerDay,
    }))
  }
  return bots
}

async function dailyReset(bots: Bot[]): Promise<void> {
  console.log('=== daily reset ===')
  for (const bot of bots) {
    const newElo = randInt(DAILY_ELO_MIN, DAILY_ELO_MAX)
    await db().ref(`users/${bot.uid}`).update({
      elo: newElo,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
    })
    await db().ref(`gameEvents/${bot.uid}`).remove()
    bot.elo = newElo
    bot.wins = 0
    bot.losses = 0
    bot.draws = 0
    console.log(`  [${bot.username}] elo → ${newElo}`)
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

function scheduleDailyReset(bots: Bot[]): void {
  const run = async () => {
    try {
      await dailyReset(bots)
    } catch (err) {
      console.error('daily reset failed', err)
    }
    setTimeout(run, msUntilNextMidnightUtc())
  }
  setTimeout(run, msUntilNextMidnightUtc())
}

async function main(): Promise<void> {
  console.log(`Evaluchess bot worker starting (${new Date().toISOString()})`)
  const bots = await loadBots()
  if (bots.length === 0) {
    console.error('No bot accounts configured. Run `npm run setup` first.')
    process.exit(1)
  }
  console.log(`Loaded ${bots.length} bots`)

  // Reset on startup: ensures if the worker restarts mid-day, ratings still
  // respect the 1225–1475 band.
  await dailyReset(bots)

  // Initialize each bot (loads profile, clears stale matches, sets initial wait).
  await Promise.all(bots.map((b) => b.init()))

  scheduleDailyReset(bots)

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
    await Promise.all(bots.map((b) => b.tick(now)))
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS))
  }
}

main().catch((err) => {
  console.error('Fatal worker error', err)
  process.exit(1)
})
