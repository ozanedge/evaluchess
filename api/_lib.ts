import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '10 s'),
  prefix: 'evaluchess:rl',
})

export async function checkRateLimit(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 'unknown'
  const { success } = await ratelimit.limit(ip)
  if (!success) {
    res.status(429).json({ error: 'Too many requests' })
    return false
  }
  return true
}

export function generateToken(): string {
  return crypto.randomUUID()
}
