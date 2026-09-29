import { useEffect } from 'react'
import { progressOwner } from '../lib/progressScope'
import { readLibrary } from '../lib/library'
import type { SavedGame } from '../lib/library'
import { readEarnedBadges, rememberEarnedBadges, trainingMilestones } from '../lib/training'
import Icon from './Icon'

export default function TrainingProgress({
  onPractice,
}: {
  onPractice: (game: SavedGame, ply: number) => void
}) {
  const { games } = readLibrary()
  const previouslyEarned = readEarnedBadges()
  const { solved, milestones } = trainingMilestones(games, previouslyEarned)
  useEffect(() => rememberEarnedBadges(games), [games])
  const earned = milestones.filter((item) => item.done).length
  let nextPractice: { game: SavedGame; ply: number } | undefined
  for (const game of games) {
    const ply =
      game.analysis?.moves.findIndex(
        (move, index) =>
          move.player === game.playerColor &&
          ['mistake', 'blunder'].includes(move.classification) &&
          !game.attempts?.[index]?.solved
      ) ?? -1
    if (ply >= 0) {
      nextPractice = { game, ply }
      break
    }
  }
  const practice = nextPractice
  return (
    <section className="training-card" aria-label="Training milestones">
      <div className="section-heading">
        <span className="eyebrow">Your training journey</span>
        <span className="progress-count">
          {earned}/{milestones.length} unlocked
        </span>
      </div>
      <div
        className="milestone-track"
        role="progressbar"
        aria-label="Training milestones unlocked"
        aria-valuenow={earned}
        aria-valuemin={0}
        aria-valuemax={milestones.length}
      >
        <div style={{ width: `${(earned / milestones.length) * 100}%` }} />
      </div>
      <div className="milestones">
        {milestones.map((item) => (
          <div
            key={item.title}
            className={`milestone milestone-tier-${item.tier} ${item.done ? 'earned' : ''}`}
            title={`${item.description}${item.done ? ' · Unlocked' : ''}`}
          >
            <span className="milestone-icon">
              <Icon name={item.icon} size={22} />
              {item.done && (
                <span className="milestone-check">
                  <Icon name="check" size={10} />
                </span>
              )}
            </span>
            <strong>{item.title}</strong>
            <span className="milestone-description">{item.description}</span>
            <span className="milestone-status">
              {item.done ? 'Unlocked' : `${item.current}/${item.target}`}
            </span>
          </div>
        ))}
      </div>
      {practice && (
        <button className="training-action" onClick={() => onPractice(practice.game, practice.ply)}>
          <span>Turn a mistake into a strength</span>
          <Icon name="arrow" size={17} />
        </button>
      )}
      <p className="training-note">
        {progressOwner()
          ? 'Progress from your saved games'
          : 'Progress from games saved in this browser'}
        {solved > 0 ? ` · ${solved} position${solved === 1 ? '' : 's'} solved` : ''}. Unlocked
        badges stay earned{progressOwner() ? ' in your account.' : ' here.'}
      </p>
    </section>
  )
}
