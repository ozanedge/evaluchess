import { useEffect, useState } from 'react'

function getPlayerId(): string {
  let id = sessionStorage.getItem('evalu_pid')
  if (!id) {
    id = Math.random().toString(36).substring(2, 12) + Date.now().toString(36)
    sessionStorage.setItem('evalu_pid', id)
  }
  return id
}

export function useOnlineCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const id = getPlayerId()

    const heartbeat = async () => {
      try {
        const res = await fetch(`/api/online?id=${id}`)
        const { count } = await res.json() as { count: number }
        setCount(count)
      } catch { /* ignore */ }
    }

    heartbeat()
    const interval = setInterval(heartbeat, 10_000)
    return () => clearInterval(interval)
  }, [])

  return count
}
