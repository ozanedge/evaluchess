import { createHash, randomUUID } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as store from './_store.js'

export const SESSION_COOKIE = 'evaluchess_session'
export const SESSION_TTL = 60 * 60 * 24 * 30
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/

export interface Rating {
  elo: number
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
}

export interface Account {
  uid: string
  username: string
  usernameLower: string
  password: string
  createdAt: number
}

export interface Identity {
  uid: string
  username: string
  usernameLower: string
  createdAt: number
  rating: Rating
  bot?: boolean
}

export const startingRating = (): Rating => ({
  elo: 1200,
  wins: 0,
  losses: 0,
  draws: 0,
  gamesPlayed: 0,
})

export const accountKey = (uid: string) => `evaluchess:user:v1:${uid}`
export const usernameKey = (usernameLower: string) => `evaluchess:username:v1:${usernameLower}`
export const ratingKey = (uid: string) => `evaluchess:rating:v3:${uid}`
const sessionKey = (token: string) =>
  `evaluchess:session:v1:${createHash('sha256').update(token).digest('hex')}`

function cookieValue(req: VercelRequest): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='))
  }
  return null
}

export async function identity(req: VercelRequest): Promise<Identity | null> {
  const token = cookieValue(req)
  if (!token || !/^[a-f0-9-]{36}$/.test(token)) return null
  const uid = await store.get<string>(sessionKey(token))
  if (!uid) return null
  const [account, rating, botSeed] = await Promise.all([
    store.get<Account>(accountKey(uid)),
    store.get<Rating>(ratingKey(uid)),
    store.get(`evaluchess:bot-rating-seed:v1:${uid}`),
  ])
  if (!account) return null
  return {
    uid: account.uid,
    username: account.username,
    usernameLower: account.usernameLower,
    createdAt: account.createdAt,
    rating: rating || startingRating(),
    bot: !!botSeed,
  }
}

export async function createSession(uid: string): Promise<string> {
  const token = randomUUID()
  await store.set(sessionKey(token), uid, { ttl: SESSION_TTL })
  return token
}

export async function revokeSession(req: VercelRequest): Promise<void> {
  const token = cookieValue(req)
  if (token) await store.remove(sessionKey(token))
}

export function setSessionCookie(req: VercelRequest, res: VercelResponse, token?: string): void {
  const secure = req.headers['x-forwarded-proto'] !== 'http'
  const parts = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    token ? `Max-Age=${SESSION_TTL}` : 'Max-Age=0',
  ].filter(Boolean)
  res.setHeader('Set-Cookie', parts.join('; '))
}
