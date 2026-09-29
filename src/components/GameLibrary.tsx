import { readLibrary, exportPgn } from '../lib/library'
import { progressOwner } from '../lib/progressScope'
import type { SavedGame } from '../lib/library'
export default function GameLibrary({
  onOpen,
  onPractice,
}: {
  onOpen: (game: SavedGame) => void
  onPractice: (game: SavedGame, ply: number) => void
}) {
  const library = readLibrary()
  return (
    <section className="glass rounded-2xl p-4 space-y-4" aria-label="Saved games">
      <h2 className="font-semibold text-white">Your games & practice</h2>
      <p className="text-sm text-gray-400">
        {progressOwner()
          ? 'Your latest 50 games sync to your account.'
          : 'The latest 50 games stay in this browser. Sign in to sync across devices.'}{' '}
        Download PGN to keep a copy.
      </p>
      {!library.games.length && (
        <p className="text-gray-300">Play a game to start your learning collection.</p>
      )}
      {library.games.map((game) => {
        const mistakes =
          game.analysis?.moves
            .map((m, i) => ({ ...m, i }))
            .filter(
              (m) =>
                m.player === game.playerColor && ['mistake', 'blunder'].includes(m.classification)
            ) || []
        const solved = mistakes.filter((m) => game.attempts?.[m.i]?.solved).length
        return (
          <article key={game.id} className="rounded-xl border border-white/10 p-3 space-y-2">
            <h3 className="font-semibold">
              {game.mode === 'computer' ? 'Computer game' : 'Online game'} ·{' '}
              {new Date(game.updatedAt).toLocaleDateString()}
            </h3>
            <p className="text-sm text-gray-300">
              {game.result || 'In progress'} · {game.moves.length} half-moves
            </p>
            {game.analysis && (
              <p className="text-sm text-gray-400">
                {game.analysis[game.playerColor].accuracy}% accuracy · {solved}/{mistakes.length}{' '}
                mistakes practiced successfully
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary rounded-lg px-3 py-2 text-sm"
                onClick={() => onOpen(game)}
              >
                {game.result ? 'Review game' : 'Resume game'}
              </button>
              <button
                className="rounded-lg px-3 py-2 text-sm bg-white/10"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([exportPgn(game)], { type: 'application/x-chess-pgn' })
                  )
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `evaluchess-${game.id}.pgn`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Download PGN
              </button>
              {mistakes.map((m) => (
                <button
                  key={m.i}
                  className="rounded-lg px-3 py-2 text-sm bg-white/10"
                  onClick={() => onPractice(game, m.i)}
                >
                  {game.attempts?.[m.i]?.solved ? '✓ ' : ''}Practice {m.moveNumber}
                  {m.player === 'white' ? '.' : '…'} {m.move}
                </button>
              ))}
            </div>
          </article>
        )
      })}
    </section>
  )
}
