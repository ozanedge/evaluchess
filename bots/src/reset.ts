// One-off manual daily reset. Useful for testing / manually rerolling bot elos.
import { db } from './firebase.js'
import { BOT_USERNAMES, DAILY_ELO_MAX, DAILY_ELO_MIN, encodeUsernameKey, randInt } from './config.js'

async function main() {
  for (const name of BOT_USERNAMES) {
    const snap = await db().ref(`usernames/${encodeUsernameKey(name)}`).get()
    const uid = snap.val() as string | null
    if (!uid) {
      console.warn(`  [${name}] not found — run setup first`)
      continue
    }
    const elo = randInt(DAILY_ELO_MIN, DAILY_ELO_MAX)
    await db().ref(`users/${uid}`).update({
      elo,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
    })
    await db().ref(`gameEvents/${uid}`).remove()
    console.log(`  [${name}] reset to elo ${elo}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
