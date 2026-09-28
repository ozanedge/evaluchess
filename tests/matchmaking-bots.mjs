import assert from 'node:assert/strict'
import { scratchServer } from './server.mjs'

const server = await scratchServer()
const store = await import('../.test-build/api/_store.js')
const { pair, findMatch } = await import('../.test-build/api/_matchmaking.js')
const { createSession, startingRating } = await import('../.test-build/api/_identity.js')
const player = (bot = false, elo = 1200) => {
  const id = crypto.randomUUID()
  return {
    id,
    session: crypto.randomUUID(),
    user: bot
      ? {
          uid: id,
          username: 'TestBot',
          usernameLower: 'testbot',
          createdAt: 0,
          rating: { ...startingRating(), elo },
          bot,
        }
      : null,
  }
}
const join = (p, standby = false) => pair(p.id, p.session, '5+0', false, 'Guest', p.user, standby)
const leave = (p) => pair(p.id, p.session, '5+0', true, 'Guest', p.user)
async function age(p, milliseconds, stale = false) {
  const current = await store.get(`player:${p.id}`)
  current.entry.joinedAt = Date.now() - milliseconds
  if (stale) current.entry.ts = Date.now() - 21000
  await store.set(`player:${p.id}`, current, { ttl: 60 })
  await store.set('queue:5+0', current.entry, { sk: p.id, ttl: 20 })
  return current.entry.joinedAt
}
try {
  const bot = player(true),
    reserve = player(true, 500),
    human = player()
  assert.equal((await join(bot, true)).matched, false)
  assert.equal(
    (await join(reserve, true)).matched,
    false,
    'standby bots never pair with each other'
  )
  assert.equal((await join(human)).matched, false)
  const joinedAt = await age(human, 10000)
  assert.equal((await join(human)).matched, false, 'humans have the first 12 seconds')
  assert.equal(
    (await store.get(`player:${human.id}`)).entry.joinedAt,
    joinedAt,
    'heartbeat preserves wait start'
  )
  assert.equal((await join(bot, true)).matched, false, 'bot cannot bypass the human wait')
  const human2 = player()
  const humanMatch = await join(human2)
  assert.equal(humanMatch.match.opponentId, human.id, 'another human pairs immediately')
  assert.equal(humanMatch.match.opponentBot, false)

  const overdue = player()
  await join(overdue)
  await age(overdue, 12001)
  const matched = await join(overdue)
  assert.equal(
    matched.match.opponentId,
    bot.id,
    'closest available rated bot is chosen after 12 seconds'
  )
  assert.equal(matched.match.opponentBot, true)
  assert.equal(
    (await join(bot, true)).match.gameId,
    matched.match.gameId,
    'idle worker discovers reservation'
  )
  assert.equal((await join(overdue)).match.gameId, matched.match.gameId, 'retry returns same game')
  assert.equal(await store.get('queue:5+0', bot.id), null, 'reserved bot leaves queue atomically')

  const cancelled = player()
  await join(cancelled)
  await age(cancelled, 13000)
  await leave(cancelled)
  assert.equal(
    (await join(reserve, true)).matched,
    false,
    'cancellation prevents a later bot pairing'
  )

  const racers = [player(), player()]
  // Seed two independently waiting humans to race over the last available bot.
  for (const p of racers) {
    const entry = {
      id: p.id,
      session: p.session,
      tc: '5+0',
      ts: Date.now(),
      joinedAt: Date.now() - 13000,
      username: 'Guest',
    }
    await store.set(`player:${p.id}`, { session: p.session, entry }, { ttl: 60 })
    // Only the polling player is visible to each transaction; no queue row is required to join.
  }
  const race = await Promise.all(racers.map((p) => join(p)))
  assert.equal(race.filter((r) => r.matched).length, 1, 'one bot cannot be assigned twice')
  const unpaired = racers.find((_, i) => !race[i].matched)
  await leave(unpaired)

  const staleBot = player(true),
    another = player()
  await join(staleBot, true)
  await age(staleBot, 30000, true)
  await join(another)
  await age(another, 13000)
  assert.equal((await join(another)).matched, false, 'offline bot heartbeats cannot match')
  await leave(another)
  await leave(staleBot)

  const workerBot = player(true),
    sleeper = player()
  await join(sleeper)
  await age(sleeper, 13000)
  assert.equal(
    (await join(workerBot, true)).match.opponentId,
    sleeper.id,
    'worker can initiate overdue pairing'
  )
  assert.ok(await findMatch(sleeper.id))

  const secret = crypto.randomUUID(),
    id = crypto.randomUUID()
  const request = (cookie, body) =>
    fetch(server.url + '/api/join', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-player-secret': secret,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ id, tc: '5+0', ...body }),
    })
  assert.equal(
    (await request(null, { standby: true, bot: true })).status,
    409,
    'client cannot grant itself bot privileges'
  )
  const uid = crypto.randomUUID()
  await store.set(`evaluchess:user:v1:${uid}`, {
    uid,
    username: 'RegisteredBot',
    usernameLower: 'registeredbot',
    createdAt: 0,
  })
  await store.set(`evaluchess:bot-rating-seed:v1:${uid}`, { initialRating: 900 })
  const cookie = 'evaluchess_session=' + (await createSession(uid))
  assert.equal(
    (await request(cookie, { standby: true })).status,
    200,
    'registered authenticated bot can stand by'
  )
  assert.equal((await store.get('queue:5+0', id)).bot, true)
  await request(cookie, { leave: true })
  console.log(
    'PASS: 12-second bot fallback, human priority, closest rating, standby, stale heartbeat, cancellation, atomic reservation and authenticated bot identity'
  )
} finally {
  await server.close()
}
