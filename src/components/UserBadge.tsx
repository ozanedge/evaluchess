import { useState, useRef, useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import type { AuthApi } from '../hooks/useAuth'

interface UserBadgeProps {
  auth: AuthApi
  onlineCount: number
  onOpenAuth: (mode: 'signin' | 'signup') => void
  children: ReactNode
}

export default function UserBadge({ auth, onlineCount, onOpenAuth, children }: UserBadgeProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const p = auth.profile
  const initial = p?.username?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="relative flex items-center gap-2" ref={menuRef}>
      <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 glass-subtle rounded-full px-3 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        {onlineCount} online
      </div>
      <div>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-gray-200 hover:text-white hover:ring-white/20 transition-all"
        >
          {auth.user ? (
            <>
              <span className="w-8 h-8 rounded-full badge-avatar flex items-center justify-center text-sm font-bold ring-1 ring-white/15">
                {initial}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white tracking-tight">
                  {p?.username ?? 'Account'}
                </span>
                {p && (
                  <span className="border-l border-white/15 pl-2 text-sm font-mono font-semibold text-indigo-300 tabular-nums">
                    {p.elo}
                  </span>
                )}
              </span>
            </>
          ) : (
            'Settings'
          )}
        </button>

        {open && (
          <div
            id={menuId}
            role="region"
            aria-label="Player settings"
            className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-white/15 bg-[#17221e] p-4 shadow-2xl z-50"
          >
            {auth.user && p && (
              <>
                <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                  <span className="w-10 h-10 shrink-0 rounded-full badge-avatar flex items-center justify-center text-base font-bold">
                    {initial}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-sm font-semibold text-white">{p.username}</div>
                    <div className="text-xs font-mono text-indigo-300 tabular-nums">
                      {p.elo} Elo
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3">
                  <Stat label="Wins" value={p.wins} color="text-emerald-300" />
                  <Stat label="Losses" value={p.losses} color="text-red-300" />
                  <Stat label="Draws" value={p.draws} color="text-gray-300" />
                </div>
              </>
            )}
            <section className="py-2">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Settings
              </h2>
              {children}
            </section>
            {auth.error && (
              <p role="alert" className="text-xs text-red-300">
                {auth.error}
              </p>
            )}
            {auth.user && (
              <button
                onClick={() => {
                  setOpen(false)
                  void auth.signOut()
                }}
                className="mt-3 w-full text-xs font-semibold py-2 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-gray-200 hover:text-white transition-all"
              >
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
      {auth.ready && !auth.user && (
        <button
          onClick={() => {
            setOpen(false)
            onOpenAuth('signin')
          }}
          className="text-xs font-semibold px-3 py-1.5 rounded-full glass-subtle text-gray-200 hover:text-white hover:ring-white/20 transition-all"
        >
          Sign in
        </button>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center py-2 rounded-lg bg-white/5">
      <span className={`text-base font-bold font-mono tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  )
}
