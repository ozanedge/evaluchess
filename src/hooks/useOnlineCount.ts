import { useEffect, useState, useRef } from 'react'

function getPlayerId(): string {
  let id = sessionStorage.getItem('evalu_pid')
  if (!id) {
    id = Math.random().toString(36).substring(2, 12) + Date.now().toString(36)
    sessionStorage.setItem('evalu_pid', id)
  }
  return id
}

/**
 * Heartbeat this client's presence every 60s. If a username is provided it's
 * included in the request so server-side logs / observability can tie the
 * online count back to identified players.
 */
export function useOnlineCount(username?: string): number {
  const [count, setCount] = useState(0)
  const usernameRef = useRef(username)
  usernameRef.current = username

  useEffect(() => {
    const id = getPlayerId()

    const heartbeat = async () => {
      try {
        const params = new URLSearchParams({ id })
        if (usernameRef.current) params.set('username', usernameRef.current)
        const res = await fetch(`/api/online?${params.toString()}`)
        const { count } = await res.json() as { count: number }
        setCount(count)
      } catch { /* ignore */ }
    }

    heartbeat()
    const interval = setInterval(heartbeat, 60_000)
    return () => clearInterval(interval)
  }, [])

  return count
}
