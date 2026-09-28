import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Chess } from 'chess.js'
import { RatedEngine, strengthSettings } from '../chesscomputers/src/engine.ts'
import { CHESSCOMPUTER_PROFILES } from '../chesscomputers/src/config.ts'

const engine = new RatedEngine()
const dir = await mkdtemp(join(tmpdir(), 'evaluchess-bot-engine-'))
const fixtures = []
try {
  const sorted = [...CHESSCOMPUTER_PROFILES].sort((a, b) => a.initialRating - b.initialRating)
  assert.equal(sorted[0].initialRating, 400)
  assert.equal(sorted.at(-1).initialRating, 1600)
  for (let i = 1; i < sorted.length; i++) {
    const low = strengthSettings(sorted[i - 1].initialRating)
    const high = strengthSettings(sorted[i].initialRating)
    assert.ok(high.randomMoveChance < low.randomMoveChance || high.engineElo > low.engineElo)
  }
  assert.throws(() => strengthSettings(NaN))
  assert.throws(() => strengthSettings(2000))
  const start = new Chess()
  assert.equal(await engine.pickMove(start.fen(), 400, () => 0), start.moves()[0])
  const afterE4 = new Chess()
  afterE4.move('e4')
  const promotion = new Chess('8/P7/8/8/8/8/2k4r/K7 w - - 0 1')
  const positions = [start, afterE4, promotion]
  const moves = await Promise.all(
    positions.map((chess, i) => engine.pickMove(chess.fen(), [1600, 1350, 800][i], () => 0.99))
  )
  positions.forEach((chess, i) => assert.ok(new Chess(chess.fen()).move(moves[i])))
  assert.match(moves[2], /=[QRBN]/)
  assert.equal(await engine.pickMove('7k/8/6K1/8/8/8/8/8 w - - 0 1', 1600), null)

  const path = join(dir, 'engine.mjs')
  const log = join(dir, 'commands.jsonl')
  const fake = (move = 'e2e4') => `
    import { createInterface } from 'node:readline';
    import { appendFileSync } from 'node:fs';
    createInterface({input:process.stdin}).on('line', line => {
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(line)+'\\n');
      if(line==='uci') console.log('uciok');
      if(line==='isready') console.log('readyok');
      if(line.startsWith('go ')) ${move === 'exit' ? 'process.exit(2)' : `console.log('bestmove ${move}')`};
    });`
  await writeFile(path, fake())
  const mock = new RatedEngine({ enginePath: path })
  fixtures.push(mock)
  await Promise.all(
    [400, 1350, 1600].map((rating) => mock.pickMove(start.fen(), rating, () => 0.99))
  )
  const commands = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(
    commands.filter((c) => c.startsWith('setoption name UCI_Elo')),
    [1320, 1350, 1600].map((elo) => `setoption name UCI_Elo value ${elo}`)
  )
  assert.equal(
    commands.filter((c) => c === 'setoption name UCI_LimitStrength value true').length,
    3
  )
  await mock.close()
  await assert.rejects(mock.pickMove(start.fen(), 1600), /closed/)

  await writeFile(path, fake('exit'))
  const recovering = new RatedEngine({ enginePath: path })
  fixtures.push(recovering)
  await assert.rejects(recovering.pickMove(start.fen(), 1600), /exited/)
  await writeFile(path, fake())
  assert.equal(
    await recovering.pickMove(start.fen(), 1600),
    'e4',
    'a failed child must not poison future searches'
  )
  await recovering.close()
  await writeFile(path, fake('e2e5'))
  const illegal = new RatedEngine({ enginePath: path })
  fixtures.push(illegal)
  await assert.rejects(illegal.pickMove(start.fen(), 1600), /illegal move/)
  await writeFile(path, 'setInterval(() => {}, 1000)')
  const hung = new RatedEngine({ enginePath: path, timeoutMs: 200 })
  fixtures.push(hung)
  await assert.rejects(hung.pickMove(start.fen(), 1600), /timed out/)
  console.log(
    'PASS: ten distinct strengths, real Stockfish moves/promotion, serialized settings, terminal positions, crash recovery, illegal moves and timeout cleanup'
  )
} finally {
  await engine.close()
  await Promise.all(fixtures.map((engine) => engine.close()))
  await rm(dir, { recursive: true, force: true })
}
