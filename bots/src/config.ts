// 10 chess-themed bots with target games/day that span 25 → 3. Rate is just a
// mean — `computeNextWaitMs` adds ±30% jitter so games don't land at fixed
// intervals. Usernames must be 3–24 chars, start/end alphanumeric, with middle
// chars from [a-zA-Z0-9._\-+~!] (same rules as the live sign-up form).
export interface BotProfile {
  username: string
  avgGamesPerDay: number
}

export const BOT_PROFILES: BotProfile[] = [
  { username: 'knight_rider',  avgGamesPerDay: 25 },
  { username: 'pawn_storm',    avgGamesPerDay: 22 },
  { username: 'fork_and_pin',  avgGamesPerDay: 19 },
  { username: 'endgame_eddy',  avgGamesPerDay: 16 },
  { username: 'blunderbuss',   avgGamesPerDay: 13 },
  { username: 'queens_gambit', avgGamesPerDay: 11 },
  { username: 'zugzwang_zoe',  avgGamesPerDay: 9 },
  { username: 'passed_pawn',   avgGamesPerDay: 7 },
  { username: 'petrov_pete',   avgGamesPerDay: 5 },
  { username: 'castle_king',   avgGamesPerDay: 3 },
]

/** Usernames only — a convenience for setup/reset scripts. */
export const BOT_USERNAMES = BOT_PROFILES.map((p) => p.username)

export const API_BASE = process.env.API_BASE ?? 'https://evaluchess.com'
export const TIME_CONTROL = process.env.BOT_TIME_CONTROL ?? '5+0'
export const STARTING_CLOCK_MS = 5 * 60 * 1000

// Initial startup stagger so 10 bots don't all join the pool at once.
export const INITIAL_MIN_WAIT_MS = 2 * 60 * 1000
export const INITIAL_MAX_WAIT_MS = 20 * 60 * 1000

// Model parameters for the between-games wait.
const MS_PER_DAY = 24 * 60 * 60 * 1000
const AVG_GAME_DURATION_MS = 4 * 60 * 1000 // rough mean for a 5+0 game incl. matchmaking
const WAIT_JITTER = 0.3 // ±30% around the mean

/**
 * Sample a wait time (ms) that, on average, produces `avgGamesPerDay` games
 * over a 24h window — accounting for how long each game itself takes.
 */
export function computeNextWaitMs(avgGamesPerDay: number): number {
  const mean = Math.max(0, MS_PER_DAY / avgGamesPerDay - AVG_GAME_DURATION_MS)
  const jitter = 1 + (Math.random() * 2 - 1) * WAIT_JITTER
  return Math.max(60_000, mean * jitter)
}

// Main loop cadence.
export const TICK_INTERVAL_MS = 2000

// How long a bot "thinks" before making each move, sampled per move.
export const THINK_MIN_MS = 2500
export const THINK_MAX_MS = 7500

// Daily rating reset bounds.
export const DAILY_ELO_MIN = 1225
export const DAILY_ELO_MAX = 1475

// Stale-game safety valve: if nothing has happened in a game for this long,
// resign it so the bot doesn't get stuck.
export const GAME_STALL_MS = 7 * 60 * 1000

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function encodeUsernameKey(name: string): string {
  return Buffer.from(name.toLowerCase(), 'utf8').toString('hex')
}

export function usernameToEmail(name: string): string {
  return `${name.toLowerCase()}@users.evaluchess.local`
}
