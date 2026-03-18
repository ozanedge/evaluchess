import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit } from './_lib.js'

interface MatchData { gameId: string; myColor: 'white' | 'black'; opponentId: string; token: string }

async function validateToken(playerId: string, gameId: string, token: string): Promise<boolean> {
  const match = await redis.get(`evaluchess:match:${playerId}`) as MatchData | null
  return !!match && match.gameId === gameId && match.token === token
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!await checkRateLimit(req, res)) return

  if (req.method === 'POST') {
    const { gameId, san, resign, playerId, token } = req.body as {
      gameId: string; san?: string; resign?: boolean; playerId: string; token: string
    }
    if (!gameId || !playerId || !token) return res.status(400).json({ error: 'missing fields' })

    // Validate the caller is an authorised participant
    if (!await validateToken(playerId, gameId, token)) {
      return res.status(403).json({ error: 'unauthorized' })
    }

    if (resign) {
      await redis.set(`evaluchess:resigned:${gameId}`, '1', { ex: 3600 })
      return res.json({ ok: true })
    }

    if (!san) return res.status(400).json({ error: 'missing san' })

    // Validate move legality against stored game state
    const fen = await redis.get(`evaluchess:fen:${gameId}`) as string | null
    if (!fen) return res.status(410).json({ error: 'game not found' })

    const chess = new Chess(fen)
    let move
    try {
      move = chess.move(san)
    } catch {
      move = null
    }
    if (!move) return res.status(400).json({ error: 'illegal move' })

    // Persist updated FEN and append move
    await Promise.all([
      redis.set(`evaluchess:fen:${gameId}`, chess.fen(), { ex: 3600 }),
      redis.rpush(`evaluchess:moves:${gameId}`, san),
      redis.expire(`evaluchess:moves:${gameId}`, 3600),
    ])

    return res.json({ ok: true })
  }

  if (req.method === 'GET') {
    if (!await checkRateLimit(req, res)) return
    const { gameId, since } = req.query as { gameId: string; since?: string }
    if (!gameId) return res.status(400).json({ error: 'missing gameId' })
    const sinceIdx = since ? parseInt(since) : 0
    const [moves, resigned] = await Promise.all([
      redis.lrange(`evaluchess:moves:${gameId}`, sinceIdx, -1) as Promise<string[]>,
      redis.get(`evaluchess:resigned:${gameId}`),
    ])
    return res.json({ moves, resigned: !!resigned })
  }

  return res.status(405).end()
}
