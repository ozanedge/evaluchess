import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const moveRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(150, '10 s'),
  prefix: 'evaluchess:rl:move',
})

const strictRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
  prefix: 'evaluchess:rl:strict',
})

async function applyRateLimit(req: VercelRequest, res: VercelResponse, limiter: Ratelimit): Promise<boolean> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 'unknown'
  const { success } = await limiter.limit(ip)
  if (!success) {
    res.status(429).json({ error: 'Too many requests' })
    return false
  }
  return true
}

export function checkRateLimit(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  return applyRateLimit(req, res, moveRatelimit)
}

export function checkStrictRateLimit(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  return applyRateLimit(req, res, strictRatelimit)
}

export function generateToken(): string {
  return crypto.randomUUID()
}
