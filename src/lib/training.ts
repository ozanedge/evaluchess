import type { SavedGame } from './savedGame.js'
import { progressKey } from './progressScope'
import { personalProgress } from './personalProgress'

const KEY = 'evaluchess.badges.v1'

const badges = [
  {
    id: 'first-finish',
    title: 'First finish',
    icon: 'bolt',
    metric: 'finished',
    target: 1,
    description: 'Complete a game',
  },
  {
    id: 'analyst',
    title: 'Analyst',
    icon: 'book',
    metric: 'analyzed',
    target: 1,
    description: 'Get a game analyzed',
  },
  {
    id: 'tactician',
    title: 'Tactician',
    icon: 'target',
    metric: 'solved',
    target: 1,
    description: 'Solve a practice position',
  },
  {
    id: 'regular',
    title: 'Regular',
    icon: 'flag',
    metric: 'finished',
    target: 5,
    description: 'Complete 5 games',
  },
  {
    id: 'problem-solver',
    title: 'Problem Solver',
    icon: 'puzzle',
    metric: 'solved',
    target: 5,
    description: 'Solve 5 different positions',
  },
  {
    id: 'deep-thinker',
    title: 'Deep Thinker',
    icon: 'search',
    metric: 'analyzed',
    target: 10,
    description: 'Get 10 games analyzed',
  },
  {
    id: 'tactics-expert',
    title: 'Tactics Expert',
    icon: 'flame',
    metric: 'solved',
    target: 15,
    description: 'Solve 15 different positions',
  },
  {
    id: 'veteran',
    title: 'Veteran',
    icon: 'shield',
    metric: 'finished',
    target: 25,
    description: 'Complete 25 games',
  },
  {
    id: 'practice-master',
    title: 'Practice Master',
    icon: 'crown',
    metric: 'solved',
    target: 50,
    description: 'Solve 50 different positions',
  },
  {
    id: 'steady-hand',
    title: 'Steady Hand',
    icon: 'shield',
    metric: 'cleanGames',
    target: 1,
    description: 'No blunders in a finished game · 20+ of your moves',
  },
  {
    id: 'precision',
    title: 'Precision',
    icon: 'target',
    metric: 'preciseGames',
    target: 1,
    description: '90% accuracy in a finished game · 20+ of your moves',
  },
  {
    id: 'on-the-rise',
    title: 'On the Rise',
    icon: 'spark',
    metric: 'improvement',
    target: 1,
    description: 'Gain 5 accuracy points: latest 5 vs previous 5 games · 20+ of your moves each',
  },
] as const

export function readEarnedBadges(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(progressKey(KEY)) || 'null')
    return Array.isArray(stored)
      ? stored.filter((id): id is string => badges.some((badge) => badge.id === id))
      : []
  } catch {
    return []
  }
}

export function trainingMilestones(games: SavedGame[], earned: string[] = []) {
  const uniqueGames = [...new Map(games.map((game) => [game.id, game])).values()]
  const skills = personalProgress(uniqueGames)
  const counts = {
    cleanGames: skills.cleanGames,
    preciseGames: skills.preciseGames,
    improvement: skills.improvement,
    finished: uniqueGames.filter((game) => game.result && game.moves.length > 0).length,
    analyzed: uniqueGames.filter((game) => game.analysis && game.moves.length > 0).length,
    solved: uniqueGames.reduce(
      (sum, game) =>
        sum +
        Object.entries(game.attempts || {}).filter(([ply, attempt]) => {
          const index = Number(ply)
          return (
            Number.isInteger(index) &&
            index >= 0 &&
            index < game.moves.length &&
            index % 2 === (game.playerColor === 'white' ? 0 : 1) &&
            attempt?.solved === true
          )
        }).length,
      0
    ),
  }
  return {
    solved: counts.solved,
    milestones: badges.map((badge, index) => ({
      ...badge,
      tier: Math.floor(index / 3) + 1,
      current: Math.min(counts[badge.metric], badge.target),
      done: counts[badge.metric] >= badge.target || earned.includes(badge.id),
    })),
  }
}

export function rememberEarnedBadges(games: SavedGame[]) {
  const earned = readEarnedBadges()
  const { milestones } = trainingMilestones(games, earned)
  const unlocked = milestones.filter((badge) => badge.done).map((badge) => badge.id)
  if (unlocked.every((id) => earned.includes(id))) return
  try {
    localStorage.setItem(progressKey(KEY), JSON.stringify(unlocked))
  } catch {
    // Storage can be unavailable; current saved-game progress still renders.
  }
}
