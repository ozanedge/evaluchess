import assert from 'node:assert/strict'
import { scratchServer } from './server.mjs'

const server = await scratchServer()
process.env.API_BASE = server.url
const { closeBotEngine } = await import('../chesscomputers/src/engine.ts')
try {
  const { ChessComputer } = await import('../chesscomputers/src/chesscomputer.ts')
  const { createAccount, reportOnline } = await import('../chesscomputers/src/api.ts')
  const password = 'scratch-bot-password'
  assert.equal(await createAccount('TestBotOne', password), 'created')
  assert.equal(await createAccount('TestBotTwo', password), 'created')
  assert.equal(await createAccount('TestBotOne', password), 'exists')
  await assert.rejects(
    createAccount('TestBotOne', 'wrong-password'),
    /Invalid username or password/
  )
  const bots = ['TestBotOne', 'TestBotTwo'].map(
    (username, index) =>
      new ChessComputer({
        username,
        password,
        avgGamesPerDay: 10,
        initialRating: index ? 400 : 1600,
      })
  )
  for (const bot of bots) {
    await bot.init()
    const store = await import('../.test-build/api/_store.js')
    await store.set(`evaluchess:bot-rating-seed:v1:${bot.uid}`, { initialRating: bot.targetRating })
    await reportOnline(bot.playerId)
    bot.state = { kind: 'waiting', nextGameAt: 0 }
  }
  // An idle bot serves people without waiting for its scheduled background game.
  const { ApiClient } = await import('../chesscomputers/src/api.ts')
  const store = await import('../.test-build/api/_store.js')
  bots[0].state.nextGameAt = Date.now() + 3600000
  await bots[0].tick(Date.now(), false)
  assert.equal(bots[0].state.kind, 'waiting')
  assert.equal((await store.get('queue:5+0', bots[0].playerId)).standby, true)
  const human = new ApiClient()
  assert.equal(await human.join('5+0'), null)
  const current = await store.get(`player:${human.playerId}`)
  current.entry.joinedAt = Date.now() - 13000
  await store.set(`player:${human.playerId}`, current, { ttl: 60 })
  await store.set('queue:5+0', current.entry, { sk: human.playerId, ttl: 20 })
  const fallback = await human.join('5+0')
  assert.equal(fallback.opponentId, bots[0].playerId)
  await bots[0].tick(Date.now() + 7000, false)
  assert.equal(bots[0].state.kind, 'playing')
  const game = bots[0].state.game
  if (game.match.myColor === 'black') await human.move(fallback, 'e4', 0)
  await bots[0].tick(Date.now())
  game.thinkingUntil = Date.now() - 1
  await bots[0].tick(Date.now())
  assert.ok((await human.game(fallback)).moves.length >= 1)
  await bots[0].api.resign(game.match)
  await bots[0].tick(Date.now())
  await human.join('5+0', true)
  bots[0].losses = 0
  for (const bot of bots) bot.state.nextGameAt = 0
  console.log(
    'PASS: idle worker accepts the 12-second fallback during cooldown and plays a rated-strength move'
  )
  for (const bot of bots) await bot.tick(Date.now())
  await bots[0].tick(Date.now())
  assert.ok(bots.every((b) => b.state.kind === 'playing'))
  const firstGame = bots[0].state.game.match.gameId
  assert.equal(firstGame, bots[1].state.game.match.gameId)
  const white = bots.find((b) => b.state.game.match.myColor === 'white')
  const black = bots.find((b) => b !== white)
  await white.tick(Date.now())
  white.state.game.thinkingUntil = Date.now() - 1
  await white.tick(Date.now())
  assert.equal((await white.api.game(white.state.game.match)).moves.length, 1)
  await black.api.resign(black.state.game.match)
  for (const bot of bots) await bot.tick(Date.now())
  assert.ok(bots.every((b) => b.state.kind === 'waiting'))
  assert.equal(white.wins, 1)
  assert.equal(black.losses, 1)
  // A new cycle must create a different match, not replay the completed result.
  for (const bot of bots) {
    bot.state.nextGameAt = 0
    await bot.tick(Date.now())
  }
  await bots[0].tick(Date.now())
  assert.ok(bots.every((b) => b.state.kind === 'playing'))
  assert.notEqual(bots[0].state.game.match.gameId, firstGame)
  assert.equal(white.elo, 1216)
  assert.equal(black.elo, 1184)
  assert.equal(bots[0].targetRating, 1600, 'earned rating changes must not change playing strength')
  assert.equal(bots[1].targetRating, 400)
  // Both strength profiles must produce moves accepted by the real API.
  for (let ply = 0; ply < 2; ply++) {
    const mover = bots.find((bot) => bot.state.game.match.myColor === (ply ? 'black' : 'white'))
    await mover.tick(Date.now())
    mover.state.game.thinkingUntil = Date.now() - 1
    await mover.tick(Date.now())
    assert.equal((await mover.api.game(mover.state.game.match)).moves.length, ply + 1)
  }
  for (const bot of bots) await bot.stop()
  let limited = false
  for (let i = 0; i < 12; i++) {
    const response = await fetch(server.url + '/api/online')
    if (response.status === 429) {
      limited = true
      break
    }
  }
  assert.ok(limited)
  await reportOnline('cc-presence-retry')
  console.log(
    'PASS: bot accounts, presence retry, legal moves, results, ratings, requeue and shutdown'
  )
} finally {
  await closeBotEngine()
  await server.close()
}
