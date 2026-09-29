import './build.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { Chess } from 'chess.js'
import { scratchServer } from './server.mjs'
import { buildAnalysis } from '../.test-build/src/utils/analysis.js'
import { chromium } from 'playwright-core'
const server = await scratchServer()
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '41531',
    '--strictPort',
  ],
  { env: { ...process.env, EVALUCHESS_API_URL: server.url }, stdio: ['ignore', 'pipe', 'pipe'] }
)
let browser
const errors = []
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 10000)
    vite.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error('Preview exited ' + code))
    })
    vite.stdout.on('data', (data) => {
      if (String(data).includes('41531')) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true,
    chromiumSandbox: true,
  })
  const newDevice = async () => {
    const context = await browser.newContext()
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://127.0.0.1:41531')
    return page
  }
  const signin = async (page, username, signup = false) => {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    if (signup) await page.getByRole('button', { name: 'Create one', exact: true }).click()
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill('progress-password')
    await page
      .locator('form')
      .getByRole('button', { name: signup ? 'Create account' : 'Sign in', exact: true })
      .click()
    await page.getByRole('button', { name: new RegExp(username + '.*1200') }).waitFor()
  }
  const chess = new Chess(),
    moves = []
  for (let i = 0; i < 40; i++) {
    const move = chess.moves()[0]
    chess.move(move)
    moves.push(move)
  }
  const games = Array.from({ length: 10 }, (_, i) => {
    const analysis = buildAnalysis(
      moves,
      Array.from({ length: 41 }, () => ({ score: 0, mate: null, bestMove: null }))
    )
    analysis.moves.forEach((move, ply) => {
      move.accuracy = ply % 2 ? 5 : i < 5 ? 70 : 92
      move.classification = ply % 2 || (i < 5 && ply < 4) ? 'blunder' : 'best'
    })
    return {
      id: `progress-${i}`,
      updatedAt: Date.now() - 100000 + i * 1000,
      completedAt: Date.now() - 100000 + i * 1000,
      mode: 'computer',
      playerColor: 'white',
      moves,
      tc: 1,
      difficulty: 1,
      whiteMs: 100000,
      blackMs: 100000,
      result: 'Game ended.',
      analysis,
      attempts: i < 5 ? { 0: { solved: true, tries: 2, lastAt: Date.now() } } : {},
    }
  })
  const first = await newDevice()
  await first.evaluate(
    (games) =>
      localStorage.setItem(
        'evaluchess.library.v1',
        JSON.stringify({ version: 1, games, active: games[9] })
      ),
    games
  )
  await first.reload()
  await signin(first, 'ProgressAlice', true)
  await first.getByText('Saved to your account', { exact: true }).waitFor({ timeout: 60000 })
  const account = await first.evaluate(
    async () => (await (await fetch('/api/auth')).json()).user.uid
  )
  assert.equal(await first.evaluate(() => localStorage.getItem('evaluchess.library.v1')), null)
  await first.getByRole('button', { name: 'My progress', exact: true }).click()
  await first.getByRole('region', { name: 'Your improvement' }).waitFor()
  await first.locator('.progress-summary').getByText('92.0%', { exact: true }).waitFor()
  await first.getByText('+22.0 pts vs previous 5', { exact: true }).waitFor()
  assert.equal(
    await first
      .locator('.milestone')
      .filter({ hasText: 'Precision' })
      .locator('.milestone-status')
      .textContent(),
    'Unlocked'
  )
  for (const width of [1440, 390, 320]) {
    await first.setViewportSize({ width, height: 1000 })
    assert.ok(
      await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `progress fits ${width}px`
    )
    await first.screenshot({
      path: `/tmp/evaluchess-account-progress-${width}.png`,
      fullPage: true,
    })
  }
  const second = await newDevice()
  await signin(second, 'ProgressAlice')
  await second.getByText('Saved to your account', { exact: true }).waitFor({ timeout: 60000 })
  await second.getByRole('button', { name: 'My games', exact: true }).click()
  assert.equal(
    await second.getByRole('region', { name: 'Saved games' }).locator('article').count(),
    10
  )
  assert.equal(
    await second.evaluate(
      (uid) =>
        JSON.parse(localStorage.getItem('evaluchess.library.v1:' + uid)).games.find(
          (g) => g.id === 'progress-0'
        ).attempts[0].solved,
      account
    ),
    true
  )
  await second.getByRole('button', { name: 'My progress', exact: true }).click()
  await second.locator('.progress-summary').getByText('92.0%', { exact: true }).waitFor()
  console.log(
    'PASS: existing browser games, solved practice and badges import to the account and restore on a fresh device; personal trends fit 320–1440px'
  )
  // Block uploads, make a new local game, then reconnect and retry the pending save.
  let offline = true
  await second.route('**/api/library*', (route) => (offline ? route.abort() : route.continue()))
  await second.getByRole('button', { name: 'Computer', exact: true }).click()
  await second.getByRole('button', { name: 'Start Game', exact: true }).click()
  await second.locator('[data-square="e2"] [data-piece="wP"]').click()
  await second.locator('[data-square="e4"]').click()
  await second.waitForFunction((uid) => {
    const active = JSON.parse(localStorage.getItem('evaluchess.library.v1:' + uid))?.active
    return (
      active && !active.result && !active.id.startsWith('progress-') && active.moves.length >= 1
    )
  }, account)
  const newGameId = await second.evaluate(
    (uid) => JSON.parse(localStorage.getItem('evaluchess.library.v1:' + uid)).active.id,
    account
  )
  await second.waitForTimeout(6000)
  await second.reload()
  await second.getByRole('button', { name: 'Retry sync', exact: true }).waitFor({ timeout: 30000 })
  assert.ok(
    await second.evaluate(
      ({ uid, id }) => JSON.parse(localStorage.getItem('evaluchess.pending.v1:' + uid))[id],
      { uid: account, id: newGameId }
    )
  )
  offline = false
  await second.getByRole('button', { name: 'Retry sync', exact: true }).click()
  await second.getByText('Saved to your account', { exact: true }).waitFor({ timeout: 30000 })
  await first.reload()
  await first.getByText('Saved to your account', { exact: true }).waitFor({ timeout: 30000 })
  await first.getByRole('button', { name: 'My games', exact: true }).click()
  assert.equal(
    await first.getByRole('region', { name: 'Saved games' }).locator('article').count(),
    11
  )
  await first.getByRole('button', { name: 'Resume game', exact: true }).click()
  await first.locator('[data-square="e4"] [data-piece="wP"]').waitFor()
  await first.getByRole('button', { name: /ProgressAlice.*1200/ }).click()
  await first.getByRole('button', { name: 'Sign out', exact: true }).click()
  await first.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
  await first.waitForTimeout(1500)
  assert.equal(
    await first.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1') || '{"games":[]}').games.length
    ),
    0,
    'signing out during play does not save the old account game into the guest collection'
  )
  await second.getByRole('button', { name: /ProgressAlice.*1200/ }).click()
  await second.getByRole('button', { name: 'Sign out', exact: true }).click()
  await signin(second, 'ProgressBob', true)
  await second.getByText('Saved to your account', { exact: true }).waitFor({ timeout: 30000 })
  await second.getByRole('button', { name: 'My games', exact: true }).click()
  assert.equal(
    await second.getByRole('region', { name: 'Saved games' }).locator('article').count(),
    0
  )
  await second.getByRole('button', { name: 'My progress', exact: true }).click()
  await second
    .getByText('Finish and analyze a game to start tracking your improvement.', { exact: true })
    .waitFor()
  console.log(
    'PASS: interrupted uploads stay queued across reload, retry sync restores them, and switching accounts does not expose or import another player’s games'
  )
  assert.deepEqual(errors, [])
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
