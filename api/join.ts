import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Chess } from 'chess.js'
import { redis, checkRateLimit, generateToken } from './_lib.js'

const QUEUE_KEY = 'evaluchess:queue'
const STALE_MS = 60_000

interface QueueEntry { ts: number; tc: string }
interface MatchData { gameId: string; myColor: 'white' | 'black'; opponentId: string; token: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!await checkRateLimit(req, res)) return

  const { id, tc, leave } = req.body as { id: string; tc: string; leave?: boolean }
  if (!id) return res.status(400).json({ error: 'missing id' })

  // Handle leave: clear match + queue entry
  if (leave) {
    await Promise.all([
      redis.del(`evaluchess:match:${id}`),
      redis.hdel(QUEUE_KEY, id),
    ])
    return res.json({ ok: true })
  }

  if (!tc) return res.status(400).json({ error: 'missing tc' })

  const now = Date.now()

  // Check if already matched
  const existingMatch = await redis.get(`evaluchess:match:${id}`) as MatchData | null
  if (existingMatch) {
    return res.json({ matched: true, ...existingMatch })
  }

  // Get queue
  const queue = (await redis.hgetall(QUEUE_KEY) as Record<string, QueueEntry> | null) ?? {}

  // Clean stale entries
  const stale = Object.entries(queue)
    .filter(([qId, entry]) => qId !== id && now - entry.ts > STALE_MS)
    .map(([qId]) => qId)
  if (stale.length) await redis.hdel(QUEUE_KEY, ...stale)
  stale.forEach(qId => delete queue[qId])

  // Find an opponent (same tc, different id)
  const opponents = Object.entries(queue)
    .filter(([qId, entry]) => qId !== id && entry.tc === tc)
    .sort(([, a], [, b]) => a.ts - b.ts)

  if (opponents.length > 0) {
    const [opponentId] = opponents[0]

    const myColor: 'white' | 'black' = id < opponentId ? 'white' : 'black'
    const oppColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white'
    const gameId = `g_${now}_${Math.random().toString(36).substr(2, 5)}`
    const myToken = generateToken()
    const oppToken = generateToken()

    const myMatch: MatchData = { gameId, myColor, opponentId, token: myToken }
    const oppMatch: MatchData = { gameId, myColor: oppColor, opponentId: id, token: oppToken }

    await Promise.all([
      redis.set(`evaluchess:match:${id}`, myMatch, { ex: 3600 }),
      redis.set(`evaluchess:match:${opponentId}`, oppMatch, { ex: 3600 }),
      redis.hdel(QUEUE_KEY, id, opponentId),
      // Store initial game FEN for server-side move validation
      redis.set(`evaluchess:fen:${gameId}`, new Chess().fen(), { ex: 3600 }),
    ])

    return res.json({ matched: true, ...myMatch })
  }

  // No opponent — join queue
  await redis.hset(QUEUE_KEY, { [id]: { ts: now, tc } })
  return res.json({ matched: false })
}
