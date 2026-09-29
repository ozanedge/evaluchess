import './build.mjs'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { spawn } from 'node:child_process'
import { scratchServer } from './server.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
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
  {
    env: {
      ...process.env,
      EVALUCHESS_API_URL: server.url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
)
let browser
const errors = []
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startup timed out')), 10000)
    vite.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error('Vite exited ' + code))
    })
    vite.stdout.on('data', (data) => {
      if (String(data).includes('41531')) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    headless: true,
    chromiumSandbox: true,
  })
  async function page(initialize, initArg) {
    const context = await browser.newContext()
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    )
    if (initialize) await context.addInitScript(initialize, initArg)
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://127.0.0.1:41531')
    return page
  }
  const lobby = await page()
  assert.equal(await lobby.locator('.milestone').count(), 12)
  assert.equal(
    await lobby
      .getByRole('progressbar', { name: 'Training milestones unlocked' })
      .getAttribute('aria-valuemax'),
    '12'
  )
  assert.equal(
    await lobby
      .locator('.milestone')
      .filter({ hasText: 'Practice Master' })
      .locator('.milestone-status')
      .textContent(),
    '0/50'
  )
  assert.equal(
    await lobby
      .getByRole('progressbar', { name: 'Training milestones unlocked' })
      .getAttribute('aria-valuenow'),
    '0'
  )
  await lobby.setViewportSize({ width: 1440, height: 1040 })
  await lobby.screenshot({ path: '/tmp/evaluchess-redesign-desktop.png', fullPage: true })
  for (const width of [1024, 768, 390, 320]) {
    await lobby.setViewportSize({ width, height: 844 })
    await lobby.waitForTimeout(100)
    assert.ok(
      await lobby.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `no overflow at ${width}px`
    )
    const header = await lobby.locator('header').boundingBox()
    const main = await lobby.locator('main').boundingBox()
    assert.ok(header.y + header.height <= main.y, 'header precedes lobby on mobile')
    await lobby.getByRole('button', { name: 'Settings', exact: true }).click()
    const settingsBox = await lobby.getByRole('region', { name: 'Player settings' }).boundingBox()
    assert.ok(
      settingsBox.x >= 0 && settingsBox.x + settingsBox.width <= width,
      `settings fit at ${width}px`
    )
    await lobby.keyboard.press('Escape')
    if (width === 390)
      await lobby.screenshot({ path: '/tmp/evaluchess-redesign-mobile.png', fullPage: true })
  }
  await lobby.setViewportSize({ width: 1440, height: 1040 })
  await lobby.getByRole('button', { name: 'Computer', exact: true }).click()
  await lobby.getByRole('button', { name: 'Start Game', exact: true }).click()
  await lobby.getByText('White to move', { exact: true }).waitFor()
  await lobby.screenshot({ path: '/tmp/evaluchess-redesign-live.png', fullPage: true })
  await lobby.close()
  const { reconstruct } = await import('../.test-build/src/lib/library.js')
  const { buildAnalysis } = await import('../.test-build/src/utils/analysis.js')
  const moves = ['e4', 'e5', 'Nf3', 'Nc6']
  const restored = reconstruct(moves)
  const analysis = buildAnalysis(
    moves,
    restored.fens.map((fen) => {
      const move = new Chess(fen).moves({ verbose: true })[0]
      return { score: 0, mate: null, bestMove: move.from + move.to, pv: [] }
    })
  )
  analysis.moves[2].classification = 'mistake'
  const fixture = {
    id: 'redesign',
    updatedAt: Date.now(),
    mode: 'computer',
    playerColor: 'white',
    moves,
    tc: 1,
    difficulty: 1,
    whiteMs: 200000,
    blackMs: 200000,
    result: 'You resigned.',
    analysis,
  }
  const training = await page((fixture) => {
    localStorage.setItem(
      'evaluchess.library.v1',
      JSON.stringify({ version: 1, games: [fixture], active: fixture })
    )
  }, fixture)
  await training.setViewportSize({ width: 1440, height: 1040 })
  const progress = training.getByRole('progressbar', { name: 'Training milestones unlocked' })
  assert.equal(await progress.getAttribute('aria-valuenow'), '2')
  await training.getByRole('button', { name: 'Turn a mistake into a strength' }).click()
  const practice = training.getByRole('main', { name: 'Position practice' })
  await practice.waitFor()
  assert.equal(await training.getByRole('dialog').count(), 0)
  assert.equal(await training.locator('[data-square]').count(), 64)
  assert.equal(await training.getByTestId('move-feedback-arrows').count(), 0)
  await practice.locator('[data-square="g1"] [data-piece="wN"]').waitFor()
  await training.screenshot({ path: '/tmp/evaluchess-inline-practice-desktop.png', fullPage: true })
  for (const width of [390, 320]) {
    await training.setViewportSize({ width, height: 844 })
    await training.waitForTimeout(100)
    assert.ok(await training.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await training.locator('[data-square]').count(), 64)
    if (width === 390)
      await training.screenshot({
        path: '/tmp/evaluchess-inline-practice-mobile.png',
        fullPage: true,
      })
  }
  await training.setViewportSize({ width: 1440, height: 1040 })
  await training.getByRole('button', { name: 'Settings', exact: true }).click()
  await training.getByRole('region', { name: 'Player settings' }).waitFor()
  await training.keyboard.press('Escape')
  assert.equal(await practice.count(), 1, 'settings remain accessible during inline practice')
  await training.getByRole('button', { name: 'Reveal answer' }).click()
  await training.getByText('Engine answer revealed.', { exact: false }).waitFor({ timeout: 30000 })
  await training.getByRole('button', { name: 'Try again', exact: true }).click()
  await training.waitForTimeout(1000)
  await practice.locator('[data-square="g1"] [data-piece="wN"]').waitFor()
  assert.equal(
    await training.getByLabel('Continuation progress').count(),
    0,
    'retry cancels automatic continuation'
  )
  assert.equal(await training.getByTestId('move-feedback-arrows').count(), 0)
  await training.getByRole('button', { name: /Back to (review|menu)/ }).click()
  assert.equal(await training.locator('[data-square]').count(), 64)
  assert.equal(
    await progress.getAttribute('aria-valuenow'),
    '2',
    'revealing a position does not earn a solving badge'
  )
  console.log(
    'PASS: practice uses one inline board, fits desktop/mobile, keeps settings accessible, and cancels continuation on retry'
  )
  await training.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('evaluchess.library.v1'))
    library.games[0].attempts = { 2: { solved: true, tries: 1, lastAt: Date.now() } }
    localStorage.setItem('evaluchess.library.v1', JSON.stringify(library))
  })
  // Refresh via navigation without reapplying the fixture init script.
  await training.getByRole('button', { name: 'My games', exact: true }).click()
  await training.getByRole('button', { name: /^Speed Pair/ }).click()
  assert.equal(await progress.getAttribute('aria-valuenow'), '3')
  assert.equal(
    await training.getByRole('button', { name: 'Turn a mistake into a strength' }).count(),
    0
  )
  await training.screenshot({ path: '/tmp/evaluchess-redesign-training.png', fullPage: true })
  const completedJourney = await page()
  await completedJourney.evaluate((fixture) => {
    const games = Array.from({ length: 25 }, (_, index) => ({
      ...fixture,
      id: `badge-${index}`,
      attempts: {
        0: { solved: true, tries: 1, lastAt: Date.now() },
        2: { solved: true, tries: 1, lastAt: Date.now() },
      },
    }))
    localStorage.setItem(
      'evaluchess.library.v1',
      JSON.stringify({ version: 1, games, active: null })
    )
  }, fixture)
  await completedJourney.reload()
  await completedJourney.getByText('9/12 unlocked', { exact: true }).waitFor()
  assert.equal(await completedJourney.locator('.milestone.earned').count(), 9)
  await completedJourney.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.badges.v1') || '[]').length === 9
  )
  for (const width of [1440, 390, 320]) {
    await completedJourney.setViewportSize({ width, height: 1040 })
    assert.ok(
      await completedJourney.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    await completedJourney
      .locator('.training-card')
      .screenshot({ path: `/tmp/evaluchess-nine-badges-${width}.png` })
  }
  await completedJourney.evaluate(() =>
    localStorage.setItem(
      'evaluchess.library.v1',
      JSON.stringify({ version: 1, games: [], active: null })
    )
  )
  await completedJourney.reload()
  await completedJourney.getByText('9/12 unlocked', { exact: true }).waitFor()
  await completedJourney.close()
  console.log(
    'PASS: nine badges show progress, unlock from saved activity, fit mobile, and remain earned after history is removed'
  )
  await training.getByRole('button', { name: 'Review your saved computer game' }).click()
  await training.getByText('Game Analysis', { exact: true }).waitFor()
  await training.getByRole('slider', { name: 'Move to review' }).press('Home')
  await training.locator('[data-square="e2"] [data-piece="wP"]').waitFor()
  await training.getByRole('slider', { name: 'Move to review' }).press('End')
  await training.locator('[data-square="e4"] [data-piece="wP"]').waitFor()
  await training.locator('button[data-move-index="0"]').press('Enter')
  await training.locator('[data-square="e2"] [data-piece="wP"]').waitFor()
  await training.locator('button[data-move-index="2"]').click()
  await training.waitForTimeout(400)
  await training.screenshot({ path: '/tmp/evaluchess-redesign-review.png', fullPage: true })
  await training.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await training.locator('.result-card').evaluate((el) => getComputedStyle(el).animationName),
    'none'
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: desktop and mobile layouts fit at 320–1440px; settings remain reachable; real training milestones unlock and open practice; reduced motion is respected'
  )
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
