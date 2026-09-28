import type { PlayerSettings } from '../lib/settings'

interface Props {
  settings: PlayerSettings
  onChange: (patch: Partial<PlayerSettings>) => void
}

const toggles = [
  ['moveFeedback', 'Move feedback', 'Live accuracy labels and arrows'],
  ['sound', 'Sound', 'Moves, captures, checks and a 20-second warning'],
  ['premoves', 'Premoves', 'Queue a move during your opponent’s turn'],
  ['confirmResignation', 'Confirm resignation', 'Ask before ending your game'],
] as const

const selectClass = 'rounded-lg border border-white/15 bg-gray-800 px-2 py-2 text-white text-sm'

export default function GameSettings({ settings, onChange }: Props) {
  return (
    <div className="space-y-4">
      {toggles.map(([key, title, description]) => (
        <label key={key} className="flex items-center justify-between gap-3 cursor-pointer">
          <span>
            <span className="block text-sm text-gray-200">{title}</span>
            <span className="block mt-1 text-xs text-gray-400 leading-relaxed">{description}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label={title}
            checked={settings[key]}
            onChange={(event) => onChange({ [key]: event.target.checked })}
            className="h-5 w-5 shrink-0 accent-indigo-500 cursor-pointer"
          />
        </label>
      ))}
      <div className="space-y-3 border-t border-white/10 pt-4">
        <label className="flex items-center justify-between gap-3 text-sm text-gray-200">
          Board colors
          <select
            className={selectClass}
            value={settings.boardTheme}
            onChange={(event) =>
              onChange({ boardTheme: event.target.value as PlayerSettings['boardTheme'] })
            }
          >
            <option value="green">Forest</option>
            <option value="walnut">Walnut</option>
            <option value="blue">Slate blue</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-gray-200">
          Piece style
          <select
            className={selectClass}
            value={settings.pieceStyle}
            onChange={(event) =>
              onChange({ pieceStyle: event.target.value as PlayerSettings['pieceStyle'] })
            }
          >
            <option value="classic">Classic</option>
            <option value="modern">Modern</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-gray-200">
          Pawn promotion
          <select
            aria-label="Promotion piece"
            className={selectClass}
            value={settings.promotion}
            onChange={(event) =>
              onChange({ promotion: event.target.value as PlayerSettings['promotion'] })
            }
          >
            <option value="q">Queen</option>
            <option value="r">Rook</option>
            <option value="b">Bishop</option>
            <option value="n">Knight</option>
          </select>
        </label>
      </div>
    </div>
  )
}
