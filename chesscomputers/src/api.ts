import crypto from 'node:crypto'
import { API_BASE } from './config.js'

export interface AccountProfile {
  uid: string
  username: string
  elo: number
  wins: number
  losses: number
  draws: number
}

export interface Match {
  gameId: string
  myColor: 'white' | 'black'
  opponentId: string
  token: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
}

export interface ServerGame {
  moves: string[]
  result: { winner: 'white' | 'black' | null; reason: string } | null
  clocks: { whiteMs: number; blackMs: number }
}

interface AuthResponse {
  user: { uid: string }
  profile: Omit<AccountProfile, 'uid'>
}

interface JoinResponse {
  matched: boolean
  match?: Match
}

interface GameResponse {
  game: ServerGame
}

export class ApiClient {
  readonly playerId = `cc-${crypto.randomUUID()}`
  readonly playerSecret = crypto.randomUUID()
  private cookie = ''

  private async request<T>(
    path: string,
    init: RequestInit = {},
    attempt = 0
  ): Promise<{ data: T; response: Response }> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
    })
    const data = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (response.status === 429 && attempt < 3) {
      const wait = Math.max(1, Math.min(30, Number(response.headers.get('Retry-After')) || 10))
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      return this.request<T>(path, init, attempt + 1)
    }
    if (!response.ok) throw new Error(data.error || `${path} failed: ${response.status}`)
    return { data, response }
  }

  async signIn(username: string, password: string): Promise<AccountProfile> {
    const { data, response } = await this.request<AuthResponse>('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'signin', username, password }),
    })
    this.cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
    if (!this.cookie) throw new Error('Sign-in did not return a session')
    return { uid: data.user.uid, ...data.profile }
  }

  async join(tc: string, leave = false, standby = false): Promise<Match | null> {
    const { data } = await this.request<JoinResponse>('/api/join', {
      method: 'POST',
      headers: { 'x-player-secret': this.playerSecret },
      body: JSON.stringify({ id: this.playerId, tc, leave, standby }),
    })
    return data.matched ? (data.match ?? null) : null
  }

  async game(match: Match): Promise<ServerGame> {
    const { data } = await this.request<GameResponse>(
      `/api/move?gameId=${encodeURIComponent(match.gameId)}&playerId=${encodeURIComponent(this.playerId)}`,
      { headers: { Authorization: `Bearer ${match.token}` } }
    )
    return data.game
  }

  async move(match: Match, san: string, expectedPly: number): Promise<ServerGame> {
    const { data } = await this.request<GameResponse>('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${match.token}` },
      body: JSON.stringify({
        gameId: match.gameId,
        playerId: this.playerId,
        san,
        expectedPly,
        requestId: crypto.randomUUID(),
      }),
    })
    return data.game
  }

  async resign(match: Match): Promise<void> {
    await this.request<GameResponse>('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${match.token}` },
      body: JSON.stringify({ gameId: match.gameId, playerId: this.playerId, resign: true }),
    })
  }
}

export async function createAccount(
  username: string,
  password: string,
  attempt = 0
): Promise<'created' | 'exists'> {
  const response = await fetch(`${API_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signup', username, password }),
    signal: AbortSignal.timeout(10000),
  })
  if (response.status === 429 && attempt < 3) {
    const wait = Math.max(1, Math.min(30, Number(response.headers.get('Retry-After')) || 10))
    await new Promise((resolve) => setTimeout(resolve, wait * 1000))
    return createAccount(username, password, attempt + 1)
  }
  if (response.status === 409) {
    await new ApiClient().signIn(username, password)
    return 'exists'
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `signup failed: ${response.status}`)
  }
  return 'created'
}

export async function reportOnline(playerId: string, attempt = 0): Promise<void> {
  const params = new URLSearchParams({ id: playerId })
  const response = await fetch(`${API_BASE}/api/online?${params.toString()}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (response.status === 429 && attempt < 3) {
    const wait = Math.max(1, Math.min(30, Number(response.headers.get('Retry-After')) || 10))
    await new Promise((resolve) => setTimeout(resolve, wait * 1000))
    return reportOnline(playerId, attempt + 1)
  }
  if (!response.ok) throw new Error(`reportOnline failed: ${response.status}`)
}
