let owner: string | null = null
let revision = 0
const listeners = new Set<() => void>()
export const progressOwner = () => owner
export const progressKey = (base: string) => (owner ? `${base}:${owner}` : base)
export function changeProgressOwner(uid: string | null) {
  owner = uid
  notifyProgress()
}
export function notifyProgress() {
  revision++
  for (const listener of listeners) listener()
}
export const progressRevision = () => revision
export function subscribeProgress(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function pendingProgress(): Record<string, string> {
  try {
    const data = JSON.parse(localStorage.getItem(progressKey('evaluchess.pending.v1')) || '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}
export function markProgressPending(id: string) {
  const pending = pendingProgress()
  pending[id] = `${Date.now()}-${Math.random()}`
  localStorage.setItem(progressKey('evaluchess.pending.v1'), JSON.stringify(pending))
}
export function acknowledgeProgress(sent: Record<string, string>) {
  const pending = pendingProgress()
  for (const [id, revision] of Object.entries(sent))
    if (pending[id] === revision) delete pending[id]
  localStorage.setItem(progressKey('evaluchess.pending.v1'), JSON.stringify(pending))
}
