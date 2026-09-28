import { ChessComputer } from './chesscomputer.js'
import { reportOnline } from './api.js'
import { closeBotEngine } from './engine.js'
import { CHESSCOMPUTER_PROFILES, TICK_INTERVAL_MS, requireEnv } from './config.js'

// Server treats presence entries older than 90s as stale, so refresh well under that.
const PRESENCE_INTERVAL_MS = 50_000
const RESERVED_BOTS = 2

async function loadChessComputers(): Promise<ChessComputer[]> {
  const password = requireEnv('CHESSCOMPUTER_PASSWORD')
  return CHESSCOMPUTER_PROFILES.map((profile) => new ChessComputer({ ...profile, password }))
}

/**
 * Publish each chesscomputer's presence every PRESENCE_INTERVAL_MS so they show
 * up in the site's "X online" pill the same way logged-in humans do.
 */
function startPresenceLoop(cpus: ChessComputer[]): ReturnType<typeof setInterval> {
  const ping = async () => {
    // Spread heartbeats so the accounts leave room for other clients on this IP.
    for (const cc of cpus) {
      try {
        await reportOnline(cc.playerId)
      } catch (err) {
        console.warn(`[${cc.username}] presence ping failed: ${(err as Error).message}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }
  ping()
  return setInterval(ping, PRESENCE_INTERVAL_MS)
}

async function main(): Promise<void> {
  console.log(`Evaluchess chesscomputer worker starting (${new Date().toISOString()})`)
  const cpus = await loadChessComputers()
  if (cpus.length === 0) {
    console.error('No chesscomputer accounts configured. Run `npm run setup` first.')
    process.exit(1)
  }
  console.log(`Loaded ${cpus.length} chesscomputers`)

  // Sign in each account, clear stale queue entries and set initial waits.
  for (const cpu of cpus) {
    await cpu.init()
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  const presence = startPresenceLoop(cpus)

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('Shutting down…')
    clearInterval(presence)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Main tick loop.
  while (!shuttingDown) {
    const now = Date.now()
    // Keep two idle bots available for people even when background games are due.
    let scheduledSlots = Math.max(
      0,
      cpus.filter((c) => c.state.kind === 'waiting').length - RESERVED_BOTS
    )
    await Promise.all(
      cpus.map((c) => {
        const allowScheduled =
          c.state.kind === 'waiting' && now >= c.state.nextGameAt && scheduledSlots-- > 0
        return c.tick(now, allowScheduled)
      })
    )
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS))
  }
  await Promise.allSettled(cpus.map((c) => c.stop()))
  await closeBotEngine()
}

main().catch(async (err) => {
  await closeBotEngine()
  console.error('Fatal worker error', err)
  process.exit(1)
})
