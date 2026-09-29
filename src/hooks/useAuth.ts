import { useCallback, useEffect, useState, useRef } from 'react'
import { setLibraryOwner } from '../lib/library'

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
  const generation = useRef(0)
  const changing = useRef(false)

  const accept = useCallback((data: AccountResponse) => {
    setLibraryOwner(data.user?.uid || null)
    setUser(data.user)
    setProfile(data.profile)
  }, [])

  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      if (changing.current) return
      const run = ++generation.current
      try {
        const data = await accountRequest()
        if (!stopped && run === generation.current) accept(data)
      } catch {
        // Keep the last known account during a temporary network failure.
      } finally {
        if (!stopped && run === generation.current) setLoading(false)
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
      const run = ++generation.current
      changing.current = true
      try {
        const data = await accountRequest({
          method: 'POST',
          body: JSON.stringify({ action, username, password }),
        })
        if (run === generation.current) accept(data)
      } catch (err) {
        setError((err as Error).message)
        throw err
      } finally {
        changing.current = false
        setLoading(false)
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
    const run = ++generation.current
    changing.current = true
    setError(null)
    try {
      const data = await accountRequest({
        method: 'POST',
        body: JSON.stringify({ action: 'signout' }),
      })
      if (run === generation.current) accept(data)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      changing.current = false
      setLoading(false)
    }
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
