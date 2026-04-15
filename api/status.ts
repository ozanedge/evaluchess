import type { VercelRequest, VercelResponse } from '@vercel/node'
import { redis, checkStrictRateLimit } from './_lib.js'
import { tracer, flush, recordError, log } from './_otel.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const span = tracer.startSpan('status')

  try {
    if (req.method !== 'GET') { return res.status(405).end() }
    if (!await checkStrictRateLimit(req, res)) { span.setAttribute('rate_limited', true); return }

    const { id } = req.query as { id: string }
    if (!id) { return res.status(400).json({ error: 'missing id' }) }

    span.setAttribute('player.id', id)
    const match = await redis.get(`evaluchess:match:${id}`) as { gameId: string; myColor: string; opponentId: string } | null
    log('info', 'status check', { playerId: id, matched: !!match, ...(match ? { gameId: match.gameId, color: match.myColor, opponentId: match.opponentId } : {}) })
    span.setAttributes({ 'matched': !!match, ...(match ? { 'game.id': match.gameId, 'player.color': match.myColor } : {}) })
    return res.json(match ? { matched: true, ...(match as object) } : { matched: false })
  } catch (err) {
    recordError(span, err)
    log('error', 'status handler error', { error: String(err) })
    return res.status(500).json({ error: 'internal error' })
  } finally {
    span.end()
    flush()
  }
}
