import './build.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, advanceGame, clocksAt } from '../.test-build/src/lib/gameRules.js'
import { Engine } from '../.test-build/src/lib/engine.js'
import {
  readLibrary,
  saveGame,
  recordAttempt,
  reconstruct,
  clearActive,
  exportPgn,
} from '../.test-build/src/lib/library.js'
import { buildAnalysis } from '../.test-build/src/utils/analysis.js'

const play = (game, san, now = 100) =>
  advanceGame(
    game,
    game.moves.length % 2 ? 'black' : 'white',
    { type: 'move', san, requestId: `move-${game.moves.length}`, expectedPly: game.moves.length },
    now
  )
test('turn ownership, legal moves, stale requests and idempotency', () => {
  const game = createGame('g', '5+0', 0)
  const action = { type: 'move', san: 'e4', expectedPly: 0, requestId: 'one' }
  assert.throws(() => advanceGame(game, 'black', action, 10), /not your turn/)
  assert.throws(() => play(game, 'e5'), /Illegal/)
  const next = advanceGame(game, 'white', action, 1000)
  assert.equal(next.whiteMs, 299000)
  assert.equal(advanceGame(next, 'white', action, 2000), next)
  assert.throws(
    () => advanceGame(next, 'black', { ...action, requestId: 'two', san: 'e5' }, 2000),
    /Position changed/
  )
  assert.deepEqual(game.moves, [])
})
test('server clocks flag consistently; resignation and ended games stay final', () => {
  const game = createGame('g', '5+0', 0)
  assert.equal(clocksAt(game, 2000).whiteMs, 298000)
  const ended = advanceGame(game, 'black', { type: 'poll' }, 300001)
  assert.deepEqual(ended.result, { winner: 'black', reason: 'timeout' })
  assert.equal(ended.whiteMs, 0)
  assert.equal(advanceGame(ended, 'black', { type: 'resign' }, 310000), ended)
  const resignation = advanceGame(game, 'black', { type: 'resign' }, 1000)
  assert.deepEqual(resignation.result, { winner: 'white', reason: 'resignation' })
  assert.throws(() => play(resignation, 'e4'), /ended/)
})
test('full move history detects threefold repetition and checkmate', () => {
  let game = createGame('g', '5+0', 0)
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game = play(game, san)
  assert.deepEqual(game.result, { winner: null, reason: 'draw' })
  game = createGame('g', '5+0', 0)
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) game = play(game, san)
  assert.deepEqual(game.result, { winner: 'black', reason: 'checkmate' })
})
test('move analysis treats Black and checkmate from the correct perspective', () => {
  const result = buildAnalysis(
    ['e4', 'e5'],
    [
      { score: 30, mate: null, bestMove: 'e2e4' },
      { score: -30, mate: null, bestMove: 'e7e5' },
      { score: 200, mate: null, bestMove: 'g1f3' },
    ]
  )
  assert.equal(result.moves[0].cpLoss, 0)
  assert.equal(result.moves[1].cpLoss, 170)
  assert.equal(result.moves[1].classification, 'blunder')
})
class MemoryStorage {
  values = new Map()
  getItem(key) {
    return this.values.get(key) || null
  }
  setItem(key, value) {
    this.values.set(key, value)
  }
  removeItem(key) {
    this.values.delete(key)
  }
}
test('saved games, progress, PGN, bounded history and corrupted storage', () => {
  globalThis.localStorage = new MemoryStorage()
  const game = {
    id: 'g',
    updatedAt: 1000,
    mode: 'computer',
    playerColor: 'white',
    moves: ['e4', 'e5'],
    tc: 1,
    difficulty: 1,
    whiteMs: 100,
    blackMs: 100,
    result: 'Draw',
    analysis: null,
  }
  saveGame(game)
  recordAttempt('g', 0, false)
  recordAttempt('g', 0, true)
  saveGame({ ...game, whiteMs: 50 })
  assert.equal(readLibrary().games[0].attempts[0].tries, 2)
  assert.equal(readLibrary().games[0].attempts[0].solved, true)
  assert.equal(
    reconstruct(readLibrary().active.moves).game.fen(),
    reconstruct(['e4', 'e5']).game.fen()
  )
  assert.match(exportPgn(game), /1\. e4 e5/)
  clearActive()
  assert.equal(readLibrary().active, null)
  for (let i = 0; i < 60; i++) saveGame({ ...game, id: String(i) })
  assert.equal(readLibrary().games.length, 50)
  localStorage.setItem('evaluchess.library.v1', '{bad')
  assert.deepEqual(readLibrary().games, [])
  localStorage.setItem(
    'evaluchess.library.v1',
    JSON.stringify({ version: 1, games: [{ ...game, moves: ['illegal'] }] })
  )
  assert.equal(readLibrary().games.length, 0)
})
class FakeWorker extends EventTarget {
  commands = []
  terminated = false
  hang = false
  postMessage(message) {
    this.commands.push(message)
    if (this.hang) return
    queueMicrotask(() => {
      if (this.terminated) return
      const send = (data) => this.dispatchEvent(new MessageEvent('message', { data }))
      if (message === 'uci') send('uciok')
      else if (message === 'isready') send('readyok')
      else if (message.startsWith('go ')) {
        send('info depth 14 score cp 32 pv e2e4 e7e5')
        send('bestmove e2e4')
      }
    })
  }
  terminate() {
    this.terminated = true
  }
}
test('engine initializes once, caches results and captures continuation', async () => {
  const worker = new FakeWorker(),
    engine = new Engine(() => worker, 100)
  const result = await engine.evaluate('start')
  assert.deepEqual(result, { score: 32, mate: null, bestMove: 'e2e4', pv: ['e2e4', 'e7e5'] })
  await engine.evaluate('start')
  assert.equal(worker.commands.filter((c) => c.startsWith('go ')).length, 1)
  engine.cancel()
  assert.equal(worker.terminated, true)
})
test('engine startup and search timeout, cancellation and recovery settle promises', async () => {
  let worker = new FakeWorker()
  worker.hang = true
  const engine = new Engine(() => worker, 20)
  await assert.rejects(engine.evaluate('start'), /too long/)
  worker = new FakeWorker()
  assert.equal((await engine.evaluate('recovered')).bestMove, 'e2e4')
  worker.hang = true
  const pending = engine.evaluate('other')
  await new Promise((resolve) => setTimeout(resolve, 1))
  engine.cancel()
  await assert.rejects(pending, { name: 'AbortError' })
  worker = new FakeWorker()
  worker.postMessage = function (message) {
    if (message.startsWith('go ')) return
    FakeWorker.prototype.postMessage.call(this, message)
  }
  await assert.rejects(engine.evaluate('search-timeout'), /stopped responding/)
})

test('move feedback uses the mover perspective, exact best move and classification colors', async () => {
  const { Chess } = await import('chess.js')
  const { moveFeedback, MOVE_COLORS } = await import('../.test-build/src/utils/moveFeedback.js')
  const ev = (score, bestMove = null, mate = null) => ({ score, bestMove, mate })
  for (const black of [false, true]) {
    const chess = new Chess()
    for (const san of ['e4', 'e5', ...(black ? ['Nf3'] : [])]) chess.move(san)
    const before = chess.fen()
    const san = black ? 'Nc6' : 'Nf3',
      best = black ? 'g8f6' : 'f1c4'
    chess.move(san)
    for (const [loss, classification] of [
      [-10, 'best'],
      [0, 'best'],
      [10, 'good'],
      [35, 'inaccuracy'],
      [100, 'mistake'],
      [200, 'blunder'],
    ]) {
      const feedback = moveFeedback(before, chess.fen(), san, ev(40, best), ev(loss - 40))
      assert.equal(feedback.player, black ? 'black' : 'white')
      assert.equal(feedback.classification, classification)
      assert.equal(feedback.arrows[0].color, MOVE_COLORS[classification])
      if (classification === 'best') {
        assert.deepEqual(
          feedback.arrows.map((a) => [a.kind, a.uci, a.color]),
          [['best', black ? 'b8c6' : 'g1f3', '#39ff14']]
        )
      } else {
        assert.equal(feedback.arrows.length, 2)
        assert.equal(feedback.arrows[1].color, '#39ff14')
        assert.equal(feedback.arrows[1].uci, best)
      }
    }
    const played = black ? 'b8c6' : 'g1f3'
    const exact = moveFeedback(before, chess.fen(), san, ev(40, played), ev(30))
    assert.equal(exact.classification, 'best')
    assert.deepEqual(
      exact.arrows.map((a) => [a.kind, a.uci, a.color]),
      [['best', played, '#39ff14']]
    )
    assert.equal(moveFeedback(before, new Chess().fen(), san, ev(0), ev(0)), null)
  }
})

test('feedback skips move one, handles mate and distinguishes promotion pieces', async () => {
  const { Chess } = await import('chess.js')
  const { moveFeedback } = await import('../.test-build/src/utils/moveFeedback.js')
  const ev = (score, bestMove = null, mate = null) => ({ score, bestMove, mate })
  const chess = new Chess()
  for (const [san, uci] of [
    ['e4', 'e2e4'],
    ['e5', 'e7e5'],
  ]) {
    const before = chess.fen()
    chess.move(san)
    assert.deepEqual(moveFeedback(before, chess.fen(), san, ev(0, uci), ev(0)).arrows, [])
  }
  const promotion = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 5'),
    before = promotion.fen()
  promotion.move('a8=N')
  const feedback = moveFeedback(before, promotion.fen(), 'a8=N', ev(900, 'a7a8q'), ev(0))
  assert.equal(feedback.classification, 'blunder')
  assert.deepEqual(
    feedback.arrows.map((a) => a.uci),
    ['a7a8n', 'a7a8q']
  )
  const mate = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 5'),
    mateBefore = mate.fen()
  mate.move('Qg7#')
  const result = moveFeedback(mateBefore, mate.fen(), 'Qg7#', ev(0, 'f7g7', 1), ev(0, null, 0))
  assert.equal(result.classification, 'best')
  assert.equal(result.arrows.length, 1)
})
