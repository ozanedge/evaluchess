import { createHash } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { read, putWrite, transact, backoff } from './_store.js'

async function applyRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  name: string,
  limit: number
): Promise<boolean> {
  const header = req.headers['x-forwarded-for']
  const ip = (Array.isArray(header) ? header[0] : header)?.split(',')[0].trim() || 'unknown'
  const key = `rate:${name}:${createHash('sha256').update(ip).digest('hex')}`
  try {
    // Bounded exact sliding window; TTL is cleanup, never the expiry check.
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = Date.now()
      const previous = await read<number[]>(key)
      const recent = (previous?.value || []).filter((at) => at > now - 10000).sort((a, b) => a - b)
      if (recent.length >= limit) {
        res.setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil((recent[0] + 10000 - now) / 1000)))
        )
        res.status(429).json({ error: 'Too many requests' })
        return false
      }
      if (await transact([putWrite(key, [...recent, now], previous, { ttl: 20 })])) return true
      await backoff(attempt)
    }
    throw new Error('Rate limit contention')
  } catch (error) {
    console.error('Rate limit unavailable', error instanceof Error ? error.name : 'UnknownError')
    res.setHeader('Retry-After', '5')
    res.status(503).json({ error: 'Service temporarily unavailable. Please retry.' })
    return false
  }
}
export const checkRateLimit = (req: VercelRequest, res: VercelResponse) =>
  applyRateLimit(req, res, 'move', 150)
export const checkStrictRateLimit = (
  req: VercelRequest,
  res: VercelResponse,
  scope: 'account' | 'leaderboard' | 'presence' = 'account'
) => applyRateLimit(req, res, scope, 10)
export const checkMatchmakingRateLimit = (req: VercelRequest, res: VercelResponse) =>
  applyRateLimit(req, res, 'matchmaking', 60)
