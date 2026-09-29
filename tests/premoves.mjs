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
  for (const [san, bestMove] of [
    [null, 'e2e4'],
    ['e4', 'e7e5'],
    ['e5', 'g1f3'],
    ['Nf3', 'b8c6'],
    ['Nc6', 'f3g5'],
    ['Ng5', 'd7d6'],
    ['d6', 'g5f3'],
    ['Nf3', 'g8f6'],
    ['Nf6', 'd2d3'],
  ]) {
    if (san) positions.move(san)
    evaluations[positions.fen()] = bestMove
  }
  function mockEngine(evaluations) {
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
  await play(white, 'e2', 'e4')
  await moves(1)
  await play(black, 'e7', 'e5')
  await moves(2)
  await play(white, 'g1', 'f3')
  await moves(3)
  await white.locator('[data-move="g1f3"]').waitFor({ state: 'attached' })
  assert.deepEqual(
    await white.evaluate(() => {
      const el = document.querySelector('[data-square="f3"]'),
        r = el.getBoundingClientRect()
      return {
        target: document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest('[data-square]')
          ?.getAttribute('data-square'),
        pointerEvents: getComputedStyle(
          document.querySelector('[data-testid="move-feedback-arrows"]')
        ).pointerEvents,
      }
    }),
    { target: 'f3', pointerEvents: 'none' },
    'pointer input reaches the board under the arrow tip'
  )
  await play(white, 'f3', 'g5')
  assert.match(
    await square(white, 'g5').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/,
    'click premove is highlighted while arrows remain visible'
  )
  assert.equal(await white.locator('[data-move="g1f3"]').count(), 1)
  await square(white, 'a4').click({ button: 'right' })
  for (const s of ['f3', 'g5'])
    assert.doesNotMatch(
      await square(white, s).locator(':scope > div').getAttribute('style'),
      /100, 150, 255/,
      'right-click anywhere on the board clears premove highlights'
    )
  await play(black, 'b8', 'c6')
  await moves(4)
  await white.waitForTimeout(1000)
  assert.equal(
    await white.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.moves.length
    ),
    4,
    'a cancelled premove does not execute when the opponent replies'
  )
  await play(white, 'f3', 'g5')
  await moves(5)
  await white.locator('[data-move="f3g5"]').waitFor({ state: 'attached' })
  const start = await square(white, 'g5').boundingBox(),
    end = await square(white, 'f3').boundingBox()
  await white.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await white.mouse.down()
  await white.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 })
  await white.mouse.up()
  assert.match(
    await square(white, 'f3').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/,
    'drag premove is highlighted while arrows remain visible'
  )
  await play(black, 'd7', 'd6')
  await moves(7)
  assert.deepEqual(
    await white.evaluate(
      () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.moves
    ),
    ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5', 'd6', 'Nf3']
  )
  console.log(
    'PASS: right-click cancels the queued premove and its highlights; cancelled moves do not execute; subsequent drag premoves still work through arrows'
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
