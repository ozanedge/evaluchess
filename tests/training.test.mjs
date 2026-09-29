import './build.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  trainingMilestones,
  readEarnedBadges,
  rememberEarnedBadges,
} from '../.test-build/src/lib/training.js'
import { saveGame, readLibrary, recordAttempt } from '../.test-build/src/lib/library.js'

const fixture = (id, options = {}) => ({
  id,
  updatedAt: Date.now(),
  mode: 'computer',
  playerColor: 'white',
  moves: ['e4', 'e5', 'Nf3', 'Nc6'],
  tc: 1,
  difficulty: 1,
  whiteMs: 200000,
  blackMs: 200000,
  result: 'You resigned.',
  analysis: null,
  ...options,
})
function storage() {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  return values
}
const earned = (games, previous) =>
  trainingMilestones(games, previous)
    .milestones.filter((badge) => badge.done)
    .map((badge) => badge.id)

test('activity badges unlock at their advertised thresholds, with progress capped at the target', () => {
  const expected = [
    ['first-finish', 'finished', 1],
    ['analyst', 'analyzed', 1],
    ['tactician', 'solved', 1],
    ['regular', 'finished', 5],
    ['problem-solver', 'solved', 5],
    ['deep-thinker', 'analyzed', 10],
    ['tactics-expert', 'solved', 15],
    ['veteran', 'finished', 25],
    ['practice-master', 'solved', 50],
  ]
  assert.equal(trainingMilestones([]).milestones.length, 12)
  assert.deepEqual(earned([]), [])
  for (const [id, metric, target] of expected) {
    for (const count of [target - 1, target, target + 1]) {
      const games = Array.from({ length: count }, (_, i) =>
        fixture(String(i), {
          result: metric === 'finished' ? 'Game ended.' : '',
          analysis: metric === 'analyzed' ? {} : null,
          attempts: metric === 'solved' ? { 2: { solved: true, tries: 1 } } : {},
        })
      )
      const badge = trainingMilestones(games).milestones.find((b) => b.id === id)
      assert.equal(badge.done, count >= target, `${id} at ${count}`)
      assert.equal(badge.current, Math.min(count, target))
    }
  }
})

test('repeat attempts and duplicate games cannot inflate solved-position counts', () => {
  storage()
  saveGame(fixture('practice'))
  recordAttempt('practice', 2, false)
  assert.equal(trainingMilestones(readLibrary().games).solved, 0)
  recordAttempt('practice', 2, true)
  recordAttempt('practice', 2, true)
  recordAttempt('practice', 2, false)
  const games = readLibrary().games
  assert.equal(trainingMilestones([...games, ...games]).solved, 1)
  assert.ok(readEarnedBadges().includes('tactician'))
  assert.equal(
    trainingMilestones([
      fixture('bad-attempts', {
        attempts: { 1: { solved: true }, 99: { solved: true }, invalid: { solved: true } },
      }),
    ]).solved,
    0
  )
  assert.deepEqual(earned([fixture('empty', { moves: [] })]), [])
})

test('earned badges survive saved-game eviction and storage errors do not break the UI', () => {
  const values = storage()
  for (let i = 0; i < 25; i++) saveGame(fixture(`finished-${i}`))
  assert.ok(readEarnedBadges().includes('veteran'))
  for (let i = 0; i < 55; i++) saveGame(fixture(`unfinished-${i}`, { result: '' }))
  assert.equal(readLibrary().games.length, 50)
  assert.ok(readLibrary().games.every((game) => !game.result))
  assert.ok(earned(readLibrary().games, readEarnedBadges()).includes('veteran'))
  values.set('evaluchess.badges.v1', '{bad json')
  assert.deepEqual(readEarnedBadges(), [])
  values.set('evaluchess.badges.v1', JSON.stringify(['veteran', 'unknown', 42]))
  assert.deepEqual(readEarnedBadges(), ['veteran'])
  globalThis.localStorage.setItem = () => {
    throw new Error('Storage unavailable')
  }
  assert.doesNotThrow(() => rememberEarnedBadges([fixture('new')]))
})
