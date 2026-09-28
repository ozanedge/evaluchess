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
  const positions = new Chess(),
    evaluations = {}
  const sequence = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qe5+', 'Be2', 'Nc6', 'Nf3', 'Nf6']
  for (const san of [null, ...sequence]) {
    if (san) positions.move(san)
    const legal = positions.moves({ verbose: true })[0]
    evaluations[positions.fen()] = legal.from + legal.to + (legal.promotion || '')
  }
  function mockEngine(evaluations) {
    window.__audioNotes = []
    window.__audioContexts = 0
    const OriginalAudioContext = window.AudioContext
    window.AudioContext = class extends OriginalAudioContext {
      constructor(...args) {
        super(...args)
        window.__audioContexts++
      }
      createOscillator() {
        const oscillator = super.createOscillator()
        const start = oscillator.start.bind(oscillator)
        oscillator.start = (...args) => {
          window.__audioNotes.push(oscillator.frequency.value)
          return start(...args)
        }
        return oscillator
      }
    }

    window.Worker = class extends EventTarget {
      fen = ''
      stopped = false
      postMessage(command) {
        const emit = (data) => {
          if (!this.stopped) this.dispatchEvent(new MessageEvent('message', { data }))
        }
        if (command === 'uci') queueMicrotask(() => emit('uciok'))
        if (command === 'isready') queueMicrotask(() => emit('readyok'))
        if (command.startsWith('position fen ')) this.fen = command.slice(13)
        if (command.startsWith('go ')) {
          const best = evaluations[this.fen]
          if (!best) throw new Error('Unexpected position ' + this.fen)
          setTimeout(() => {
            emit(`info depth 16 score cp 0 pv ${best}`)
            emit(`bestmove ${best}`)
          }, 20)
        }
      }
      terminate() {
        this.stopped = true
      }
    }
  }
  const a = await page(mockEngine, evaluations),
    b = await page(mockEngine, evaluations)
  async function settings(p) {
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
  }
  await settings(a)
  for (const [name, checked] of [
    ['Move feedback', true],
    ['Sound', false],
    ['Premoves', true],
    ['Confirm resignation', true],
  ]) {
    assert.equal(await a.getByRole('switch', { name, exact: true }).isChecked(), checked)
  }
  await a.getByLabel('Board colors').selectOption('blue')
  await a.getByLabel('Piece style').selectOption('modern')
  await a.reload()
  await settings(a)
  assert.equal(await a.getByLabel('Board colors').inputValue(), 'blue')
  assert.equal(await a.getByLabel('Piece style').inputValue(), 'modern')
  assert.equal(await a.locator('[data-piece-style="modern"]').count(), 32)
  assert.ok(
    await a
      .locator('[data-square="a8"]')
      .evaluate((el) =>
        [el, ...el.querySelectorAll('*')].some(
          (child) => getComputedStyle(child).backgroundColor === 'rgb(227, 234, 240)'
        )
      )
  )
  await a.screenshot({ path: '/tmp/evaluchess-all-settings.png' })
  await a.keyboard.press('Escape')
  for (const p of [a, b]) await p.getByRole('button', { name: 'Start Game', exact: true }).click()
  for (const p of [a, b]) await p.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await a.waitForFunction(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.match
  )
  const white = (await a.evaluate(
    () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.match.myColor === 'white'
  ))
    ? a
    : b
  const black = white === a ? b : a
  const square = (p, s) => p.locator(`[data-square="${s}"]`).first()
  async function moves(n) {
    for (const p of [white, black])
      await p.waitForFunction(
        (n) =>
          JSON.parse(localStorage.getItem('evaluchess.library.v1'))?.active?.moves?.length === n,
        n
      )
  }
  async function play(p, from, to) {
    await square(p, from).click({ timeout: 1000 })
    await square(p, to).click({ timeout: 1000 })
  }
  const notes = (p) => p.evaluate(() => window.__audioNotes)
  async function expectNotes(expected) {
    await white.waitForFunction((n) => window.__audioNotes.length >= n, expected.length)
    assert.deepEqual(await notes(white), expected)
  }
  await play(white, 'e2', 'e4')
  await moves(1)
  assert.equal(await white.evaluate(() => window.__audioContexts), 0)
  assert.equal(await black.evaluate(() => window.__audioContexts), 0)
  await settings(white)
  await white.getByRole('switch', { name: 'Sound', exact: true }).check()
  await white.keyboard.press('Escape')
  await play(black, 'd7', 'd5')
  await moves(2)
  await expectNotes([440])
  await play(white, 'e4', 'd5')
  await moves(3)
  await expectNotes([440, 330, 220])
  await play(black, 'd8', 'd5')
  await moves(4)
  await expectNotes([440, 330, 220, 330, 220])
  await play(white, 'b1', 'c3')
  await moves(5)
  await white.getByTestId('move-feedback-arrows').waitFor({ state: 'attached' })
  await settings(white)
  await white.getByRole('switch', { name: 'Move feedback', exact: true }).uncheck()
  await white.getByRole('switch', { name: 'Premoves', exact: true }).uncheck()
  await white.keyboard.press('Escape')
  assert.equal(await white.getByTestId('move-feedback-arrows').count(), 0)
  assert.equal(await white.getByTestId('live-move-classification').count(), 0)
  await play(white, 'g1', 'f3')
  assert.doesNotMatch(
    await square(white, 'f3').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/
  )
  await play(black, 'd5', 'e5')
  await moves(6)
  await expectNotes([440, 330, 220, 330, 220, 440, 660, 880])
  await play(white, 'f1', 'e2')
  await moves(7)
  await settings(white)
  await white.getByRole('switch', { name: 'Premoves', exact: true }).check()
  await white.keyboard.press('Escape')
  await play(white, 'g1', 'f3')
  assert.match(
    await square(white, 'f3').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/
  )
  await settings(white)
  await white.getByRole('switch', { name: 'Premoves', exact: true }).uncheck()
  await white.keyboard.press('Escape')
  assert.doesNotMatch(
    await square(white, 'f3').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/
  )
  await play(black, 'b8', 'c6')
  await moves(8)
  await play(white, 'g1', 'f3')
  await moves(9)
  assert.equal(await white.getByTestId('move-feedback-arrows').count(), 0)
  assert.equal(await white.getByTestId('live-move-classification').count(), 0)
  await settings(white)
  await white.getByRole('switch', { name: 'Sound', exact: true }).uncheck()
  await white.keyboard.press('Escape')
  const beforeMute = await notes(white)
  await play(black, 'g8', 'f6')
  await moves(10)
  assert.deepEqual(await notes(white), beforeMute)
  assert.equal(await black.evaluate(() => window.__audioContexts), 0)
  await white.getByRole('button', { name: 'Resign / New Game' }).click()
  await white.getByRole('group', { name: 'Confirm resignation' }).waitFor()
  assert.equal(await white.getByText('Game Analysis', { exact: true }).count(), 0)
  await white.getByRole('button', { name: 'Keep playing' }).click()
  await white.getByRole('button', { name: 'Resign / New Game' }).waitFor()
  await settings(white)
  await white.getByRole('switch', { name: 'Confirm resignation', exact: true }).uncheck()
  await white.keyboard.press('Escape')
  await white.getByRole('button', { name: 'Resign / New Game' }).click()
  await white.getByText('Black wins by resignation.', { exact: true }).first().waitFor()
  await white.getByText('Game Analysis', { exact: true }).waitFor()
  assert.equal(await white.getByRole('group', { name: 'Confirm resignation' }).count(), 0)
  await white.getByText('Nc3', { exact: true }).click()
  await white.getByTestId('move-feedback-arrows').waitFor({ state: 'attached' })
  assert.deepEqual(await notes(white), beforeMute, 'review never plays move sounds')
  console.log(
    'PASS: settings persist; themes and pieces render; sound defaults off and distinguishes moves/captures/check; mute takes effect immediately'
  )
  console.log(
    'PASS: feedback toggle affects live play only; disabled premoves cannot queue and cancel existing queues; resignation can be canceled or confirmation disabled'
  )

  const lowTime = await page(mockEngine, evaluations)
  await lowTime.evaluate(() => {
    localStorage.setItem('evaluchess.settings.v1', JSON.stringify({ sound: true }))
    const game = {
      id: 'low-clock',
      updatedAt: Date.now(),
      mode: 'computer',
      playerColor: 'white',
      moves: [],
      tc: 1,
      difficulty: 1,
      whiteMs: 20500,
      blackMs: 300000,
      result: '',
      analysis: null,
    }
    localStorage.setItem(
      'evaluchess.library.v1',
      JSON.stringify({ version: 1, games: [game], active: game })
    )
  })
  await lowTime.reload()
  assert.deepEqual(await notes(lowTime), [])
  await lowTime.getByRole('button', { name: 'Resume your saved computer game' }).click()
  await lowTime.waitForFunction(() => window.__audioNotes.length === 3)
  assert.deepEqual(await notes(lowTime), [880, 660, 880])
  await lowTime.waitForTimeout(1200)
  assert.deepEqual(await notes(lowTime), [880, 660, 880], 'low-time warning sounds only once')
  await lowTime.close()
  console.log(
    'PASS: a saved sound preference unlocks on interaction; your low-time warning sounds once at 20 seconds'
  )
  assert.deepEqual(errors, [])
} catch (error) {
  if (browser)
    for (const ctx of browser.contexts())
      for (const tab of ctx.pages())
        console.error(
          await tab.evaluate(() => ({
            text: document.body.innerText.slice(0, 900),
            moves: JSON.parse(localStorage.getItem('evaluchess.library.v1') || 'null')?.active
              ?.moves,
          }))
        )
  throw error
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
