import { API_BASE } from './config.js'

export interface JoinResponse {
  matched: boolean
  gameId?: string
  myColor?: 'white' | 'black'
  opponentId?: string
  token?: string
  opponentUsername?: string
  opponentElo?: number
  opponentUid?: string
}

export interface ServerMove {
  san: string
  ms: number | null
}

export interface MoveGetResponse {
  moves: ServerMove[]
  resigned: boolean
}

interface JoinArgs {
  id: string
  tc: string
  uid?: string
  username?: string
  elo?: number
  leave?: boolean
}

export async function joinPool(args: JoinArgs): Promise<JoinResponse> {
  const res = await fetch(`${API_BASE}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`join failed: ${res.status}`)
  return (await res.json()) as JoinResponse
}

export async function pollMoves(
  gameId: string,
  since: number,
  playerId: string,
): Promise<MoveGetResponse> {
  const url = `${API_BASE}/api/move?gameId=${encodeURIComponent(gameId)}&since=${since}&playerId=${encodeURIComponent(playerId)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`poll failed: ${res.status}`)
  return (await res.json()) as MoveGetResponse
}

export async function sendMove(
  gameId: string,
  san: string,
  playerId: string,
  token: string,
  remainingMs: number,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, san, playerId, token, remainingMs }),
  })
  if (!res.ok) throw new Error(`sendMove failed: ${res.status}`)
}

export async function resignGame(
  gameId: string,
  playerId: string,
  token: string,
): Promise<void> {
  await fetch(`${API_BASE}/api/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, resign: true, playerId, token }),
  })
}

export async function reportOnline(playerId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/online?id=${encodeURIComponent(playerId)}`)
  if (!res.ok) throw new Error(`reportOnline failed: ${res.status}`)
}
