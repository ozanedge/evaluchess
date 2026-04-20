import { useEffect, useState, useCallback, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { ref, set, onValue, runTransaction, serverTimestamp, push, update, get } from 'firebase/database'
import { auth, db, isAuthConfigured } from '../lib/firebase'
import { STARTING_ELO, newRating } from '../lib/elo'

// Allow letters, digits, and common symbols. Start and end must be alphanumeric so
// the username is always a valid email local-part when appended to EMAIL_DOMAIN.
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/
const EMAIL_DOMAIN = 'users.evaluchess.local'

// Realtime Database keys can't contain `. # $ [ ] /`, so we hex-encode the
// lowercase username for the /usernames uniqueness index. Collision-free.
function encodeUsernameKey(lower: string): string {
  const bytes = new TextEncoder().encode(lower)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

export interface UserProfile {
  username: string
  usernameLower: string
  elo: number
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
  createdAt: number | object
}

export interface AuthApi {
  ready: boolean
  user: User | null
  profile: UserProfile | null
  loading: boolean
  error: string | null
  signUp: (username: string, password: string) => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@${EMAIL_DOMAIN}`
}

function describeDatabaseError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? ''
  if (/permission_denied|permission denied/i.test(msg)) {
    return 'Database rules rejected the write. Check the Realtime Database rules in Firebase.'
  }
  if (/database.*not.*found|no database|url/i.test(msg)) {
    return 'Realtime Database is not set up for this Firebase project yet.'
  }
  return msg || 'Could not save profile. Try again.'
}

function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid username or password.'
    case 'auth/email-already-in-use':
      return 'That username is already taken.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a minute.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.'
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled in Firebase.'
    default:
      return (err as { message?: string })?.message || 'Something went wrong.'
  }
}

export function useAuth(): AuthApi {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const profileUnsubRef = useRef<(() => void) | null>(null)

  // Subscribe to auth state
  useEffect(() => {
    if (!isAuthConfigured || !auth) {
      setLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // Subscribe to profile whenever user changes
  useEffect(() => {
    if (profileUnsubRef.current) {
      profileUnsubRef.current()
      profileUnsubRef.current = null
    }
    if (!user || !db) {
      setProfile(null)
      return
    }
    const profileRef = ref(db, `users/${user.uid}`)
    const unsub = onValue(profileRef, (snap) => {
      const val = snap.val() as UserProfile | null
      setProfile(val)
    })
    profileUnsubRef.current = unsub
    return () => unsub()
  }, [user])

  const signUp = useCallback(async (username: string, password: string) => {
    if (!auth || !db) throw new Error('Auth not configured.')
    setError(null)
    const trimmed = username.trim()
    if (!USERNAME_RE.test(trimmed)) {
      setError('Usernames must be 3–24 characters. Letters/numbers at the start and end; _ - . + ~ ! allowed in the middle.')
      throw new Error('invalid username')
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      throw new Error('weak password')
    }

    const lower = trimmed.toLowerCase()
    const claimRef = ref(db, `usernames/${encodeUsernameKey(lower)}`)

    // Create the auth user first so we have an authenticated context for the RTDB writes.
    // If claiming the username fails (taken or DB error), we roll back by deleting the user.
    let cred
    try {
      cred = await createUserWithEmailAndPassword(auth, usernameToEmail(trimmed), password)
    } catch (err) {
      setError(describeAuthError(err))
      throw err
    }

    try {
      const tx = await runTransaction(claimRef, (current) => {
        if (current !== null && current !== undefined) return // abort — already taken
        return cred!.user.uid
      })
      if (!tx.committed) {
        await deleteUser(cred.user).catch(() => {})
        setError('That username is already taken.')
        throw new Error('username taken')
      }

      await updateProfile(cred.user, { displayName: trimmed })
      const profileData: UserProfile = {
        username: trimmed,
        usernameLower: lower,
        elo: STARTING_ELO,
        wins: 0,
        losses: 0,
        draws: 0,
        gamesPlayed: 0,
        createdAt: serverTimestamp(),
      }
      await set(ref(db, `users/${cred.user.uid}`), profileData)
    } catch (err) {
      // If we made it past user creation but RTDB failed, roll back the user so retries work.
      if (cred && (err as { message?: string })?.message !== 'username taken') {
        await deleteUser(cred.user).catch(() => {})
        setError(describeDatabaseError(err))
      }
      throw err
    }
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    if (!auth) throw new Error('Auth not configured.')
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(username.trim()), password)
    } catch (err) {
      setError(describeAuthError(err))
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!auth) return
    await fbSignOut(auth)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return {
    ready: isAuthConfigured,
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

const GAME_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000

export async function recordGameResult(
  uid: string,
  myElo: number,
  oppElo: number,
  outcome: 'win' | 'loss' | 'draw',
): Promise<number | null> {
  if (!db) return null
  const nextElo = newRating(myElo, oppElo, outcome)
  const profileRef = ref(db, `users/${uid}`)
  await runTransaction(profileRef, (current: UserProfile | null) => {
    if (!current) return current
    return {
      ...current,
      elo: nextElo,
      wins: current.wins + (outcome === 'win' ? 1 : 0),
      losses: current.losses + (outcome === 'loss' ? 1 : 0),
      draws: current.draws + (outcome === 'draw' ? 1 : 0),
      gamesPlayed: (current.gamesPlayed ?? 0) + 1,
    }
  })

  // Also record a timestamped game event so the 24h leaderboard has rolling data.
  // Prune the user's own stale events in the same write to keep storage bounded.
  try {
    const eventsRef = ref(db, `gameEvents/${uid}`)
    const snap = await get(eventsRef)
    const now = Date.now()
    const cutoff = now - GAME_EVENT_WINDOW_MS
    const updates: Record<string, null | { o: string; at: number }> = {}
    snap.forEach((child) => {
      const val = child.val() as { at?: number } | null
      if (val?.at && val.at < cutoff) {
        updates[child.key!] = null
      }
      return undefined
    })
    const newKey = push(eventsRef).key!
    updates[newKey] = { o: outcome, at: now }
    await update(eventsRef, updates)
  } catch (err) {
    // Non-fatal: lifetime totals already updated on the profile.
    console.error('Failed to record game event', err)
  }

  return nextElo
}
