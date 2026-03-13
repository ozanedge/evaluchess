import type { GameAnalysisResult, MoveClassification, PlayerStats } from '../utils/analysis'

interface AnalysisProps {
  result: GameAnalysisResult
  onNewGame: () => void
  onMoveClick: (index: number) => void
  selectedMoveIndex: number | null
}

const classificationColors: Record<MoveClassification, string> = {
  brilliant: 'text-cyan-400',
  best: 'text-green-400',
  good: 'text-emerald-300',
  inaccuracy: 'text-yellow-400',
  mistake: 'text-orange-400',
  blunder: 'text-red-500',
}

const classificationBg: Record<MoveClassification, string> = {
  brilliant: 'bg-cyan-900/40 border-cyan-700',
  best: 'bg-green-900/40 border-green-700',
  good: 'bg-emerald-900/30 border-emerald-800',
  inaccuracy: 'bg-yellow-900/30 border-yellow-700',
  mistake: 'bg-orange-900/30 border-orange-700',
  blunder: 'bg-red-900/40 border-red-700',
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={`font-semibold text-sm ${color}`}>{value}</span>
    </div>
  )
}

function PlayerCard({ name, stats, color }: { name: string; stats: PlayerStats; color: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex-1">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-4 h-4 rounded-full ${color === 'white' ? 'bg-white' : 'bg-gray-900 border border-gray-600'}`} />
        <span className="font-semibold text-white">{name}</span>
      </div>
      <div className="text-center mb-4">
        <div className="text-4xl font-bold text-white">{stats.accuracy}%</div>
        <div className="text-gray-400 text-sm">Accuracy</div>
      </div>
      <div className="space-y-0.5">
        {stats.brilliant > 0 && <StatRow label="Brilliant" value={stats.brilliant} color="text-cyan-400" />}
        <StatRow label="Best" value={stats.best} color="text-green-400" />
        <StatRow label="Good" value={stats.good} color="text-emerald-300" />
        <StatRow label="Inaccuracy" value={stats.inaccuracy} color="text-yellow-400" />
        <StatRow label="Mistake" value={stats.mistake} color="text-orange-400" />
        <StatRow label="Blunder" value={stats.blunder} color="text-red-500" />
      </div>
    </div>
  )
}

export default function Analysis({ result, onNewGame, onMoveClick, selectedMoveIndex }: AnalysisProps) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-white">Game Analysis</h2>

      {/* Player stats */}
      <div className="flex gap-3">
        <PlayerCard name="White" stats={result.white} color="white" />
        <PlayerCard name="Black" stats={result.black} color="black" />
      </div>

      {/* Move list */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Move Review</h3>
        <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
          {result.moves.map((m, i) => (
            <div
              key={i}
              onClick={() => onMoveClick(i)}
              className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-opacity ${
                classificationBg[m.classification]
              } ${selectedMoveIndex === i ? 'ring-2 ring-white/40' : 'hover:opacity-80'}`}
            >
              <span className="text-gray-500 w-8 text-xs">
                {m.player === 'white' ? `${m.moveNumber}.` : `${m.moveNumber}...`}
              </span>
              <span className="font-mono font-medium text-white w-16">{m.move}</span>
              <span className={`font-semibold capitalize ${classificationColors[m.classification]}`}>
                {m.classification}
              </span>
              <span className="text-gray-500 text-xs w-16 text-right">
                {m.cpLoss > 0 ? `-${m.cpLoss}cp` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onNewGame}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors"
      >
        New Game
      </button>
    </div>
  )
}
