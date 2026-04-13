import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit } from './_lib.js'
import { tracer, flush, recordError, log, metric } from './_otel.js'

interface MatchData { gameId: string; myColor: 'white' | 'black'; opponentId: string; token: string }

async function validateToken(playerId: string, gameId: string, token: string): Promise<boolean> {
  const match = await redis.get(`evaluchess:match:${playerId}`) as MatchData | null
  return !!match && match.gameId === gameId && match.token === token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('move')
  let statusCode = 200
  let body: unknown = null

  try {
    if (!await checkRateLimit(req, res)) { span.setAttribute('rate_limited', true); statusCode = 429; return }

    if (req.method === 'POST') {
      const { gameId, san, resign, playerId, token } = req.body as {
        gameId: string; san?: string; resign?: boolean; playerId: string; token: string
      }
      if (!gameId || !playerId || !token) { statusCode = 400; body = { error: 'missing fields' }; return }

      span.setAttributes({ 'game.id': gameId, 'player.id': playerId, 'move.resign': !!resign })

      if (!await validateToken(playerId, gameId, token)) {
        log('warn', 'unauthorized move attempt', { gameId, playerId, san: san ?? null, resign: !!resign })
        span.setAttribute('auth.failed', true)
        statusCode = 403; body = { error: 'unauthorized' }; return
      }

      if (resign) {
        await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
        metric('chess.resignations', 1, { gameId })
        log('info', 'player resigned', { gameId, playerId })
        span.setAttribute('move.type', 'resign')
        body = { ok: true }; return
      }

      if (!san) { statusCode = 400; body = { error: 'missing san' }; return }

      span.setAttribute('move.san', san)

      const fen = await redis.get(`evaluchess:fen:${gameId}`) as string | null
      if (!fen) {
        log('warn', 'game not found', { gameId, playerId, san })
        statusCode = 410; body = { error: 'game not found' }; return
      }

      const chess = new Chess(fen)
      let move
      try { move = chess.move(san) } catch { move = null }
      if (!move) {
        metric('chess.illegal_moves', 1, { gameId })
        log('warn', 'illegal move attempted', { gameId, playerId, san, fen })
        span.setAttribute('move.illegal', true)
        statusCode = 400; body = { error: 'illegal move' }; return
      }

      const newFen = chess.fen()
      const isCheckmate = chess.isCheckmate()
      const isDraw = chess.isDraw()
      const isCheck = chess.inCheck()

      await Promise.all([
        redis.set(`evaluchess:fen:${gameId}`, newFen, { ex: 3600 }),
        redis.rpush(`evaluchess:moves:${gameId}`, san),
        redis.expire(`evaluchess:moves:${gameId}`, 3600),
      ])

      log('info', 'move played', { gameId, playerId, san, fen: newFen, inCheck: isCheck, isCheckmate, isDraw })
      span.setAttributes({ 'move.type': 'move', 'game.check': isCheck, 'game.checkmate': isCheckmate, 'game.draw': isDraw })
      body = { ok: true }; return
    }

    if (req.method === 'GET') {
      const { gameId, since } = req.query as { gameId: string; since?: string }
      if (!gameId) { statusCode = 400; body = { error: 'missing gameId' }; return }

      span.setAttributes({ 'game.id': gameId, 'move.since': since ?? '0' })

      const sinceIdx = since ? parseInt(since) : 0
      const [moves, resigned] = await Promise.all([
        redis.lrange(`evaluchess:moves:${gameId}`, sinceIdx, -1) as Promise<string[]>,
        redis.get(`evaluchess:resigned:${gameId}`),
      ])

      log('info', 'move poll', { gameId, since: sinceIdx, moveCount: moves.length, resigned: !!resigned })
      span.setAttributes({ 'move.count': moves.length, 'game.resigned': !!resigned })
      body = { moves, resigned: !!resigned }; return
    }

    statusCode = 405
  } catch (err) {
    recordError(span, err)
    log('error', 'move handler error', { error: String(err) })
    statusCode = 500; body = { error: 'internal error' }
  } finally {
    span.end()
    flush()
  }

  if (statusCode === 405) return res.status(405).end()
  if (statusCode === 429) return
  return res.status(statusCode).json(body)
}
