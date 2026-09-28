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
  const { reconstruct } = await import('../.test-build/src/lib/library.js')
  const { buildAnalysis } = await import('../.test-build/src/utils/analysis.js')
  const moves = [
    'e4',
    'e5',
    'Nf3',
    'Nc6',
    'Bb5',
    'a6',
    'Ba4',
    'Nf6',
    'O-O',
    'Be7',
    'Re1',
    'b5',
    'Bb3',
    'd6',
    'c3',
    'O-O',
    'h3',
    'Nb8',
    'd4',
    'Nbd7',
  ]
  const restored = reconstruct(moves)
  const analysis = buildAnalysis(
    moves,
    restored.fens.map((fen) => {
      const move = new Chess(fen).moves({ verbose: true })[0]
      return {
        score: 0,
        mate: null,
        bestMove: move.from + move.to + (move.promotion || ''),
        pv: [],
      }
    })
  )
  analysis.white.accuracy = 91
  analysis.black.accuracy = 63
  const fixture = {
    id: 'review-board',
    updatedAt: Date.now(),
    mode: 'computer',
    playerColor: 'black',
    moves,
    tc: 1,
    difficulty: 1,
    whiteMs: 100000,
    blackMs: 100000,
    result: 'White resigned.',
    analysis,
  }
  for (const color of ['white', 'black']) {
    const p = await page(
      (fixture) => {
        localStorage.setItem(
          'evaluchess.library.v1',
          JSON.stringify({ version: 1, games: [fixture], active: fixture })
        )
      },
      { ...fixture, playerColor: color }
    )
    await p.getByRole('button', { name: 'Resume your saved computer game' }).click()
    await p.getByText('Game Analysis', { exact: true }).waitFor()
    const rows = p
      .getByText('Move Review', { exact: true })
      .locator('..')
      .locator(':scope > div > div')
    const chart = p
      .getByText('Accuracy by Move', { exact: true })
      .locator('..')
      .locator('div.relative.cursor-pointer')
    async function expectPerspective(view) {
      const targetColor = view === 'Your moves' ? color : color === 'white' ? 'black' : 'white'
      const indices = moves
        .map((_, index) => index)
        .filter((index) => index % 2 === (targetColor === 'white' ? 0 : 1))
      assert.equal(
        await p.getByRole('button', { name: view, exact: true }).getAttribute('aria-pressed'),
        'true'
      )
      assert.deepEqual(
        await rows.evaluateAll((rows) => rows.map((row) => Number(row.dataset.moveIndex))),
        indices
      )
      assert.deepEqual(
        await chart
          .locator('[data-move-index]')
          .evaluateAll((dots) => dots.map((dot) => Number(dot.dataset.moveIndex))),
        indices
      )
      const title = `${view === 'Your moves' ? 'You' : 'Opponent'} · ${targetColor === 'white' ? 'White' : 'Black'}`
      await p.getByText(title, { exact: true }).waitFor()
      assert.equal(
        await p.getByText(targetColor === 'white' ? '91%' : '63%', { exact: true }).count(),
        1
      )
      assert.equal(
        await p.getByText(targetColor === 'white' ? '63%' : '91%', { exact: true }).count(),
        0
      )
      assert.equal(
        await chart
          .locator('..')
          .locator('div.relative.mt-1\\.5')
          .getByText('1', { exact: true })
          .count(),
        1,
        'both colors retain move number labels'
      )
    }
    async function selectSide(ply) {
      const view = (ply % 2 === 0 ? 'white' : 'black') === color ? 'Your moves' : 'Opponent moves'
      await p.getByRole('button', { name: view, exact: true }).click()
      await expectPerspective(view)
    }
    await expectPerspective('Your moves')
    async function expectPosition(ply) {
      assert.equal(
        await p.locator('#chessboard-board').count(),
        1,
        'review must render exactly one board'
      )
      const expected = Object.fromEntries(
        new Chess(restored.fens[ply])
          .board()
          .flat()
          .filter(Boolean)
          .map((piece) => [piece.square, piece.color + piece.type.toUpperCase()])
      )
      await p.waitForFunction(
        (expected) => {
          const actual = {}
          for (const square of document.querySelectorAll('#chessboard-board [data-square]')) {
            const piece = square.querySelector('[data-piece]')
            if (piece) actual[square.getAttribute('data-square')] = piece.getAttribute('data-piece')
          }
          return (
            JSON.stringify(Object.entries(actual).sort()) ===
            JSON.stringify(Object.entries(expected).sort())
          )
        },
        expected,
        { timeout: 2500 }
      )
      const move = new Chess(restored.fens[ply]).move(moves[ply])
      const expectedArrows = ply >= 2 ? [move.from + move.to + (move.promotion || '')] : []
      assert.deepEqual(
        await p
          .locator('[data-testid="move-feedback-arrows"] [data-move]')
          .evaluateAll((arrows) => arrows.map((arrow) => arrow.getAttribute('data-move'))),
        expectedArrows,
        'arrows describe the selected move on the displayed board'
      )
    }
    for (const ply of [0, 18, 7, 15, 3, 19, 8, 11, 2]) {
      await selectSide(ply)
      await rows.nth(Math.floor(ply / 2)).click()
      await expectPosition(ply)
    }
    for (const ply of [4, 17, 10]) {
      await selectSide(ply)
      const rect = await chart.boundingBox()
      await chart.click({
        position: {
          x: (rect.width * Math.floor(ply / 2)) / (moves.length / 2 - 1),
          y: rect.height / 2,
        },
      })
      await expectPosition(ply)
    }
    await p.getByRole('button', { name: 'Opponent moves', exact: true }).click()
    await p.getByRole('link', { name: 'Evaluchess home' }).click()
    await p.getByRole('button', { name: 'Resume your saved computer game' }).click()
    await expectPerspective('Your moves')
    await p.close()
  }
  console.log(
    'PASS: move rows and chart selections update every piece and arrow in both orientations, with exactly one board'
  )
  const shortFixture = {
    ...fixture,
    id: 'one-move',
    playerColor: 'white',
    moves: ['e4'],
    analysis: buildAnalysis(['e4'], [analysis.moves[0].evalBefore, analysis.moves[0].evalAfter]),
  }
  const shortPage = await page(
    (fixture) =>
      localStorage.setItem(
        'evaluchess.library.v1',
        JSON.stringify({ version: 1, games: [fixture], active: fixture })
      ),
    shortFixture
  )
  await shortPage.getByRole('button', { name: 'Resume your saved computer game' }).click()
  await shortPage.getByRole('button', { name: 'Opponent moves', exact: true }).click()
  await shortPage.getByText('No moves to analyze yet.', { exact: true }).waitFor()
  assert.equal(await shortPage.getByText('Accuracy by Move', { exact: true }).count(), 0)
  await shortPage.getByRole('button', { name: 'Your moves', exact: true }).click()
  assert.equal(await shortPage.getByText('e4', { exact: true }).count(), 1)
  assert.equal(await shortPage.getByText('Accuracy by Move', { exact: true }).count(), 1)
  await shortPage.close()
  console.log(
    'PASS: analysis defaults to your moves, switches stats/chart/list together, preserves original move indices, resets on reopen, and handles an opponent with no moves'
  )
  assert.deepEqual(errors, [])
} catch (error) {
  if (browser)
    for (const ctx of browser.contexts())
      for (const tab of ctx.pages())
        console.error(
          await tab.evaluate(() => ({
            text: document.body.innerText.slice(-1500),
            board: [...document.querySelectorAll('#chessboard-board [data-square]')]
              .map((square) => [
                square.getAttribute('data-square'),
                square.querySelector('[data-piece]')?.getAttribute('data-piece'),
              ])
              .filter((pair) => pair[1]),
          }))
        )
  throw error
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
