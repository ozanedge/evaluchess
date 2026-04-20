import { useEffect, useState } from 'react'
import type { AuthApi } from '../hooks/useAuth'

interface AuthModalProps {
  auth: AuthApi
  onClose: () => void
  initialMode?: 'signin' | 'signup'
}

export default function AuthModal({ auth, onClose, initialMode = 'signin' }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const { clearError } = auth
  useEffect(() => {
    clearError()
  }, [mode, clearError])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'signup') {
        await auth.signUp(username, password)
      } else {
        await auth.signIn(username, password)
      }
      onClose()
    } catch {
      // error surfaced via auth.error
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold gradient-text tracking-tight">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Username</span>
            <input
              autoFocus
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="bg-black/30 ring-1 ring-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-indigo-400/50 focus:bg-black/40 transition-all"
              placeholder="3–24 characters · letters, numbers, _ - . + ~ !"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="bg-black/30 ring-1 ring-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-indigo-400/50 focus:bg-black/40 transition-all"
              placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
              required
            />
          </label>

          {auth.error && (
            <div className="text-xs text-red-300 bg-red-500/10 ring-1 ring-red-400/30 rounded-lg px-3 py-2">
              {auth.error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full py-2.5 rounded-xl text-sm tracking-tight disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>

          <div className="flex items-center justify-center gap-1.5 mt-2 text-sm">
            <span className="text-gray-400">
              {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
            </span>
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              className="font-semibold text-indigo-300 hover:text-indigo-200 underline underline-offset-4 decoration-indigo-400/50 hover:decoration-indigo-300 transition-colors py-1"
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </div>
        </form>

        <p className="text-[11px] text-gray-500 leading-relaxed mt-4 text-center">
          Signing in unlocks Elo rating and W/L tracking for Speed Pair games. Guest play still works anytime.
        </p>
      </div>
    </div>
  )
}
