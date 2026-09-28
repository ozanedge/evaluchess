import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkStrictRateLimit } from './_lib.js'
import * as store from './_store.js'
import {
  accountKey,
  createSession,
  identity,
  ratingKey,
  revokeSession,
  SESSION_COOKIE,
  setSessionCookie,
  startingRating,
  usernameKey,
  USERNAME_RE,
} from './_identity.js'
import type { Account, Identity } from './_identity.js'

const scrypt = promisify(scryptCallback)

function publicAccount(user: Identity) {
  return {
    user: { uid: user.uid },
    profile: {
      username: user.username,
      usernameLower: user.usernameLower,
      createdAt: user.createdAt,
      ...user.rating,
    },
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(':')
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/.test(expectedHex)) return false
  const actual = (await scrypt(password, salt, 64)) as Buffer
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') {
    try {
      const user = await identity(req)
      return res.json(user ? publicAccount(user) : { user: null, profile: null })
    } catch {
      return res.status(503).json({ error: 'Accounts are temporarily unavailable.' })
    }
  }
  if (req.method !== 'POST') return res.status(405).end()
  if (!(await checkStrictRateLimit(req, res))) return
  const { action, username, password } = req.body || {}
  try {
    if (action === 'signout') {
      await revokeSession(req)
      setSessionCookie(req, res)
      return res.json({ user: null, profile: null })
    }
    const trimmed = typeof username === 'string' ? username.trim() : ''
    const lower = trimmed.toLowerCase()
    if (!USERNAME_RE.test(trimmed))
      return res.status(400).json({
        error: 'Usernames must be 3–24 characters. Start and end with a letter or number.',
      })
    if (typeof password !== 'string' || password.length < 6 || password.length > 200)
      return res.status(400).json({ error: 'Password must be 6–200 characters.' })

    let uid: string
    if (action === 'signup') {
      uid = randomUUID()
      const account: Account = {
        uid,
        username: trimmed,
        usernameLower: lower,
        password: await hashPassword(password),
        createdAt: Date.now(),
      }
      const rating = startingRating()
      const created = await store.transact([
        store.putWrite(usernameKey(lower), uid, null),
        store.putWrite(accountKey(uid), account, null),
        store.putWrite(ratingKey(uid), rating, null, {
          leaderboard: { uid, username: trimmed, elo: rating.elo, wins: rating.wins },
        }),
      ])
      if (!created) return res.status(409).json({ error: 'That username is already taken.' })
    } else if (action === 'signin') {
      const found = await store.get<string>(usernameKey(lower))
      const account = found ? await store.get<Account>(accountKey(found)) : null
      if (!account || !(await passwordMatches(password, account.password)))
        return res.status(401).json({ error: 'Invalid username or password.' })
      uid = account.uid
    } else {
      return res.status(400).json({ error: 'Invalid account action.' })
    }

    const token = await createSession(uid)
    setSessionCookie(req, res, token)
    const requestWithCookie = {
      ...req,
      headers: { ...req.headers, cookie: `${SESSION_COOKIE}=${token}` },
    } as VercelRequest
    const user = await identity(requestWithCookie)
    if (!user) throw new Error('Account session was not created')
    return res.json(publicAccount(user))
  } catch {
    return res.status(503).json({ error: 'Accounts are temporarily unavailable.' })
  }
}
