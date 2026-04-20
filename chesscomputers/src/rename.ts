// One-off migration: rename the 10 chesscomputer accounts to stylistically
// varied usernames while preserving each account's existing uid, email, and
// game history.
//
// Flow for each pair:
//   1. Look up uid from /usernames/<oldHex> → returns the Firebase Auth uid
//   2. Update /users/<uid> with new username + usernameLower
//   3. Insert /usernames/<newHex> = uid
//   4. Delete /usernames/<oldHex>
//
// Firebase Auth email/displayName are left alone (unused by the worker; only
// matter if a human tries to sign in as these accounts, which they can't since
// the passwords were generated randomly at setup and never exposed).

import { db } from './firebase.js'
import { encodeUsernameKey } from './config.js'

interface Rename { old: string; neu: string }

const RENAMES: Rename[] = [
  { old: 'knight_rider',  neu: 'KasparovClone' },
  { old: 'pawn_storm',    neu: 'pawn.eater' },
  { old: 'fork_and_pin',  neu: 'Bishop-Bash' },
  { old: 'endgame_eddy',  neu: 'fianchetto' },
  { old: 'blunderbuss',   neu: 'Tal-hunter99' },
  { old: 'queens_gambit', neu: 'ZugZwang' },
  { old: 'zugzwang_zoe',  neu: 'en.passant' },
  { old: 'passed_pawn',   neu: 'Queen+Rook' },
  { old: 'petrov_pete',   neu: 'mattsquad' },
  { old: 'castle_king',   neu: '64Squares' },
]

async function main() {
  console.log('Renaming chesscomputer accounts…')
  for (const { old, neu } of RENAMES) {
    const oldKey = encodeUsernameKey(old)
    const newKey = encodeUsernameKey(neu)

    const snap = await db().ref(`usernames/${oldKey}`).get()
    const uid = snap.val() as string | null
    if (!uid) {
      console.warn(`  [${old}] claim not found — skipping`)
      continue
    }

    // Guard: if a new-name claim already exists for someone else, abort loudly.
    const neuSnap = await db().ref(`usernames/${newKey}`).get()
    const existingNeuOwner = neuSnap.val() as string | null
    if (existingNeuOwner && existingNeuOwner !== uid) {
      console.error(`  [${old} → ${neu}] target already claimed by another uid (${existingNeuOwner}) — skipping`)
      continue
    }

    await db().ref(`users/${uid}`).update({
      username: neu,
      usernameLower: neu.toLowerCase(),
    })
    await db().ref(`usernames/${newKey}`).set(uid)
    await db().ref(`usernames/${oldKey}`).remove()
    console.log(`  [${old}] → [${neu}]  (uid: ${uid})`)
  }
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
