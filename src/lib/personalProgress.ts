import type { SavedGame } from './savedGame.js'

export function personalProgress(games: SavedGame[]) {
  const analyzed = [...new Map(games.map((game) => [game.id, game])).values()]
    .filter((game) => game.result && Array.isArray(game.analysis?.moves))
    .sort((a, b) => (a.completedAt || a.updatedAt) - (b.completedAt || b.updatedAt))
    .flatMap((game) => {
      const moves = game.analysis!.moves.filter((move) => move.player === game.playerColor)
      if (!moves.length || moves.some((move) => !Number.isFinite(move.accuracy))) return []
      return [
        {
          game,
          accuracy: moves.reduce((sum, move) => sum + move.accuracy, 0) / moves.length,
          blunders: moves.filter((move) => move.classification === 'blunder').length,
          ownMoves: moves.length,
        },
      ]
    })
  const recent = analyzed.slice(-20)
  const latest = analyzed.slice(-5),
    previous = analyzed.slice(-10, -5)
  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const accuracy = average(latest.map((game) => game.accuracy))
  const blunders = average(latest.map((game) => game.blunders))
  const previousAccuracy = average(previous.map((game) => game.accuracy))
  const previousBlunders = average(previous.map((game) => game.blunders))
  const comparable = latest.length === 5 && previous.length === 5
  const practice = (classification: string) => {
    let total = 0,
      solved = 0
    for (const { game } of analyzed) {
      game.analysis!.moves.forEach((move, ply) => {
        if (move.player !== game.playerColor || move.classification !== classification) return
        total++
        if (game.attempts?.[ply]?.solved) solved++
      })
    }
    return { total, solved }
  }
  const qualifying = analyzed.filter((game) => game.ownMoves >= 20)
  const skillLatest = qualifying.slice(-5),
    skillPrevious = qualifying.slice(-10, -5)
  const skillGain =
    skillLatest.length === 5 && skillPrevious.length === 5
      ? average(skillLatest.map((game) => game.accuracy))! -
        average(skillPrevious.map((game) => game.accuracy))!
      : 0
  return {
    recent,
    analyzedCount: analyzed.length,
    accuracy,
    blunders,
    accuracyChange: comparable ? accuracy! - previousAccuracy! : null,
    blunderChange: comparable ? blunders! - previousBlunders! : null,
    mistakes: practice('mistake'),
    blunderPractice: practice('blunder'),
    cleanGames: qualifying.filter((game) => game.blunders === 0).length,
    preciseGames: qualifying.filter((game) => game.accuracy >= 90).length,
    improvement: skillGain >= 5 ? 1 : 0,
  }
}
