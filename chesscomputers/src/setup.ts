import crypto from 'node:crypto'
import { auth, db } from './firebase.js'
import {
  CHESSCOMPUTER_USERNAMES,
  DAILY_ELO_MAX,
  DAILY_ELO_MIN,
  encodeUsernameKey,
  randInt,
  usernameToEmail,
} from './config.js'

function randomPassword(): string {
  return crypto.randomBytes(18).toString('base64url')
}

async function main() {
  console.log('Creating chesscomputer accounts…')
  for (const name of CHESSCOMPUTER_USERNAMES) {
    const email = usernameToEmail(name)
    const claimKey = encodeUsernameKey(name)
    try {
      let uid: string
      const existing = await auth().getUserByEmail(email).catch(() => null)
      if (existing) {
        uid = existing.uid
        console.log(`  [${name}] already exists (${uid}) — ensuring profile + claim`)
      } else {
        const created = await auth().createUser({
          email,
          password: randomPassword(),
          displayName: name,
        })
        uid = created.uid
        console.log(`  [${name}] auth user created (${uid})`)
      }

      const initialElo = randInt(DAILY_ELO_MIN, DAILY_ELO_MAX)
      await db().ref(`users/${uid}`).set({
        username: name,
        usernameLower: name.toLowerCase(),
        elo: initialElo,
        wins: 0,
        losses: 0,
        draws: 0,
        gamesPlayed: 0,
        createdAt: Date.now(),
        isChessComputer: true,
      })
      await db().ref(`usernames/${claimKey}`).set(uid)
      console.log(`  [${name}] profile seeded · elo ${initialElo}`)
    } catch (err) {
      console.error(`  [${name}] setup failed`, err)
    }
  }
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
