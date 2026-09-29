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
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
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
    await square(p, from).tap({ timeout: 1000 })
    await square(p, to).tap({ timeout: 1000 })
  }
  const touch = await white.context().newCDPSession(white)
  async function gesture(from, to, jitter = false) {
    await square(white, from).scrollIntoViewIfNeeded()
    const a = await square(white, from).boundingBox(),
      b = await square(white, to).boundingBox()
    const x = a.x + a.width / 2,
      y = a.y + a.height / 2
    const tx = jitter ? x + 3 : b.x + b.width / 2,
      ty = jitter ? y + 2 : b.y + b.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await white.waitForTimeout(40)
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + ((tx - x) * step) / 8, y: y + ((ty - y) * step) / 8 }],
      })
      await white.waitForTimeout(15)
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await play(white, 'e2', 'e4')
  await moves(1)
  await play(black, 'e7', 'e5')
  await moves(2)
  let releaseMove
  const heldMove = new Promise((resolve) => {
    releaseMove = resolve
  })
  await white.route('**/api/move', async (route) => {
    const body = route.request().postDataJSON()
    if (body?.san === 'Nf3') {
      const response = await route.fetch()
      await heldMove
      await route.fulfill({ response })
    } else await route.continue()
  })
  await play(white, 'g1', 'f3')
  await moves(3)
  await white.locator('[data-move="g1f3"]').waitFor({ state: 'attached' })
  await gesture('f3', 'f3', true)
  await square(white, 'g5').tap()
  assert.match(
    await square(white, 'g5').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/,
    'a slightly moving touch still queues a tap premove'
  )
  await play(black, 'b8', 'c6')
  await moves(4)
  assert.match(
    await square(white, 'g5').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/,
    'premove waits for the earlier request instead of disappearing'
  )
  releaseMove()
  await moves(5)
  await white.unroute('**/api/move')
  await white.locator('[data-move="f3g5"]').waitFor({ state: 'attached' })
  await gesture('g5', 'f3')
  assert.match(
    await square(white, 'f3').locator(':scope > div').getAttribute('style'),
    /100, 150, 255/,
    'touch drag queues a premove through visible feedback'
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
    'PASS: mobile tap jitter and touch dragging queue premoves; a slow move confirmation does not drop the queue'
  )
  await white.evaluate(() => {
    const original = window.fetch
    let interrupted = false
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      if (!interrupted && init?.body && JSON.parse(init.body).resign) {
        interrupted = true
        throw new DOMException('Fetch is aborted', 'AbortError')
      }
      return response
    }
  })
  await white.getByRole('button', { name: 'Resign / New Game' }).tap()
  await white.getByRole('button', { name: 'Resign game', exact: true }).tap()
  await white.getByText('Black wins by resignation.', { exact: true }).waitFor()
  await white.getByText('Game Analysis', { exact: true }).waitFor()
  assert.equal(await white.getByText(/Fetch is aborted/).count(), 0)
  assert.equal(
    await white.getByRole('alert').count(),
    0,
    'an accepted resignation with a lost response recovers without an error'
  )
  console.log('PASS: an aborted resignation response is reconciled with the server result')
  for (const persistent of [false, true]) {
    const c = await page(mockEngine, evaluations),
      d = await page(mockEngine, evaluations)
    for (const p of [c, d]) await p.getByRole('button', { name: 'Start Game', exact: true }).tap()
    for (const p of [c, d]) await p.getByRole('button', { name: 'Resign / New Game' }).waitFor()
    await c.evaluate((persistent) => {
      const original = window.fetch
      window.resignRequests = 0
      window.failResign = true
      window.fetch = async (input, init) => {
        if (init?.body && JSON.parse(init.body).resign) {
          window.resignRequests++
          if (window.failResign) {
            if (!persistent) window.failResign = false
            throw new DOMException('Fetch is aborted', 'AbortError')
          }
        }
        return original(input, init)
      }
    }, persistent)
    await c.getByRole('button', { name: 'Resign / New Game' }).tap()
    await c.getByRole('button', { name: 'Resign game', exact: true }).tap()
    if (persistent) {
      const retry = c.getByRole('button', { name: 'Retry resignation' })
      await retry.waitFor()
      assert.equal(
        await c.evaluate(() => window.resignRequests),
        2,
        'automatic retries are bounded'
      )
      assert.equal(await c.getByText(/Fetch is aborted/).count(), 0)
      await c.waitForTimeout(1000)
      await retry.waitFor()
      assert.equal(
        await c.evaluate(
          () => JSON.parse(localStorage.getItem('evaluchess.library.v1')).active.result
        ),
        '',
        'failed resignation never pretends the game ended'
      )
      await c.evaluate(() => {
        window.failResign = false
      })
      await retry.tap()
    }
    await c.getByText(/wins by resignation/).waitFor()
    await c.getByText('Game Analysis', { exact: true }).waitFor()
    assert.equal(await c.getByRole('alert').count(), 0)
    assert.equal(await c.evaluate(() => window.resignRequests), persistent ? 3 : 2)
    await c.context().close()
    await d.context().close()
  }
  console.log(
    'PASS: interrupted resignations retry once; continued failure shows a working Retry resignation action without claiming a result'
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
