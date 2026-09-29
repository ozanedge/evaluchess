import { useEffect, useState } from 'react'
import { readLibrary, receiveAccountProgress } from '../lib/library'
import { readEarnedBadges } from '../lib/training'
import {
  acknowledgeProgress,
  pendingProgress,
  progressOwner,
  subscribeProgress,
} from '../lib/progressScope'

export function useAccountProgress(uid: string | null, loading: boolean) {
  const [state, setState] = useState({ status: 'local', error: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (loading || !uid) {
      setState({ status: loading ? 'loading' : 'local', error: '' })
      return
    }
    let stopped = false,
      running = false,
      pullNeeded = true,
      failures = 0,
      needsAttention = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const current = () => !stopped && progressOwner() === uid
    async function request(body?: unknown, cursor = 0) {
      const response = await fetch(`/api/library${body ? '' : `?cursor=${cursor}`}`, {
        method: body ? 'POST' : 'GET',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      const data = await response.json()
      if (!response.ok) {
        needsAttention = response.status === 400 || data.code === 'different-continuation'
        throw new Error(data.error || 'Progress could not sync. Please retry.')
      }
      if (data.uid !== uid) throw new Error('Your account changed. Sign in again to sync.')
      return data
    }
    function schedule(delay = 5000) {
      if (!current() || timer || running || needsAttention) return
      timer = setTimeout(() => {
        timer = undefined
        void sync()
      }, delay)
    }
    async function sync() {
      if (!current() || running) return
      running = true
      setState({ status: 'syncing', error: '' })
      try {
        if (pullNeeded) {
          let cursor: number | null = 0
          do {
            const data = await request(undefined, cursor)
            if (!current()) return
            receiveAccountProgress(data.games, data.badges)
            cursor = data.cursor
          } while (cursor !== null)
          pullNeeded = false
        }
        // One bounded batch per turn keeps gameplay responsive during an import.
        const pending = pendingProgress()
        const ids = Object.keys(pending).slice(0, 5)
        const games = readLibrary().games.filter((game) => ids.includes(game.id))
        const data = await request({ uid, games, badges: readEarnedBadges() })
        if (!current()) return
        receiveAccountProgress(data.games, data.badges)
        acknowledgeProgress(Object.fromEntries(ids.map((id) => [id, pending[id]])))
        failures = 0
        setState({
          status: Object.keys(pendingProgress()).length ? 'syncing' : 'synced',
          error: '',
        })
      } catch (error) {
        if (!current()) return
        failures++
        const message =
          (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError'
            ? 'Sync timed out. Your progress is saved on this device.'
            : (error as Error).message === 'Failed to fetch'
              ? 'You’re offline. Your progress will sync when you reconnect.'
              : (error as Error).message
        setState({ status: 'error', error: message })
      } finally {
        running = false
        if (current() && (failures || Object.keys(pendingProgress()).length))
          schedule(failures ? Math.min(60000, 5000 * 2 ** Math.min(failures, 4)) : 1000)
      }
    }
    const unsubscribe = subscribeProgress(() => {
      if (Object.keys(pendingProgress()).length) {
        if (!failures) setState({ status: 'syncing', error: '' })
        schedule()
      }
    })
    const refresh = () => {
      pullNeeded = true
      schedule(0)
    }
    const interval = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('storage', refresh)
    void sync()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
      clearInterval(interval)
      unsubscribe()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [uid, loading, retry])
  return { ...state, retry: () => setRetry((value) => value + 1) }
}
