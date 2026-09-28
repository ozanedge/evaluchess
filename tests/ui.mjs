import './build.mjs'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { spawn } from 'node:child_process'
import { scratchServer } from './server.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const server = await scratchServer()
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '41531', '--strictPort'],
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
  const a = await page(),
    b = await page()
  for (const tab of ['Speed Pair', 'Computer']) {
    await a.getByRole('button', { name: new RegExp('^' + tab) }).click()
    await a.getByText('5 minutes per player · No increment', { exact: true }).waitFor()
    assert.equal(await a.getByRole('button', { name: /^(3|5|10)\+0$/ }).count(), 0)
  }
  await a.getByRole('button', { name: /^Speed Pair/ }).click()
  await a.getByRole('button', { name: 'Start Game', exact: true }).click()
  await b.getByRole('button', { name: 'Start Game', exact: true }).click()
  await a.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await b.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await a.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.match
  )
  const match = await a.evaluate(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.match
  )
  const white = match.myColor === 'white' ? a : b,
    black = white === a ? b : a
  // Keyboard-independent square clicks exercise the actual board handlers.
  const square = (p, s) => p.locator(`[data-square="${s}"]`).first()
  let lost = false
  await white.route('**/api/move', async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true
      await route.fetch()
      await route.abort()
      return
    }
    await route.continue()
  })
  await square(white, 'e2').click()
  await square(white, 'e4').click()
  await white.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 1
  )
  await black.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 1
  )
  await white.getByRole('button', { name: 'Retry move', exact: true }).click()
  await white.waitForFunction(() => !document.body.innerText.includes('Retry to confirm your move'))
  assert.equal(
    await white.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.moves.length
    ),
    1
  )
  await black.reload()
  await black.getByRole('button', { name: 'Resume your saved online game' }).click()
  await black.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await square(black, 'e7').click()
  await square(black, 'e5').click()
  await white.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 2
  )
  assert.equal(await white.getByTestId('move-feedback-arrows').count(), 0)
  await square(white, 'e1').click()
  await square(white, 'e2').click()
  await white
    .getByTestId('move-feedback-arrows')
    .locator('[data-kind="played"][data-move="e1e2"]')
    .waitFor({ state: 'attached' })
  assert.equal(
    await white.getByTestId('move-feedback-arrows').locator('[data-kind="best"]').count(),
    1
  )
  assert.equal(await white.getByTestId('move-feedback-arrows').locator('[data-kind]').count(), 2)
  const colors = await white.evaluate(() => [
    getComputedStyle(document.querySelector('[data-testid="live-move-classification"]')).color,
    getComputedStyle(document.querySelector('[data-kind="played"]')).stroke,
  ])
  assert.equal(colors[0], colors[1])
  await black.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 3
  )
  assert.equal(await black.getByTestId('move-feedback-arrows').count(), 0)
  assert.equal(await black.getByTestId('live-move-classification').count(), 0)
  // Each client only sees feedback for its own move, with the correct orientation.
  assert.match(
    await white.locator('[data-kind="played"]').getAttribute('d'),
    /^M 450 750 L 450 650$/
  )
  await square(black, 'e8').click()
  await square(black, 'e7').click()
  await black.locator('[data-move="e8e7"]').waitFor({ state: 'attached' })
  assert.match(await black.locator('[data-move="e8e7"]').getAttribute('d'), /^M 350 750 L 350 650$/)
  await white.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 4
  )
  assert.equal(await white.locator('[data-move="e8e7"]').count(), 0)
  assert.equal(await white.getByTestId('live-move-classification').count(), 0)
  await white.screenshot({ path: '/tmp/evaluchess-move-feedback.png' })
  await black.reload()
  await black.getByRole('button', { name: 'Resume your saved online game' }).click()
  await black.locator('[data-move="e8e7"]').waitFor({ state: 'attached' })
  await black.getByRole('button', { name: 'Resign / New Game' }).click()
  await black.getByRole('button', { name: 'Resign game', exact: true }).click()
  await white.getByText('White wins by resignation.', { exact: true }).first().waitFor()
  await black.getByText('White wins by resignation.', { exact: true }).first().waitFor()
  await white.getByText('Game Analysis', { exact: true }).waitFor({ timeout: 30000 })
  assert.deepEqual(
    await white.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.moves
    ),
    ['e4', 'e5', 'Ke2', 'Ke7']
  )
  await white.getByRole('button', { name: 'Try this position again' }).waitFor()
  assert.equal(
    await white.getByTestId('move-feedback-arrows').count(),
    0,
    'the automatic practice suggestion must not reveal arrows'
  )
  await white.getByRole('button', { name: 'Opponent moves', exact: true }).click()
  await white.getByText('Ke7', { exact: true }).click()
  await white.locator('[data-move="e8e7"]').waitFor({ state: 'attached' })
  assert.equal(
    await white.getByTestId('move-feedback-arrows').evaluate((el) => el.getAnimations().length),
    0,
    'post-game arrows do not fade'
  )
  console.log('PASS: opponent move arrows remain available in post-game review')
  console.log(
    'PASS: two real clients agree on moves and result; refresh resumes the online game; real Stockfish analysis completes'
  )
  await white.getByRole('link', { name: 'Evaluchess home' }).click()
  await white.getByRole('button', { name: 'Start Game', exact: true }).click()
  await white.getByText('Looking for an opponent…', { exact: true }).waitFor()
  assert.equal(await white.getByText('Game Analysis', { exact: true }).count(), 0)
  await black.reload()
  await black.getByRole('button', { name: 'Start Game', exact: true }).click()
  for (const client of [white, black]) {
    await client.getByRole('button', { name: 'Resign / New Game' }).waitFor()
    await client.waitForFunction((oldId) => {
      const active = JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active
      return (
        active?.match?.gameId &&
        active.match.gameId !== oldId &&
        active.moves.length === 0 &&
        !active.result
      )
    }, match.gameId)
    await client.locator('[data-square="e2"] [data-piece="wP"]').waitFor()
  }
  await white.getByRole('button', { name: 'Resign / New Game' }).click()
  await white.getByRole('button', { name: 'Resign game', exact: true }).click()
  console.log(
    'PASS: Start Game after home navigation or refresh creates a fresh match instead of reopening the old result'
  )
  const practicePage = await page()
  const fixture = {
    id: 'practice-game',
    updatedAt: Date.now(),
    mode: 'computer',
    playerColor: 'black',
    moves: ['f3', 'e5', 'g4', 'Nc6'],
    tc: 1,
    difficulty: 1,
    whiteMs: 200000,
    blackMs: 200000,
    result: 'White resigned.',
    analysis: null,
  }
  await practicePage.evaluate(
    (fixture) =>
      localStorage.setItem(
        'evaluchess.library.v1',
        JSON.stringify({ version: 1, games: [fixture], active: fixture })
      ),
    fixture
  )
  await practicePage.reload()
  await practicePage.getByRole('button', { name: 'Resume your saved computer game' }).click()
  await practicePage.getByRole('button', { name: 'Retry analysis' }).click()
  await practicePage.getByText('Game Analysis', { exact: true }).waitFor({ timeout: 30000 })
  await practicePage.getByRole('button', { name: 'Try this position again' }).waitFor()
  assert.equal(await practicePage.getByTestId('move-feedback-arrows').count(), 0)
  await practicePage.getByRole('button', { name: 'Show answer', exact: true }).click()
  await practicePage.locator('[data-kind="best"][data-move="d8h4"]').waitFor({ state: 'attached' })
  await practicePage.getByRole('button', { name: 'Hide answer', exact: true }).click()
  assert.equal(await practicePage.getByTestId('move-feedback-arrows').count(), 0)
  await practicePage.getByRole('button', { name: 'Show answer', exact: true }).click()
  await practicePage.getByText('Nc6', { exact: true }).click()
  assert.equal(
    await practicePage.getByTestId('move-feedback-arrows').count(),
    0,
    'selecting a practice mistake hides its answer again'
  )
  await practicePage.getByRole('button', { name: 'Show answer', exact: true }).click()
  await practicePage.getByRole('button', { name: 'Try this position again' }).click()
  await practicePage.getByRole('dialog').waitFor()
  await practicePage.getByRole('button', { name: 'Close practice' }).click()
  await practicePage.getByText('Game Analysis', { exact: true }).waitFor()
  assert.equal(
    await practicePage.getByTestId('move-feedback-arrows').count(),
    0,
    'closing practice keeps the answer hidden'
  )
  console.log(
    'PASS: practice suggestions hide arrows until explicitly revealed, including selection and return from practice'
  )
  await practicePage.reload()
  await practicePage.getByRole('button', { name: 'My games', exact: true }).click()
  await practicePage.getByRole('region', { name: 'Saved games' }).waitFor()
  await practicePage.getByRole('button', { name: /Practice 2/ }).click()
  await practicePage.getByRole('dialog').waitFor()
  assert.equal(await practicePage.getByText('Engine answer revealed.', { exact: false }).count(), 0)
  await square(practicePage.getByRole('dialog'), 'd8').click()
  await square(practicePage.getByRole('dialog'), 'h4').click()
  await practicePage
    .getByText('Good move! Explore the engine continuation below.', { exact: true })
    .waitFor({ timeout: 30000 })
  await practicePage.waitForFunction(() => {
    const progress = document.querySelector('[aria-label="Continuation progress"]')?.textContent
    if (!progress) return false
    const [current, total] = progress.trim().split('/')
    return Number(total) > 0 && current === total
  })
  await practicePage.getByRole('button', { name: 'Close practice' }).click()
  assert.equal(
    await practicePage.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).games[0].attempts[3].solved
    ),
    true
  )
  await practicePage.reload()
  await practicePage.getByRole('button', { name: 'My games', exact: true }).click()
  await practicePage.getByText(/1\/1 mistakes practiced successfully/).waitFor()
  const download = practicePage.waitForEvent('download')
  await practicePage.getByRole('button', { name: 'Download PGN' }).click()
  assert.match((await download).suggestedFilename(), /\.pgn$/)
  console.log(
    'PASS: saved reviews reopen, practice hides the answer, a correct move is evaluated, progress persists, and PGN downloads'
  )
  const recovery = await page()
  await recovery.evaluate(
    (fixture) =>
      localStorage.setItem(
        'evaluchess.library.v1',
        JSON.stringify({ version: 1, games: [fixture], active: fixture })
      ),
    fixture
  )
  await recovery.reload()
  await recovery.getByRole('button', { name: 'Resume your saved computer game' }).click()
  await recovery.route('**/stockfish.js', (route) => route.abort())
  await recovery.getByRole('button', { name: 'Retry analysis' }).click()
  await recovery
    .getByText('Stockfish could not load. Check your connection and retry.', { exact: true })
    .waitFor()
  await recovery.unroute('**/stockfish.js')
  await recovery.getByRole('button', { name: 'Retry analysis' }).click()
  await recovery.getByRole('button', { name: 'Pause analysis' }).click()
  await recovery
    .getByText('Analysis paused. You can retry whenever you are ready.', { exact: true })
    .waitFor()
  await recovery.getByRole('button', { name: 'Retry analysis' }).click()
  await recovery.getByText('Game Analysis', { exact: true }).waitFor({ timeout: 30000 })
  await recovery.setViewportSize({ width: 390, height: 844 })
  await recovery.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
  assert.equal(
    await recovery.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Mobile view must not overflow'
  )
  await recovery.screenshot({ path: '/tmp/evaluchess-review-mobile.png', fullPage: true })
  console.log(
    'PASS: a lost move response retries without duplication; failed and cancelled analysis recovers; mobile layout fits'
  )
  const computer = await page()
  await computer.getByRole('button', { name: 'Computer', exact: true }).click()
  await computer.getByRole('button', { name: 'Start Game', exact: true }).click()
  await computer.waitForFunction(() => {
    const game = JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active
    return game?.whiteMs > 290000 && game.whiteMs <= 300000 && game.blackMs === 300000
  })
  await square(computer, 'e2').click()
  await square(computer, 'e4').click()
  await computer.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 2
  )
  // Drag callbacks can retain an older render; history must still include the computer reply.
  await square(computer, 'b1').scrollIntoViewIfNeeded()
  const knight = await square(computer, 'b1').boundingBox()
  const destination = await square(computer, 'c3').boundingBox()
  await computer.mouse.move(knight.x + knight.width / 2, knight.y + knight.height / 2)
  await computer.mouse.down()
  await computer.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 12 }
  )
  await computer.mouse.up()
  await computer.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 4
  )
  assert.equal(await computer.getByText('Retry computer move', { exact: false }).count(), 0)
  await computer.reload()
  await computer.getByRole('button', { name: 'Resume your saved computer game' }).click()
  await square(computer, 'g1').click()
  await square(computer, 'f3').click()
  await computer.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === 6
  )
  await computer.getByRole('button', { name: 'Resign / New Game' }).click()
  await computer.getByRole('button', { name: 'Resign game', exact: true }).click()
  await computer.getByText('Game Analysis', { exact: true }).waitFor({ timeout: 30000 })
  await computer.getByRole('button', { name: 'Play Again', exact: true }).click()
  await computer.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await computer.locator('[data-square="e2"] [data-piece="wP"]').waitFor()
  assert.equal(await computer.locator('[data-square="e2"] [data-piece="wP"]').count(), 1)
  console.log('PASS: computer moves, saved computer game resumes, and Play Again resets the board')
  // A deterministic engine makes optimal-move deduplication and stale-result races reproducible.
  const positions = new Chess(),
    enginePositions = {}
  for (const [san, bestMove, score] of [
    [null, 'e2e4', 0],
    ['e4', 'e7e5', 0],
    ['e5', 'f1c4', 0], // Nf3 also loses no evaluation: Best must still show one arrow.
    ['Nf3', 'b8c6', 0],
    ['Nc6', 'f1c4', 20],
    ['Ke2', 'g8f6', 300],
    ['Nf6', 'd2d3', -280],
    ['d3', 'd7d6', 280],
    ['d6', 'c1f4', -250],
    ['Bg5', 'h7h6', 270],
    ['h6', 'g5h4', -250],
  ]) {
    if (san) positions.move(san)
    enginePositions[positions.fen()] = { bestMove, score }
  }
  const feedback = await page((evaluations) => {
    window.__feedbackDelay = 30
    window.Worker = class extends EventTarget {
      fen = ''
      computer = false
      stopped = false
      postMessage(command) {
        const emit = (data) => {
          if (!this.stopped) this.dispatchEvent(new MessageEvent('message', { data }))
        }
        if (command === 'uci') queueMicrotask(() => emit('uciok'))
        if (command === 'isready') queueMicrotask(() => emit('readyok'))
        if (command.startsWith('setoption name UCI_LimitStrength'))
          this.computer = command.endsWith('true')
        if (command.startsWith('position fen ')) this.fen = command.slice(13)
        if (command.startsWith('go ')) {
          const result = evaluations[this.fen]
          if (!result) throw new Error('Unexpected test engine position: ' + this.fen)
          setTimeout(
            () => {
              emit(`info depth 16 score cp ${result.score} pv ${result.bestMove}`)
              emit(`bestmove ${result.bestMove}`)
            },
            this.computer ? 1200 : window.__feedbackDelay
          )
        }
      }
      terminate() {
        this.stopped = true
      }
    }
  }, enginePositions)
  await feedback.getByRole('button', { name: 'Computer', exact: true }).click()
  await feedback.getByRole('button', { name: 'Start Game', exact: true }).click()
  await square(feedback, 'e2').click()
  await square(feedback, 'e4').click()
  await feedback.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves.length === 2
  )
  assert.equal(await feedback.getByTestId('move-feedback-arrows').count(), 0)
  await square(feedback, 'g1').click()
  await square(feedback, 'f3').click()
  await feedback.locator('[data-kind="best"][data-move="g1f3"]').waitFor()
  assert.equal(
    await feedback.locator('[data-testid="move-feedback-arrows"] [data-kind]').count(),
    1
  )
  assert.equal(await feedback.locator('[data-kind="best"]').getAttribute('stroke'), '#39ff14')
  assert.equal(await feedback.getByTestId('live-move-classification').textContent(), 'Best')
  async function waitForFadeStart() {
    await feedback.waitForFunction(
      () =>
        document.querySelector('[data-testid="move-feedback-arrows"]')?.getAnimations()[0]
          ?.startTime != null
    )
  }
  await waitForFadeStart()
  const fadeStart = await feedback.getByTestId('move-feedback-arrows').evaluate((el) => {
    const animation = el.getAnimations()[0]
    return { start: animation.startTime, duration: animation.effect.getTiming().duration }
  })
  assert.equal(fadeStart.duration, 5000)
  await feedback.getByText('+0.2', { exact: true }).waitFor()
  assert.equal(await feedback.locator('[data-move="g1f3"]').count(), 1)
  assert.equal(
    await feedback
      .getByTestId('move-feedback-arrows')
      .evaluate((el) => el.getAnimations()[0].startTime),
    fadeStart.start,
    'the opponent reply must not restart the fade'
  )
  const fadingOpacity = await feedback
    .getByTestId('move-feedback-arrows')
    .evaluate((el) => Number(getComputedStyle(el).opacity))
  assert.ok(fadingOpacity > 0 && fadingOpacity < 0.9, 'arrows fade gradually during the reply')
  assert.equal(await feedback.getByTestId('live-move-classification').count(), 0)
  await feedback.evaluate(() => {
    window.__feedbackDelay = 2000
  })
  await square(feedback, 'e1').click()
  await square(feedback, 'e2').click()
  assert.equal(
    await feedback.getByTestId('move-feedback-arrows').count(),
    0,
    'clear the previous move immediately'
  )
  await feedback.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves.length === 6
  )
  await feedback.locator('[data-kind="played"][data-move="e1e2"]').waitFor({ state: 'attached' })
  assert.equal(await feedback.locator('[data-move="g8f6"]').count(), 0)
  await waitForFadeStart()
  const delayedFadeStart = await feedback
    .getByTestId('move-feedback-arrows')
    .evaluate((el) => el.getAnimations()[0].startTime)
  await feedback.getByText('-2.8', { exact: true }).waitFor()
  assert.equal(
    await feedback.locator('[data-move="e1e2"]').count(),
    1,
    'own delayed feedback survives the computer reply'
  )
  assert.equal(
    await feedback
      .getByTestId('move-feedback-arrows')
      .evaluate((el) => el.getAnimations()[0].startTime),
    delayedFadeStart
  )
  assert.equal(await feedback.getByTestId('live-move-classification').count(), 0)
  await feedback.waitForFunction(() => {
    const svg = document.querySelector('[data-testid="move-feedback-arrows"]')
    const opacity = svg && Number(getComputedStyle(svg).opacity)
    return opacity > 0 && opacity < 0.5
  })
  await feedback.getByTestId('move-feedback-arrows').waitFor({ state: 'detached', timeout: 6000 })
  // A second own move must invalidate the previous move's unfinished analysis.
  await square(feedback, 'd2').click()
  await square(feedback, 'd3').click()
  await feedback.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves.length === 8
  )
  await feedback.evaluate(() => {
    window.__feedbackDelay = 30
    window.__seenArrows = []
    window.__arrowObserver = new MutationObserver(() => {
      for (const arrow of document.querySelectorAll(
        '[data-testid="move-feedback-arrows"] [data-move]'
      ))
        window.__seenArrows.push(arrow.getAttribute('data-move'))
    })
    window.__arrowObserver.observe(document.body, { childList: true, subtree: true })
  })
  await square(feedback, 'c1').click()
  await square(feedback, 'g5').click()
  await feedback.locator('[data-move="c1g5"]').waitFor({ state: 'attached' })
  assert.equal(
    await feedback.evaluate(() => window.__seenArrows.includes('d2d3')),
    false,
    'superseded own feedback must never reappear'
  )
  await feedback.evaluate(() => window.__arrowObserver.disconnect())
  await feedback.getByRole('link', { name: 'Evaluchess home' }).click()
  assert.equal(await feedback.getByTestId('move-feedback-arrows').count(), 0)
  await feedback.close()
  console.log(
    'PASS: own arrows fade over five seconds, survive opponent replies and delayed evaluation, clear on the next own move; post-game arrows stay visible'
  )
  const settings = await page()
  await settings.evaluate(() => {
    const game = {
      id: 'promotion-settings',
      updatedAt: Date.now(),
      mode: 'computer',
      playerColor: 'white',
      moves: ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2'],
      tc: 1,
      difficulty: 1,
      whiteMs: 200000,
      blackMs: 200000,
      result: '',
      analysis: null,
    }
    localStorage.setItem(
      'evaluchess.library.v1',
      JSON.stringify({ version: 1, games: [game], active: game })
    )
  })
  await settings.reload()
  await settings.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await settings.getByLabel('Promotion piece').inputValue(), 'q')
  await settings.getByLabel('Promotion piece').selectOption('n')
  await settings.keyboard.press('Escape')
  assert.equal(await settings.getByRole('region', { name: 'Player settings' }).count(), 0)
  assert.equal(
    await settings
      .getByRole('button', { name: 'Settings', exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  )
  await settings.reload()
  await settings.getByRole('button', { name: 'Resume your saved computer game' }).click()
  assert.equal(await settings.getByText('Promote pawn to', { exact: true }).count(), 0)
  assert.equal(await settings.getByLabel('Promotion piece').count(), 0)
  await settings.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await settings.getByLabel('Promotion piece').inputValue(), 'n')
  const settingsPanel = settings.getByRole('region', { name: 'Player settings' })
  assert.equal(
    await settingsPanel.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(23, 23, 34)'
  )
  assert.equal(
    await settingsPanel.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.bottom - 5))
    }),
    true,
    'settings must sit above the board and clocks'
  )
  await settings.setViewportSize({ width: 390, height: 844 })
  const panelBox = await settingsPanel.boundingBox()
  assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, 'settings fit on mobile')
  await settings.screenshot({ path: '/tmp/evaluchess-settings-mobile.png' })
  await settings.setViewportSize({ width: 1280, height: 900 })
  await square(settings, 'b7').click()
  assert.equal(await settingsPanel.count(), 0, 'outside board click closes the menu')
  await square(settings, 'a8').click()
  await settings.waitForFunction(() =>
    JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.moves[8]?.includes('=N')
  )
  await settings.close()
  console.log(
    'PASS: opaque guest settings sit above the game, fit mobile, dismiss with Escape/outside clicks, persist promotion, and produce a knight underpromotion'
  )
  const account = await page()
  await account.getByRole('button', { name: 'Sign in', exact: true }).click()
  await account.getByRole('button', { name: 'Create one', exact: true }).click()
  await account.getByLabel('Username').fill('BrowserPlayer')
  await account.getByLabel('Password').fill('browser-password')
  await account.getByRole('button', { name: 'Create account', exact: true }).click()
  await account.getByRole('button', { name: /BrowserPlayer/ }).waitFor()
  await account.reload()
  await account.getByRole('button', { name: /BrowserPlayer/ }).click()
  await account.getByLabel('Promotion piece').selectOption('r')
  await account.screenshot({ path: '/tmp/evaluchess-settings-account.png' })
  await account.reload()
  await account.getByRole('button', { name: /BrowserPlayer/ }).click()
  assert.equal(await account.getByLabel('Promotion piece').inputValue(), 'r')
  await account.getByRole('button', { name: 'Sign out', exact: true }).click()
  await account.getByRole('button', { name: 'Sign in', exact: true }).click()
  await account.getByLabel('Username').fill('browserplayer')
  await account.getByLabel('Password').fill('browser-password')
  await account.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click()
  await account.getByRole('button', { name: /BrowserPlayer/ }).waitFor()
  console.log(
    'PASS: DynamoDB account signup, session restore, sign-out and sign-in work in the browser'
  )
  const store = await import('../.test-build/api/_store.js')
  const { createGame } = await import('../.test-build/src/lib/gameRules.js')
  const { gameKey, updateGame } = await import('../.test-build/api/_game.js')
  const { startingRating } = await import('../.test-build/api/_identity.js')
  const rankedGame = createGame('browser-leaderboard-game', '5+0', Date.now())
  rankedGame.players = {
    white: {
      uid: await store.get('evaluchess:username:v1:browserplayer'),
      username: 'BrowserPlayer',
      rating: startingRating(),
    },
    black: { uid: 'ui-ranked-opponent', username: 'RankedOpponent', rating: startingRating() },
  }
  await store.set(gameKey(rankedGame.id), rankedGame)
  await updateGame(rankedGame.id, 'black', { type: 'resign' })
  let failLeaderboard = true
  await account.route('**/api/leaderboard', (route) =>
    failLeaderboard
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Leaderboard temporarily unavailable' }),
        })
      : route.continue()
  )
  await account.getByRole('button', { name: 'Leaderboard', exact: true }).click()
  await account.getByText('Top 10 by wins').waitFor()
  await account.getByRole('alert').getByText('Leaderboard temporarily unavailable').waitFor()
  assert.equal(
    await account.getByText('No rated games in the last 24 hours. Be the first.').count(),
    0
  )
  failLeaderboard = false
  await account.getByRole('button', { name: 'Retry', exact: true }).click()
  await account
    .locator('div.grid > span')
    .filter({ hasText: /^BrowserPlayer$/ })
    .waitFor()
  assert.equal(await account.getByRole('alert').count(), 0)
  await account.getByText('· Last 24 hours', { exact: true }).waitFor()
  await account.getByText('Elo', { exact: true }).waitFor()
  await account.getByText('Δ Elo', { exact: true }).waitFor()
  const rankedRow = account.locator('div.grid').filter({ hasText: 'BrowserPlayer' })
  assert.equal(await rankedRow.locator(':scope > span').nth(2).textContent(), '1')
  assert.equal(await rankedRow.locator(':scope > span').nth(3).textContent(), '1216')
  assert.equal(await rankedRow.locator(':scope > span').nth(4).textContent(), '+16')
  const eloHeader = await account.getByText('Elo', { exact: true }).boundingBox()
  const deltaHeader = await account.getByText('Δ Elo', { exact: true }).boundingBox()
  assert.ok(
    eloHeader.x + eloHeader.width <= deltaHeader.x,
    'current Elo is left of the 24-hour change'
  )
  console.log('PASS: leaderboard errors stay visible and Retry reloads DynamoDB rankings')
  const { pair } = await import('../.test-build/api/_matchmaking.js')
  const botId = crypto.randomUUID(),
    botSession = crypto.randomUUID()
  const botIdentity = {
    uid: botId,
    username: 'FallbackBot',
    usernameLower: 'fallbackbot',
    createdAt: 0,
    bot: true,
    rating: { elo: 950, wins: 0, losses: 0, draws: 0, gamesPlayed: 0 },
  }
  await pair(botId, botSession, '5+0', false, 'FallbackBot', botIdentity, true)
  const fallbackPage = await page()
  let firstJoinAt
  fallbackPage.on('request', (request) => {
    if (request.url().endsWith('/api/join') && !firstJoinAt) firstJoinAt = Date.now()
  })
  await fallbackPage.getByRole('button', { name: 'Start Game', exact: true }).click()
  await fallbackPage.getByText('Looking for an opponent…').waitFor()
  await fallbackPage.getByRole('button', { name: 'Resign / New Game' }).waitFor({ timeout: 20000 })
  assert.ok(Date.now() - firstJoinAt >= 12000, 'browser gives humans a full 12 seconds')
  await fallbackPage.getByText('FallbackBot', { exact: true }).waitFor()
  await fallbackPage.getByText('Bot', { exact: true }).waitFor()
  await fallbackPage.getByRole('button', { name: 'Resign / New Game' }).click()
  await fallbackPage.getByRole('button', { name: 'Resign game', exact: true }).click()
  await fallbackPage.close()
  console.log(
    'PASS: browser automatically pairs with a labelled bot after 12 seconds, without another click'
  )
  assert.deepEqual(errors, [])
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
