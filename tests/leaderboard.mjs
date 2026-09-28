import assert from 'node:assert/strict'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { scratchServer } from './server.mjs'
const server = await scratchServer()
try {
  const store = await import('../api/_store.ts')
  const { backfillLeaderboardWins } = await import('../scripts/backfill-leaderboard-wins.ts')
  const snapshots = new Map()
  for (let i = 0; i < 15; i++) {
    // The lowest-rated player has the most wins, outside the old Elo top ten.
    const rating = { elo: 2000 - 100 * i, wins: i, losses: 2, draws: 1, gamesPlayed: i + 3 }
    const uid = 'leader-test-' + i,
      username = 'Player' + i
    const pk = 'evaluchess:rating:v3:' + uid
    snapshots.set(pk, rating)
    assert.ok(
      await store.transact([
        store.putWrite(pk, rating, null, {
          leaderboard: { uid, username, elo: rating.elo, wins: rating.wins },
        }),
      ])
    )
    // Reproduce a legacy rating without the new index attribute.
    await store.client().send(
      new UpdateCommand({
        TableName: store.tableName(),
        Key: { pk, sk: 'data' },
        UpdateExpression: 'REMOVE wins',
      })
    )
  }
  assert.deepEqual(await backfillLeaderboardWins(), { apply: false, changed: 15, unchanged: 0 })
  assert.equal((await store.leaders()).length, 0, 'dry run cannot populate the index')
  assert.deepEqual(await backfillLeaderboardWins(true), { apply: true, changed: 15, unchanged: 0 })
  assert.deepEqual(await backfillLeaderboardWins(true), { apply: true, changed: 0, unchanged: 15 })
  for (const [pk, rating] of snapshots) assert.deepEqual(await store.get(pk), rating)
  const {
    resultWrite,
    recentLeaders,
    summarizeResults,
    LEADERBOARD_WINDOW_MS: DAY,
  } = await import('../api/_leaderboard.ts')
  const now = Date.now()
  const empty = await (await fetch(server.url + '/api/leaderboard')).json()
  assert.deepEqual(empty.rows, [], 'lifetime stats alone cannot enter the rolling leaderboard')
  const events = []
  const event = (id, uid, username, endedAt, winner = 'white') => ({
    gameId: id,
    endedAt,
    winner,
    white: { uid, username, ratingChange: winner === null ? 0 : winner === 'white' ? 16 : -16 },
    black: {
      uid: 'opponent',
      username: 'Opponent',
      ratingChange: winner === null ? 0 : winner === 'white' ? -16 : 16,
    },
  })
  for (let i = 1; i < 15; i++) {
    for (let win = 0; win < i; win++)
      events.push(event(`recent-${i}-${win}`, 'leader-test-' + i, 'Player' + i, now - 3600000))
  }
  events.push(event('loss', 'leader-test-14', 'Player14', now - 1000, 'black'))
  events.push(event('draw', 'leader-test-14', 'Player14', now - 2000, null))
  events.push(event('yesterday', 'yesterday', 'Yesterday', now - 23 * 3600000))
  events.push(event('old', 'old', 'OldWinner', now - DAY))
  events.push(event('future', 'future', 'FutureWinner', now + 3600000))
  for (const result of events) assert.equal(await store.transact([resultWrite(result)]), true)
  const response = await fetch(server.url + '/api/leaderboard')
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.sort, 'wins')
  assert.equal(data.scope, 'last-24-hours')
  assert.equal(data.computedAt - data.windowStart, DAY)
  assert.equal(data.rows.length, 10)
  assert.equal(data.rows[0].username, 'Player14')
  assert.deepEqual(
    data.rows.map((r) => r.wins),
    [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]
  )
  assert.deepEqual(data.rows[0], {
    uid: 'leader-test-14',
    username: 'Player14',
    wins: 14,
    losses: 1,
    draws: 1,
    gamesPlayed: 16,
    ratingChange: 208,
    elo: 600,
  })
  const currentRatingKey = 'evaluchess:rating:v3:leader-test-14'
  const originalRating = await store.get(currentRatingKey)
  await store.set(currentRatingKey, { ...originalRating, elo: 777 })
  const refreshed = await (await fetch(server.url + '/api/leaderboard')).json()
  assert.equal(
    refreshed.rows[0].elo,
    777,
    'Elo comes from the current rating, independently of dated results'
  )
  assert.equal(
    refreshed.rows[0].ratingChange,
    208,
    '24-hour change stays independent of current Elo'
  )
  await store.set(currentRatingKey, null)
  const missing = await (await fetch(server.url + '/api/leaderboard')).json()
  assert.equal(
    missing.rows[0].elo,
    null,
    'a missing current rating is not replaced with a guessed Elo'
  )
  await store.set(currentRatingKey, originalRating)
  assert.deepEqual(
    await recentLeaders(now + 2 * DAY),
    [],
    'results age out without new games or TTL deletion'
  )
  const boundary = [
    event('at-cutoff', 'expired', 'Expired', now - DAY),
    event('inside', 'included', 'Included', now - DAY + 1),
    event('at-now', 'included', 'Included', now),
    event('future', 'future', 'Future', now + 1),
  ]
  const summarized = summarizeResults([...boundary, boundary[1]], now)
  assert.equal(summarized.find((r) => r.uid === 'included').wins, 2)
  assert.ok(!summarized.some((r) => ['expired', 'future'].includes(r.uid)))
  assert.equal(
    summarizeResults([events.find((r) => r.gameId === 'yesterday')], now)[0].username,
    'Yesterday'
  )
  assert.ok(
    (await recentLeaders(now - 22 * 3600000)).some((row) => row.uid === 'yesterday'),
    'the query reads results from the previous UTC day'
  )
  // Retained games from before this deployment populate the window once, without editing ratings.
  const { backfillRecentResults } = await import('../scripts/backfill-recent-results.ts')
  const legacy = {
    id: 'legacy-completed',
    turnAt: now - 5000,
    result: { winner: 'white', reason: 'resignation' },
    players: {
      white: { uid: 'legacy-winner', username: 'LegacyWinner' },
      black: { uid: 'legacy-loser', username: 'LegacyLoser' },
    },
    ratings: { white: { before: 1000, after: 1016 }, black: { before: 1000, after: 984 } },
  }
  await store.set('evaluchess:game:v3:legacy-completed', legacy, { ttl: 86400 })
  await store.set('evaluchess:game:v3:too-old', { ...legacy, id: 'too-old', turnAt: now - DAY })
  await store.set('evaluchess:game:v3:unrated', { ...legacy, id: 'unrated', ratings: undefined })
  await store.set('evaluchess:game:v3:expired', { ...legacy, id: 'expired' }, { ttl: -1 })
  assert.deepEqual(await backfillRecentResults(false, now), {
    apply: false,
    eligible: 1,
    created: 1,
    existing: 0,
  })
  const applied = await Promise.all([
    backfillRecentResults(true, now),
    backfillRecentResults(true, now),
  ])
  assert.equal(
    applied.reduce((n, r) => n + r.created, 0),
    1
  )
  assert.deepEqual(await backfillRecentResults(true, now), {
    apply: true,
    eligible: 1,
    created: 0,
    existing: 1,
  })
  for (const [pk, rating] of snapshots) assert.deepEqual(await store.get(pk), rating)
  assert.deepEqual(await store.get('evaluchess:game:v3:legacy-completed'), legacy)
  console.log(
    'PASS: current Elo is independent of rolling 24-hour stats; top ten by wins, exact expiry, UTC-day boundaries, missing ratings, duplicate protection and concurrent history backfill'
  )
} finally {
  await server.close()
}
