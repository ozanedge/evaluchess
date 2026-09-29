import test from 'node:test'
import assert from 'node:assert/strict'
import { scratchServer } from './server.mjs'

test('private DynamoDB library: authentication, account isolation, concurrent merges, idempotency and retention', async () => {
  const server = await scratchServer()
  const call = async (path, cookie = '', body) => {
    const response = await fetch(server.url + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        cookie,
        'x-forwarded-for': 'library-test',
        'x-forwarded-proto': 'http',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    }
  }
  try {
    assert.equal((await call('/api/library')).status, 401)
    const alice = await call('/api/auth', '', {
      action: 'signup',
      username: 'library-alice',
      password: 'password1',
    })
    const bob = await call('/api/auth', '', {
      action: 'signup',
      username: 'library-bob',
      password: 'password2',
    })
    const uid = alice.data.user.uid
    const game = {
      id: 'game-one',
      updatedAt: Date.now(),
      mode: 'computer',
      playerColor: 'white',
      moves: ['e4', 'e5', 'Nf3', 'Nc6'],
      tc: 1,
      difficulty: 1,
      whiteMs: 100000,
      blackMs: 100000,
      result: 'Game ended.',
      analysis: null,
    }
    const upload = (games, badges = []) =>
      call('/api/library', alice.cookie, { uid, games, badges })
    assert.equal(
      (await call('/api/library', bob.cookie, { uid, games: [game], badges: [] })).status,
      409
    )
    assert.equal((await upload([{ ...game, id: '../escape' }])).status, 400)
    assert.equal((await upload([{ ...game, moves: ['invalid'] }])).status, 400)
    assert.equal((await upload([game, game])).status, 400)
    assert.equal((await upload([game], ['tactician', 'not-a-badge'])).status, 200)
    const race = await Promise.all([
      upload(
        [{ ...game, attempts: { 0: { solved: true, tries: 2, lastAt: Date.now() } } }],
        ['regular']
      ),
      upload(
        [{ ...game, attempts: { 2: { solved: true, tries: 1, lastAt: Date.now() } } }],
        ['analyst']
      ),
    ])
    assert.ok(
      race.every((result) => result.status === 200),
      JSON.stringify(race)
    )
    await upload([{ ...game, result: '', analysis: null, updatedAt: game.updatedAt + 1 }])
    const divergent = await upload([{ ...game, moves: ['d4', 'd5'] }])
    assert.equal(divergent.status, 409)
    assert.equal(divergent.data.code, 'different-continuation')
    const restored = await call('/api/library', alice.cookie)
    assert.equal(restored.data.games.length, 1)
    assert.equal(restored.data.games[0].result, game.result)
    assert.equal(restored.data.games[0].attempts[0].solved, true)
    assert.equal(restored.data.games[0].attempts[2].solved, true)
    assert.deepEqual(new Set(restored.data.badges), new Set(['tactician', 'regular', 'analyst']))
    const isolated = await call('/api/library?uid=' + uid, bob.cookie)
    assert.equal(isolated.data.uid, bob.data.user.uid)
    assert.deepEqual(isolated.data.games, [])
    assert.deepEqual(isolated.data.badges, [])
    for (let start = 0; start < 55; start += 5) {
      const result = await upload(
        Array.from({ length: 5 }, (_, i) => ({
          ...game,
          id: `retained-${start + i}`,
          updatedAt: game.updatedAt + start + i + 10,
        }))
      )
      assert.equal(result.status, 200, JSON.stringify(result))
    }
    const retained = await call('/api/library', alice.cookie)
    const allGames = [...retained.data.games]
    let cursor = retained.data.cursor
    while (cursor !== null) {
      const page = await call('/api/library?cursor=' + cursor, alice.cookie)
      allGames.push(...page.data.games)
      cursor = page.data.cursor
    }
    assert.equal(allGames.length, 50)
    assert.equal(retained.data.games[0].id, 'retained-54')
    assert.ok(retained.data.badges.includes('tactician'))
    const { partition } = await import('../.test-build/api/_store.js')
    assert.equal(
      (await partition(`evaluchess:library:v1:${uid}`)).length,
      51,
      'old game records are pruned with the index'
    )
    await call('/api/auth', alice.cookie, { action: 'signout' })
    assert.equal((await call('/api/library', alice.cookie)).status, 401)
  } finally {
    await server.close()
  }
})
