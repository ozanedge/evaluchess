import './build.mjs'
import assert from 'node:assert/strict'
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
  const p = await page()
  await p.route('**/api/leaderboard', (route) =>
    route.fulfill({
      json: {
        rows: [
          {
            uid: 'one',
            username: 'pawn.eater',
            wins: 11,
            elo: 1051,
            ratingChange: 80,
            losses: 9,
            draws: 0,
          },
          {
            uid: 'two',
            username: 'KasparovClone',
            wins: 10,
            elo: 1110,
            ratingChange: -48,
            losses: 10,
            draws: 0,
          },
          {
            uid: 'three',
            username: 'fianchetto',
            wins: 9,
            elo: 1156,
            ratingChange: -3,
            losses: 6,
            draws: 0,
          },
        ],
        computedAt: Date.now(),
        cached: false,
      },
    })
  )
  await p.getByRole('button', { name: 'Leaderboard', exact: true }).click()
  const table = p.getByRole('table', { name: 'Leaderboard for the last 24 hours' })
  await table.waitFor()
  assert.deepEqual(await table.getByRole('columnheader').allTextContents(), [
    '#',
    'Player',
    'Wins',
    'Losses',
    'Draws',
    'Elo',
    'Δ Elo',
  ])
  assert.deepEqual(await table.getByRole('row').nth(1).getByRole('cell').allTextContents(), [
    '1',
    'pawn.eater',
    '11',
    '9',
    '0',
    '1051',
    '+80',
  ])
  for (const width of [1440, 1024, 390]) {
    await p.setViewportSize({ width, height: 1040 })
    await p.waitForTimeout(100)
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const geometry = await table.evaluate((table) =>
      [...table.rows].map((row) =>
        [...row.cells].map((cell) => {
          const box = cell.getBoundingClientRect()
          return { x: box.x, width: box.width }
        })
      )
    )
    for (const row of geometry.slice(1))
      for (let i = 0; i < row.length; i++) {
        assert.ok(Math.abs(row[i].x - geometry[0][i].x) < 1, 'headers and values align')
        assert.ok(Math.abs(row[i].width - geometry[0][i].width) < 1)
        if (i) assert.ok(row[i].x >= row[i - 1].x + row[i - 1].width - 1, 'columns never overlap')
      }
    if (width === 1440)
      await p.screenshot({ path: '/tmp/evaluchess-leaderboard-columns.png', fullPage: true })
  }
  const scroller = p.getByRole('region', { name: 'Scrollable leaderboard' })
  await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  const last = await table.getByRole('columnheader', { name: 'Δ Elo', exact: true }).boundingBox()
  assert.ok(last.x >= 0 && last.x + last.width <= 390, 'rightmost column can be reached on mobile')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: seven separate columns align across header and rows; losses/draws have separate values; mobile scroll reaches every column without page overflow'
  )
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
  await server.close()
}
