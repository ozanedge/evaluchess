import type { SavedGame } from '../lib/library'
import { personalProgress } from '../lib/personalProgress'

export default function PersonalProgress({
  games,
  onOpen,
}: {
  games: SavedGame[]
  onOpen: (game: SavedGame) => void
}) {
  const progress = personalProgress(games)
  const signed = (value: number, suffix = '') =>
    `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}`
  const points = progress.recent
    .map(
      (game, i) =>
        `${progress.recent.length === 1 ? 300 : 30 + (i * 540) / (progress.recent.length - 1)},${150 - game.accuracy * 1.2}`
    )
    .join(' ')
  return (
    <section className="personal-progress space-y-4" aria-label="Your improvement">
      <div className="progress-summary">
        <article className="glass rounded-xl p-4">
          <h3>Accuracy</h3>
          <strong>{progress.accuracy === null ? '—' : `${progress.accuracy.toFixed(1)}%`}</strong>
          <p>
            {progress.accuracyChange === null
              ? 'Latest 5 analyzed games'
              : `${signed(progress.accuracyChange, ' pts')} vs previous 5`}
          </p>
        </article>
        <article className="glass rounded-xl p-4">
          <h3>Blunders / game</h3>
          <strong>{progress.blunders === null ? '—' : progress.blunders.toFixed(1)}</strong>
          <p>
            {progress.blunderChange === null
              ? 'Latest 5 analyzed games'
              : `${signed(progress.blunderChange)} vs previous 5 · lower is better`}
          </p>
        </article>
      </div>
      <p className="text-xs text-gray-400">
        Only your moves in completed, analyzed games count. Trends compare your latest 5 games with
        the previous 5; shorter histories show the available games.
      </p>
      {!progress.recent.length ? (
        <p className="glass rounded-xl p-4 text-sm text-gray-300">
          Finish and analyze a game to start tracking your improvement.
        </p>
      ) : (
        <article className="glass rounded-xl p-4">
          <h3 className="eyebrow">Accuracy across recent games</h3>
          <svg
            viewBox="0 0 600 185"
            role="img"
            aria-label="Your accuracy across the latest 20 analyzed games, oldest to newest. Exact values are listed below."
            className="progress-chart"
          >
            {[0, 50, 100].map((value) => (
              <g key={value}>
                <line
                  x1="30"
                  x2="570"
                  y1={150 - value * 1.2}
                  y2={150 - value * 1.2}
                  stroke="#ffffff18"
                />
                <text x="0" y={154 - value * 1.2} fill="#99aaa1" fontSize="11">
                  {value}
                </text>
              </g>
            ))}
            <polyline
              points={points}
              fill="none"
              stroke="#c4f078"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {progress.recent.map((game, i) => (
              <circle
                key={game.game.id}
                cx={
                  progress.recent.length === 1 ? 300 : 30 + (i * 540) / (progress.recent.length - 1)
                }
                cy={150 - game.accuracy * 1.2}
                r="4"
                fill="#c4f078"
              />
            ))}
            <text x="30" y="180" fill="#99aaa1" fontSize="11">
              Older
            </text>
            <text x="570" y="180" textAnchor="end" fill="#99aaa1" fontSize="11">
              Latest
            </text>
          </svg>
          <details>
            <summary className="cursor-pointer text-sm text-gray-300">Game-by-game details</summary>
            <div className="overflow-x-auto mt-3">
              <table className="progress-games w-full text-xs">
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Accuracy</th>
                    <th>Blunders</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {[...progress.recent].reverse().map(({ game, accuracy, blunders }) => (
                    <tr key={game.id}>
                      <td>
                        {new Date(game.completedAt || game.updatedAt).toLocaleDateString()}
                        <br />
                        {game.mode === 'computer' ? 'Computer' : 'Online'}
                      </td>
                      <td>{accuracy.toFixed(1)}%</td>
                      <td>{blunders}</td>
                      <td>
                        <button className="accent-text underline" onClick={() => onOpen(game)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </article>
      )}
      <article className="glass rounded-xl p-4 space-y-3">
        <h3 className="eyebrow">Mistakes retried successfully</h3>
        {(
          [
            ['Mistakes', progress.mistakes],
            ['Blunders', progress.blunderPractice],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="accent-text">
                {value.solved} / {value.total}
              </span>
            </div>
            <progress
              className="practice-progress"
              aria-label={`${label} solved in practice`}
              max={value.total || 1}
              value={value.solved}
            />
          </div>
        ))}
        <p className="text-xs text-gray-400">
          These are positions you found a better move in during practice. Revealing the answer alone
          doesn’t count.
        </p>
      </article>
    </section>
  )
}
