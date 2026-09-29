import test from 'node:test'
import assert from 'node:assert/strict'
import { personalProgress } from '../.test-build/src/lib/personalProgress.js'
import { normalizeSavedGame, mergeSavedGame } from '../.test-build/src/lib/savedGame.js'
import { trainingMilestones } from '../.test-build/src/lib/training.js'
import {
  readLibrary,
  saveGame,
  setLibraryOwner,
  recordAttempt,
  receiveAccountProgress,
} from '../.test-build/src/lib/library.js'
import {
  pendingProgress,
  acknowledgeProgress,
  progressOwner,
} from '../.test-build/src/lib/progressScope.js'
import { Chess } from 'chess.js'
import { buildAnalysis } from '../.test-build/src/utils/analysis.js'

function fixture(id = 'one', ownAccuracy = 80, ownBlunders = 2, playerColor = 'white', plies = 40) {
  const chess = new Chess(),
    moves = []
  for (let i = 0; i < plies; i++) {
    const move = chess.moves()[0]
    chess.move(move)
    moves.push(move)
  }
  const analysis = buildAnalysis(
    moves,
    Array.from({ length: moves.length + 1 }, () => ({ score: 0, mate: null, bestMove: null }))
  )
  let ownIndex = 0
  analysis.moves.forEach((move) => {
    const own = move.player === playerColor
    move.accuracy = own ? ownAccuracy : 5
    move.classification = own ? (ownIndex++ < ownBlunders ? 'blunder' : 'best') : 'blunder'
  })
  return {
    id,
    updatedAt: Date.now(),
    completedAt: Date.now(),
    mode: 'computer',
    playerColor,
    moves,
    tc: 1,
    difficulty: 1,
    whiteMs: 100000,
    blackMs: 100000,
    result: 'Game ended.',
    analysis,
  }
}

test('personal trends use only the player, compare five-game windows and exclude unfinished games', () => {
  const games = Array.from({ length: 10 }, (_, i) => ({
    ...fixture(String(i), i < 5 ? 70 : 90, i < 5 ? 4 : 1, i % 2 ? 'black' : 'white'),
    completedAt: 1000 + i,
  }))
  games.push({ ...fixture('unfinished', 0, 20), result: '' })
  const progress = personalProgress(games)
  assert.equal(progress.accuracy, 90)
  assert.equal(progress.accuracyChange, 20)
  assert.equal(progress.blunders, 1)
  assert.equal(progress.blunderChange, -3)
  assert.equal(progress.improvement, 1)
  assert.equal(personalProgress(games.slice(0, 9)).accuracyChange, null)
  assert.equal(personalProgress([]).accuracy, null)
  assert.equal(trainingMilestones(games).milestones.find((b) => b.id === 'on-the-rise').done, true)
})

test('skill badges require 20 own moves, not short games or the opponent’s accuracy', () => {
  const short = fixture('short', 100, 0, 'white', 4)
  const shortBadges = trainingMilestones([short]).milestones.filter((b) =>
    ['precision', 'steady-hand'].includes(b.id)
  )
  assert.ok(shortBadges.every((b) => !b.done))
  const long = fixture('long', 92, 0, 'black')
  assert.ok(
    trainingMilestones([long])
      .milestones.filter((b) => ['precision', 'steady-hand'].includes(b.id))
      .every((b) => b.done)
  )
  const game = fixture('practice', 80, 2)
  game.attempts = {
    0: { solved: true, tries: 2, lastAt: 10 },
    1: { solved: true, tries: 1, lastAt: 10 },
    2: { solved: false, tries: 1, lastAt: 10 },
  }
  assert.deepEqual(personalProgress([game]).blunderPractice, { total: 2, solved: 1 })
})

test('cloud normalization strips unexpected fields and merges stale saves without losing solved positions', () => {
  const source = fixture()
  const normalized = normalizeSavedGame({
    ...source,
    injected: 'secret',
    analysis: { ...source.analysis, white: { accuracy: 99999 } },
  })
  assert.equal(normalized.injected, undefined)
  assert.equal(normalized.analysis.white.accuracy, 80)
  assert.equal(normalizeSavedGame({ ...source, moves: ['illegal'] }), null)
  assert.equal(normalizeSavedGame({ ...source, id: '../another-user' }), null)
  const previous = { ...source, attempts: { 0: { solved: true, tries: 2, lastAt: 10 } } }
  const stale = {
    ...source,
    result: '',
    updatedAt: source.updatedAt + 1,
    analysis: null,
    attempts: { 2: { solved: true, tries: 1, lastAt: 20 } },
  }
  const merged = mergeSavedGame(previous, stale)
  assert.equal(merged.result, source.result)
  assert.ok(merged.analysis)
  assert.equal(merged.attempts[0].solved, true)
  assert.equal(merged.attempts[2].solved, true)
  assert.deepEqual(mergeSavedGame(previous, { ...stale, moves: ['d4'] }).moves, previous.moves)
})

test('guest migration, separate account caches and pending acknowledgements preserve local edits', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  saveGame(fixture('guest'))
  setLibraryOwner('alice')
  assert.equal(progressOwner(), 'alice')
  assert.equal(readLibrary().games[0].id, 'guest')
  assert.equal(values.has('evaluchess.library.v1'), false)
  const sent = pendingProgress()
  recordAttempt('guest', 0, true)
  acknowledgeProgress(sent)
  assert.ok(pendingProgress().guest, 'a new edit remains queued after an older request completes')
  receiveAccountProgress(
    [{ ...fixture('guest'), attempts: { 2: { solved: true, tries: 1, lastAt: Date.now() } } }],
    ['regular']
  )
  assert.equal(readLibrary().games[0].attempts[0].solved, true)
  assert.equal(readLibrary().games[0].attempts[2].solved, true)
  setLibraryOwner(null)
  assert.equal(readLibrary().games.length, 0)
  setLibraryOwner('bob')
  assert.equal(readLibrary().games.length, 0)
  setLibraryOwner('alice')
  assert.equal(readLibrary().games.length, 1)
  setLibraryOwner(null)
})
