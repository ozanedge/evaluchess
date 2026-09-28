// Operator-only initialization. The running worker never needs AWS credentials.
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import * as store from '../api/_store.js'
import { accountKey, ratingKey, usernameKey, startingRating } from '../api/_identity.js'
import type { Account, Rating } from '../api/_identity.js'
import { CHESSCOMPUTER_PROFILES, requireEnv } from '../chesscomputers/src/config.js'

const scrypt = promisify(scryptCallback)

export async function seedBotRating(username: string, password: string, apply = false) {
  const profile = CHESSCOMPUTER_PROFILES.find((p) => p.username === username)
  if (!profile) throw new Error('Account is not a configured bot')
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = await store.read<string>(usernameKey(username.toLowerCase()))
    if (!name) throw new Error(`Missing bot account: ${username}; run setup first`)
    const uid = name.value
    const account = await store.read<Account>(accountKey(uid))
    if (!account || account.value.username !== username || account.value.uid !== uid)
      throw new Error(`Account identity mismatch: ${username}`)
    const [salt, hash] = account.value.password.split(':')
    if (
      !salt ||
      !/^[a-f0-9]{128}$/.test(hash || '') ||
      !timingSafeEqual((await scrypt(password, salt, 64)) as Buffer, Buffer.from(hash, 'hex'))
    )
      throw new Error(`Bot password mismatch: ${username}`)

    const markerKey = `evaluchess:bot-rating-seed:v1:${uid}`
    const marker = await store.read(markerKey)
    const rating = await store.read<Rating>(ratingKey(uid))
    if (!rating) throw new Error(`Missing rating: ${username}`)
    if (marker) return { username, status: 'already seeded', elo: rating.value.elo }
    // Shift the starting point once, retaining all earned changes and counters.
    const next = {
      ...rating.value,
      elo: rating.value.elo + profile.initialRating - startingRating().elo,
    }
    if (!apply) return { username, status: 'planned', elo: next.elo }
    const unchanged = (row: store.RecordValue<unknown>): store.Write => ({
      ConditionCheck: {
        TableName: store.tableName(),
        Key: { pk: row.pk, sk: row.sk },
        ConditionExpression: '#version = :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': row.version },
      },
    })
    if (
      await store.transact([
        unchanged(name),
        unchanged(account),
        store.putWrite(ratingKey(uid), next, rating, {
          leaderboard: { uid, username, elo: next.elo, wins: next.wins },
        }),
        store.putWrite(
          markerKey,
          {
            username,
            initialRating: profile.initialRating,
            previousElo: rating.value.elo,
            appliedElo: next.elo,
            appliedAt: Date.now(),
          },
          null
        ),
      ])
    )
      return { username, status: 'seeded', elo: next.elo }
    await store.backoff(attempt)
  }
  throw new Error(`Concurrent rating updates for ${username}; rerun safely`)
}

async function main() {
  const password = requireEnv('CHESSCOMPUTER_PASSWORD')
  requireEnv('DYNAMODB_TABLE')
  const apply = process.argv.includes('--apply')
  console.log(`${apply ? 'Applying' : 'Previewing'} bot starting ratings in ${store.tableName()}`)
  for (const { username } of CHESSCOMPUTER_PROFILES)
    console.log(await seedBotRating(username, password, apply))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
