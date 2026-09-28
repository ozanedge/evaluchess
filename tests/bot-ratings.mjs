import assert from 'node:assert/strict'
import { scratchServer } from './server.mjs'

const server = await scratchServer()
process.env.API_BASE = server.url
try {
  const { createAccount } = await import('../chesscomputers/src/api.ts')
  const { seedBotRating } = await import('../scripts/seed-bot-ratings.ts')
  const store = await import('../api/_store.ts')
  const { ratingKey, usernameKey } = await import('../api/_identity.ts')
  const password = 'scratch-bot-password'
  for (const name of ['KasparovClone', '64Squares', 'HumanPlayer'])
    await createAccount(name, password)
  assert.equal((await seedBotRating('64Squares', password)).elo, 400)
  const uid = await store.get(usernameKey('64squares'))
  assert.equal((await store.get(ratingKey(uid))).elo, 1200, 'preview must not write')
  await assert.rejects(seedBotRating('HumanPlayer', password, true), /not a configured bot/)
  await assert.rejects(seedBotRating('64Squares', 'wrong-password', true), /password mismatch/)
  // Simulate a completed game before seeding; neither the gain nor stats are erased.
  const before = await store.read(ratingKey(uid))
  const earned = { ...before.value, elo: 1216, wins: 1, gamesPlayed: 1 }
  assert.ok(await store.transact([store.putWrite(ratingKey(uid), earned, before)]))
  const results = await Promise.all([
    seedBotRating('64Squares', password, true),
    seedBotRating('64Squares', password, true),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), ['already seeded', 'seeded'])
  assert.deepEqual(await store.get(ratingKey(uid)), { ...earned, elo: 416 })
  assert.equal((await seedBotRating('KasparovClone', password, true)).elo, 1600)
  const leaders = await store.leaders()
  for (const [name, elo] of [
    ['KasparovClone', 1600],
    ['64Squares', 416],
    ['HumanPlayer', 1200],
  ]) {
    const row = leaders.find((r) => r.username === name)
    assert.equal(row.elo, elo)
    assert.equal(row.value.elo, elo, 'leaderboard index agrees with account rating')
  }
  console.log(
    'PASS: bot rating range, dry run, account protection, preserved results, concurrent idempotency and leaderboard'
  )
} finally {
  await server.close()
}
