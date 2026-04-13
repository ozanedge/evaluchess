import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkStrictRateLimit } from './_lib.js'
import { tracer, flush, recordError, log } from './_otel.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('status')
  let statusCode = 200
  let body: unknown = null

  try {
    if (req.method !== 'GET') { statusCode = 405; return }
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); statusCode = 429; return }

    const { id } = req.query as { id: string }
    if (!id) { statusCode = 400; body = { error: 'missing id' }; return }

    span.setAttribute('player.id', id)
    const match = await redis.get(`evaluchess:match:${id}`) as { gameId: string; myColor: string; opponentId: string } | null
    log('info', 'status check', { playerId: id, matched: !!match, ...(match ? { gameId: match.gameId, color: match.myColor, opponentId: match.opponentId } : {}) })
    span.setAttributes({ 'matched': !!match, ...(match ? { 'game.id': match.gameId, 'player.color': match.myColor } : {}) })
    body = match ? { matched: true, ...(match as object) } : { matched: false }
  } catch (err) {
    recordError(span, err)
    log('error', 'status handler error', { error: String(err) })
    statusCode = 500; body = { error: 'internal error' }
  } finally {
    span.end()
    flush()
  }

  if (statusCode === 405) return res.status(405).end()
  if (statusCode === 429) return
  return res.status(statusCode).json(body)
}
