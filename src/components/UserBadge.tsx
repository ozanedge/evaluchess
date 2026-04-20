import { useState, useRef, useEffect } from 'react'
import type { AuthApi } from '../hooks/useAuth'

interface UserBadgeProps {
  auth: AuthApi
  onlineCount: number
  onOpenAuth: (mode: 'signin' | 'signup') => void
}

export default function UserBadge({ auth, onlineCount, onOpenAuth }: UserBadgeProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const onlinePill = (
    <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 glass-subtle rounded-full px-3 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
      {onlineCount} online
    </div>
  )

  if (!auth.ready) return onlinePill

  if (!auth.user) {
    return (
      <div className="flex items-center gap-2">
        {onlinePill}
        <button
          onClick={() => onOpenAuth('signin')}
          className="text-xs font-semibold px-3 py-1.5 rounded-full glass-subtle text-gray-200 hover:text-white hover:ring-white/20 transition-all"
        >
          Sign in
        </button>
      </div>
    )
  }

  const p = auth.profile
  const initial = p?.username?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="flex items-center gap-2" ref={menuRef}>
      {onlinePill}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 pl-1.5 pr-4 py-1.5 rounded-full glass-subtle hover:ring-white/20 transition-all"
        >
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-sm font-bold text-white ring-1 ring-white/15">
            {initial}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white tracking-tight">{p?.username ?? '…'}</span>
            {p && (
              <>
                <span className="w-px h-4 bg-white/15" />
                <span className="text-sm font-mono font-semibold text-indigo-300 tabular-nums">
                  {p.elo}
                </span>
              </>
            )}
          </span>
        </button>

        {open && p && (
          <div className="absolute right-0 top-full mt-2 w-56 glass rounded-xl p-3 z-30">
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
              <span className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-base font-bold text-white ring-1 ring-white/15">
                {initial}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-white">{p.username}</div>
                <div className="text-[11px] font-mono text-indigo-300 tabular-nums">{p.elo} elo</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 py-3">
              <Stat label="Wins"   value={p.wins}   color="text-emerald-300" />
              <Stat label="Losses" value={p.losses} color="text-red-300" />
              <Stat label="Draws"  value={p.draws}  color="text-gray-300" />
            </div>
            <button
              onClick={() => { setOpen(false); auth.signOut() }}
              className="w-full text-xs font-semibold py-2 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-gray-200 hover:text-white transition-all"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center py-1.5 rounded-lg bg-white/[0.03] ring-1 ring-white/5">
      <span className={`text-base font-bold font-mono tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
    </div>
  )
}
