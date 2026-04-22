// One-off manual daily reset. Useful for testing / manually rerolling chesscomputer elos.
import { db } from './firebase.js'
import { CHESSCOMPUTER_USERNAMES, DAILY_ELO_MAX, DAILY_ELO_MIN, encodeUsernameKey, randInt } from './config.js'

async function main() {
  for (const name of CHESSCOMPUTER_USERNAMES) {
    const snap = await db().ref(`usernames/${encodeUsernameKey(name)}`).get()
    const uid = snap.val() as string | null
    if (!uid) {
      console.warn(`  [${name}] not found — run setup first`)
      continue
    }
    const elo = randInt(DAILY_ELO_MIN, DAILY_ELO_MAX)
    // Reset the profile counters + reroll Elo. Leave /gameEvents intact so
    // the leaderboard's rolling 24h view keeps its historical data; per-game
    // pruning handles aging out events older than 24h.
    await db().ref(`users/${uid}`).update({
      elo,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
    })
    console.log(`  [${name}] reset to elo ${elo}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
