import test from 'node:test'
import assert from 'node:assert/strict'
import { scratchServer } from './server.mjs'
import { createGame } from '../.test-build/src/lib/gameRules.js'

test('DynamoDB Local API: matchmaking races, authenticated turns, retries, clocks, results and ratings', async () => {
  const server = await scratchServer()
  const a = { id: crypto.randomUUID(), secret: crypto.randomUUID() },
    b = { id: crypto.randomUUID(), secret: crypto.randomUUID() }
  const call = async (path, player, body, token, extraHeaders = {}) => {
    const response = await fetch(server.url + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        'x-player-secret': player.secret,
        'x-forwarded-for': player.id,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    for (const tc of ['1+0', '3+0', '10+0', '5+3']) {
      const rejected = await call('/api/join', a, { id: a.id, tc })
      assert.equal(rejected.status, 400)
      assert.match(rejected.body.error, /5\+0/)
    }
    assert.equal((await call('/api/join', a, { id: a.id })).body.matched, false)
    const matches = await Promise.all([
      call('/api/join', b, { id: b.id, tc: '5+0' }),
      call('/api/join', b, { id: b.id, tc: '5+0' }),
    ])
    assert.equal(matches[0].status, 200, JSON.stringify(matches[0]))
    assert.equal(matches[0].body.match.gameId, matches[1].body.match.gameId)
    const bm = matches[0].body.match,
      am = (await call('/api/status?id=' + a.id, a)).body.match
    assert.equal(am.gameId, bm.gameId)
    assert.equal(am.tc, '5+0')
    assert.equal(bm.tc, '5+0')
    assert.equal(am.session, undefined)
    assert.equal((await call('/api/status?id=' + a.id, b)).status, 403)
    const [white, wm, black, blm] = am.myColor === 'white' ? [a, am, b, bm] : [b, bm, a, am]
    const move = {
      gameId: wm.gameId,
      playerId: white.id,
      san: 'e4',
      expectedPly: 0,
      requestId: crypto.randomUUID(),
      remainingMs: 999999999,
    }
    assert.equal(
      (await call('/api/move', black, { ...move, playerId: black.id }, blm.token)).status,
      409
    )
    assert.equal(
      (await call(`/api/move?gameId=${wm.gameId}&playerId=${white.id}`, white)).status,
      400
    )
    const responses = await Promise.all([
      call('/api/move', white, move, wm.token),
      call('/api/move', white, move, wm.token),
    ])
    for (const result of responses) {
      assert.equal(result.status, 200, JSON.stringify(result))
      assert.deepEqual(result.body.game.moves, ['e4'])
      assert.ok(result.body.game.whiteMs <= 300000)
    }
    const conflict = await call(
      '/api/move',
      white,
      { ...move, san: 'd4', requestId: crypto.randomUUID() },
      wm.token
    )
    assert.equal(conflict.status, 409)
    const resigned = await call(
      '/api/move',
      black,
      { gameId: wm.gameId, playerId: black.id, resign: true },
      blm.token
    )
    assert.deepEqual(resigned.body.game.result, { winner: 'white', reason: 'resignation' })
    const seen = await call(
      `/api/move?gameId=${wm.gameId}&playerId=${white.id}`,
      white,
      undefined,
      wm.token
    )
    assert.deepEqual(seen.body.game.result, resigned.body.game.result)
    assert.equal((await call('/api/join', white, { id: white.id, leave: true })).status, 200)
    // Exercise the DynamoDB transaction with seeded, verified identities. Concurrent
    // terminal commits must score the game once, even after a response is lost.
    const store = await import('../.test-build/api/_store.js')
    const { updateGame, gameKey } = await import('../.test-build/api/_game.js')
    const game = createGame('rated', '5+0', Date.now())
    const rating = { elo: 1200, wins: 0, losses: 0, draws: 0, gamesPlayed: 0 }
    game.players = {
      white: { uid: 'white-user', username: 'WhiteUser', rating },
      black: { uid: 'black-user', username: 'BlackUser', rating },
    }
    await store.set('evaluchess:user:v1:white-user', {
      uid: 'white-user',
      username: 'WhiteUser',
      usernameLower: 'whiteuser',
      password: 'test-only',
      createdAt: Date.now(),
    })
    await store.set('evaluchess:user:v1:black-user', {
      uid: 'black-user',
      username: 'BlackUser',
      usernameLower: 'blackuser',
      password: 'test-only',
      createdAt: Date.now(),
    })
    await store.set(gameKey(game.id), game)
    await Promise.all([
      updateGame('rated', 'white', { type: 'resign' }),
      updateGame('rated', 'white', { type: 'resign' }),
    ])
    assert.deepEqual(await store.get('evaluchess:rating:v3:white-user'), {
      ...rating,
      elo: 1184,
      losses: 1,
      gamesPlayed: 1,
    })
    assert.deepEqual(await store.get('evaluchess:rating:v3:black-user'), {
      ...rating,
      elo: 1216,
      wins: 1,
      gamesPlayed: 1,
    })
    const ended = await store.get(gameKey('rated'))
    assert.deepEqual(ended.moves, [])
    assert.deepEqual(ended.requests, [])
    assert.equal(ended.ratings.black.after, 1216)
    const leaders = await call('/api/leaderboard', a)
    assert.equal(leaders.body.rows[0].uid, 'black-user')
    assert.equal(leaders.body.scope, 'last-24-hours')
    assert.equal(leaders.body.rows[0].wins, 1, 'concurrent finalization creates one dated win')
    assert.equal(leaders.body.rows[0].ratingChange, 16)
    assert.equal(leaders.body.rows[0].elo, 1216)
    const register = async (username, password, player) => {
      const response = await fetch(server.url + '/api/auth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': player.id,
          'x-forwarded-proto': 'http',
        },
        body: JSON.stringify({ action: 'signup', username, password }),
      })
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      }
    }
    {
      const c = { id: crypto.randomUUID(), secret: crypto.randomUUID() },
        d = { id: crypto.randomUUID(), secret: crypto.randomUUID() }
      const ca = await register('VerifiedA', 'password-a', c)
      const da = await register('VerifiedB', 'password-b', d)
      assert.equal(ca.status, 200, JSON.stringify(ca.body))
      assert.equal(da.status, 200, JSON.stringify(da.body))
      assert.ok(ca.cookie)
      assert.ok(da.cookie)
      const duplicate = await register('verifieda', 'another-password', {
        id: crypto.randomUUID(),
      })
      assert.equal(duplicate.status, 409)
      await call('/api/join', c, { id: c.id, tc: '5+0', uid: 'forged', elo: 3500 }, undefined, {
        Cookie: ca.cookie,
      })
      const paired = await call(
        '/api/join',
        d,
        { id: d.id, tc: '5+0', uid: 'forged-too', elo: 3500 },
        undefined,
        { Cookie: da.cookie }
      )
      assert.equal(paired.body.match.opponentUid, ca.body.user.uid)
      assert.equal(paired.body.match.opponentElo, 1200)
      assert.equal(paired.body.match.myUid, da.body.user.uid)
      const m = paired.body.match
      await call('/api/move', d, { gameId: m.gameId, playerId: d.id, resign: true }, m.token)
      const profile = await call('/api/rating', d, undefined, undefined, { Cookie: da.cookie })
      assert.equal(profile.body.elo, 1184)
      assert.equal(profile.body.losses, 1)
      const session = await fetch(server.url + '/api/auth', { headers: { Cookie: da.cookie } })
      const sessionBody = await session.json()
      assert.equal(sessionBody.profile.elo, 1184)
    }
    const timed = createGame('timed', '5+0', Date.now() - 300001)
    await store.set(gameKey('timed'), timed)
    const timeout = await updateGame('timed', 'black', { type: 'poll' })
    assert.deepEqual(timeout.result, { winner: 'black', reason: 'timeout' })
    assert.deepEqual(timeout.moves, [])
    // A stale writer must not partially commit its other writes.
    await store.set('atomic:first', 'old')
    const stale = await store.read('atomic:first')
    await store.set('atomic:first', 'new')
    assert.equal(
      await store.transact([
        store.putWrite('atomic:first', 'bad', stale),
        store.putWrite('atomic:second', 'bad', null),
      ]),
      false
    )
    assert.equal(await store.get('atomic:first'), 'new')
    assert.equal(await store.get('atomic:second'), null)
    // DynamoDB TTL deletion is asynchronous; authorization must expire immediately.
    await store.set('expired-session', 'user', { ttl: -1 })
    await store.set('expired-queue', 'user', { sk: 'one', ttl: -1 })
    assert.equal(await store.get('expired-session'), null)
    assert.deepEqual(await store.partition('expired-queue'), [])
    assert.equal(
      await store.transact([store.putWrite('expired-session', 'replacement', null)]),
      true
    )
    // Different games sharing a player must not lose a rating increment.
    for (const name of ['overlap-one', 'overlap-two']) {
      const overlapping = createGame(name, '5+0', Date.now())
      overlapping.players = game.players
      await store.set(gameKey(name), overlapping)
    }
    await Promise.all([
      updateGame('overlap-one', 'white', { type: 'resign' }),
      updateGame('overlap-two', 'white', { type: 'resign' }),
    ])
    assert.equal((await store.get('evaluchess:rating:v3:white-user')).gamesPlayed, 3)
    assert.equal((await store.get('evaluchess:rating:v3:black-user')).wins, 3)
    const recent = (await call('/api/leaderboard', a)).body.rows.find(
      (row) => row.uid === 'black-user'
    )
    assert.equal(recent.wins, 3, 'concurrent games each count once in the rolling window')
    const racedNames = await Promise.all([
      register('ConcurrentName', 'password-first', { id: crypto.randomUUID() }),
      register('concurrentname', 'password-second', { id: crypto.randomUUID() }),
    ])
    assert.deepEqual(racedNames.map((r) => r.status).sort(), [200, 409])
    // Three simultaneous joins eventually produce one pair and one waiter.
    const { pair, findMatch } = await import('../.test-build/api/_matchmaking.js')
    const racers = Array.from({ length: 3 }, () => ({
      id: crypto.randomUUID(),
      session: crypto.randomUUID(),
    }))
    const race = () =>
      Promise.all(racers.map((p) => pair(p.id, p.session, '5+0', false, 'Guest', null)))
    await race()
    await race()
    const found = (await Promise.all(racers.map((p) => findMatch(p.id)))).filter(Boolean)
    assert.equal(found.length, 2)
    assert.equal(found[0].gameId, found[1].gameId)
    const waiting = racers.find((p) => !found.some((m) => m.opponentId === p.id))
    assert.match((await pair(waiting.id, 'wrong-owner', '5+0', false, 'Guest', null)).error, /own/)
    await pair(waiting.id, waiting.session, '5+0', false, 'Guest', null)
    assert.equal((await store.partition('queue:5+0')).length, 1)
    await pair(waiting.id, waiting.session, '5+0', true, 'Guest', null)
    assert.equal((await store.partition('queue:5+0')).length, 0)
    // Start Game reuses the browser's player credentials after refresh/home navigation.
    const returning = [0, 1].map(() => ({ id: crypto.randomUUID(), session: crypto.randomUUID() }))
    const joinAgain = (p, leave = false) => pair(p.id, p.session, '5+0', leave, 'Guest', null)
    await joinAgain(returning[0])
    const first = (await joinAgain(returning[1])).match
    assert.equal(
      (await joinAgain(returning[0])).match.gameId,
      first.gameId,
      'active games still resume'
    )
    assert.match(
      (await joinAgain(returning[0], true)).error,
      /Resign/,
      'cannot abandon a live game'
    )
    assert.match(
      (await pair(returning[0].id, 'wrong-session', '5+0', false, 'Guest', null)).error,
      /own/
    )
    await updateGame(first.gameId, 'white', { type: 'resign' })
    assert.equal(
      (await joinAgain(returning[0])).matched,
      false,
      'finished match must enter matchmaking'
    )
    const second = (await joinAgain(returning[1])).match
    assert.notEqual(second.gameId, first.gameId)
    assert.deepEqual((await store.get(gameKey(second.gameId))).moves, [])
    // A timeout not yet observed by either client must be finalized before requeueing.
    const expiredClock = await store.get(gameKey(second.gameId))
    expiredClock.turnAt = Date.now() - 300001
    await store.set(gameKey(second.gameId), expiredClock)
    const retries = await Promise.all([joinAgain(returning[0]), joinAgain(returning[0])])
    assert.ok(
      retries.every((r) => !r.matched),
      'concurrent retries do not reopen the timed-out game'
    )
    assert.equal((await store.get(gameKey(second.gameId))).result.reason, 'timeout')
    assert.equal((await store.partition('queue:5+0')).length, 1)
    const third = (await joinAgain(returning[1])).match
    assert.notEqual(third.gameId, second.gameId)
    await store.remove(gameKey(third.gameId))
    assert.equal(
      (await joinAgain(returning[0])).matched,
      false,
      'expired game records also release the assignment'
    )
    const fourth = (await joinAgain(returning[1])).match
    assert.notEqual(fourth.gameId, third.gameId)
    await updateGame(fourth.gameId, 'white', { type: 'resign' })
    for (const p of returning) await joinAgain(p, true)
    console.log(
      'PASS: Start Game releases completed, timed-out and expired matches; active games and retry safety are preserved'
    )
    // Export/import preserves scrypt hashes and every rating; replay is safe.
    const { exportAccounts, importAccounts } = await import('../scripts/migrate-storage.mjs')
    const source = await store.get(
      'evaluchess:user:v1:' + racedNames.find((r) => r.status === 200).body.user.uid
    )
    const migrant = {
      ...source,
      uid: crypto.randomUUID(),
      username: 'MigratedUser',
      usernameLower: 'migrateduser',
    }
    const migrantRating = { elo: 1440, wins: 12, losses: 3, draws: 2, gamesPlayed: 17 }
    const legacy = new Map([
      ['evaluchess:user:v1:' + migrant.uid, JSON.stringify(migrant)],
      ['evaluchess:username:v1:migrateduser', migrant.uid],
      ['evaluchess:rating:v3:' + migrant.uid, JSON.stringify(migrantRating)],
    ])
    const snapshot = await exportAccounts(async ([command, key]) =>
      command === 'SCAN' ? ['0', ['evaluchess:user:v1:' + migrant.uid]] : legacy.get(key)
    )
    const imported = await importAccounts(snapshot, store.client(), store.tableName())
    assert.equal(imported.imported, 1)
    assert.equal((await importAccounts(snapshot, store.client(), store.tableName())).existing, 1)
    assert.equal(
      (await importAccounts(snapshot, store.client(), store.tableName(), { verifyOnly: true }))
        .existing,
      1
    )
    assert.deepEqual(await store.get('evaluchess:rating:v3:' + migrant.uid), migrantRating)
    assert.deepEqual(await store.get('evaluchess:user:v1:' + migrant.uid), migrant)
    const login = await call(
      '/api/auth',
      { id: crypto.randomUUID() },
      {
        action: 'signin',
        username: 'MigratedUser',
        password: racedNames[0].status === 200 ? 'password-first' : 'password-second',
      }
    )
    assert.equal(login.status, 200)
    assert.equal(login.body.profile.elo, 1440)
    const conflictSnapshot = structuredClone(snapshot)
    conflictSnapshot.accounts[0].rating.elo++
    await assert.rejects(
      importAccounts(conflictSnapshot, store.client(), store.tableName()),
      /refusing to overwrite/
    )
    const malformed = structuredClone(snapshot)
    malformed.accounts.push({
      account: { ...migrant, uid: 'other', username: 'OtherUser', usernameLower: 'otheruser' },
      rating: null,
    })
    await assert.rejects(
      importAccounts(malformed, store.client(), store.tableName()),
      /invalid rating/
    )
    assert.equal(await store.get('evaluchess:user:v1:other'), null)
    const id = crypto.randomUUID(),
      secret = crypto.randomUUID()
    const poll = () =>
      fetch(server.url + '/api/join', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-secret': secret,
          'x-forwarded-for': 'shared-network-test',
        },
        body: JSON.stringify({ id, tc: '5+0' }),
      })
    for (let i = 0; i < 12; i++) {
      assert.equal(
        (await poll()).status,
        200,
        'Normal polling must not exhaust the old shared budget'
      )
    }
    let limited
    for (let i = 0; i < 65; i++) {
      const response = await poll()
      if (response.status === 429) {
        limited = response
        break
      }
      assert.equal(response.status, 200)
    }
    assert.ok(limited, 'Excessive polling remains rate limited')
    assert.ok(Number(limited.headers.get('Retry-After')) >= 1)
    // Presence refreshes must not exhaust the account sign-in budget.
    const household = { id: crypto.randomUUID() }
    for (let i = 0; i < 10; i++) assert.equal((await call('/api/online', household)).status, 200)
    assert.equal((await call('/api/online', household)).status, 429)
    assert.equal((await register('SeparateBudget', 'test-password', household)).status, 200)
    // A storage outage returns an actionable 503, including limiter failures.
    await server.stopStorage()
    for (const path of ['/api/leaderboard', '/api/auth', '/api/online']) {
      const failed = await call(path, { id: crypto.randomUUID() }, undefined, undefined, {
        Cookie: 'evaluchess_session=' + crypto.randomUUID(),
      })
      assert.equal(failed.status, 503)
      assert.match(failed.body.error, /unavailable/i)
    }
  } finally {
    await server.close()
  }
})
