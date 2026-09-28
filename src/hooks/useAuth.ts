import { useCallback, useEffect, useState } from 'react'

export interface AuthUser {
  uid: string
}

export interface UserProfile {
  username: string
  usernameLower: string
  elo: number
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
  createdAt: number
}

interface AccountResponse {
  user: AuthUser | null
  profile: UserProfile | null
  error?: string
}

export interface AuthApi {
  ready: boolean
  user: AuthUser | null
  profile: UserProfile | null
  loading: boolean
  error: string | null
  signUp: (username: string, password: string) => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

async function accountRequest(init?: RequestInit): Promise<AccountResponse> {
  const response = await fetch('/api/auth', {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    signal: AbortSignal.timeout(10000),
  })
  const data = (await response.json().catch(() => ({}))) as AccountResponse
  if (!response.ok) throw new Error(data.error || 'Accounts are temporarily unavailable.')
  return data
}

export function useAuth(): AuthApi {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const accept = useCallback((data: AccountResponse) => {
    setUser(data.user)
    setProfile(data.profile)
  }, [])

  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      try {
        const data = await accountRequest()
        if (!stopped) accept(data)
      } catch {
        // Keep the last known account during a temporary network failure.
      } finally {
        if (!stopped) setLoading(false)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('evaluchess-result', refresh)
    return () => {
      stopped = true
      window.removeEventListener('focus', refresh)
      window.removeEventListener('evaluchess-result', refresh)
    }
  }, [accept])

  const submit = useCallback(
    async (action: 'signup' | 'signin', username: string, password: string) => {
      setError(null)
      try {
        const data = await accountRequest({
          method: 'POST',
          body: JSON.stringify({ action, username, password }),
        })
        accept(data)
      } catch (err) {
        setError((err as Error).message)
        throw err
      }
    },
    [accept]
  )

  const signUp = useCallback(
    (username: string, password: string) => submit('signup', username, password),
    [submit]
  )
  const signIn = useCallback(
    (username: string, password: string) => submit('signin', username, password),
    [submit]
  )
  const signOut = useCallback(async () => {
    const data = await accountRequest({ method: 'POST', body: JSON.stringify({ action: 'signout' }) })
    accept(data)
  }, [accept])
  const clearError = useCallback(() => setError(null), [])

  return {
    ready: true,
    user,
    profile,
    loading,
    error,
    signUp,
    signIn,
    signOut,
    clearError,
  }
}
