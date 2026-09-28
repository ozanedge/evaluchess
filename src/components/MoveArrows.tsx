import { useId, useState } from 'react'
import type { FeedbackArrow } from '../utils/moveFeedback'

export default function MoveArrows({
  arrows,
  orientation,
  fade = false,
}: {
  arrows: FeedbackArrow[]
  orientation: 'white' | 'black'
  fade?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const [expired, setExpired] = useState(false)
  if (!arrows.length || expired) return null
  const point = (square: string) => {
    const file = square.charCodeAt(0) - 97,
      rank = Number(square[1]) - 1
    return orientation === 'white'
      ? { x: file * 100 + 50, y: (7 - rank) * 100 + 50 }
      : { x: (7 - file) * 100 + 50, y: rank * 100 + 50 }
  }
  const overlapping =
    arrows.length === 2 &&
    arrows[0].startSquare === arrows[1].startSquare &&
    arrows[0].endSquare === arrows[1].endSquare
  return (
    <svg
      data-testid="move-feedback-arrows"
      viewBox="0 0 800 800"
      className={`absolute inset-0 w-full h-full ${fade ? 'move-arrows-fade' : ''}`}
      style={{ pointerEvents: 'none' }}
      onAnimationEnd={fade ? () => setExpired(true) : undefined}
      role="img"
      aria-label={arrows
        .map((a) => `${a.kind === 'best' ? 'Best' : 'Played'} move ${a.uci}`)
        .join('; ')}
    >
      {arrows.map((arrow, i) => {
        const start = point(arrow.startSquare),
          end = point(arrow.endSquare)
        const dx = end.x - start.x,
          dy = end.y - start.y
        // Different promotion pieces can share the same squares; keep both visible.
        const offset = overlapping ? (i ? 9 : -9) : 0
        const ox = (-dy / Math.hypot(dx, dy)) * offset,
          oy = (dx / Math.hypot(dx, dy)) * offset
        let path = `M ${start.x + ox} ${start.y + oy}`
        if (Math.abs(dx) * Math.abs(dy) === 20000 && Math.abs(dx) + Math.abs(dy) === 300) {
          const bend =
            Math.abs(dx) > Math.abs(dy) ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
          path += ` L ${bend.x + ox} ${bend.y + oy}`
        }
        path += ` L ${end.x + ox} ${end.y + oy}`
        const marker = `${id}-feedback-${i}`
        return (
          <g key={arrow.kind + arrow.uci} opacity="0.9">
            <defs>
              <marker
                id={marker}
                markerUnits="userSpaceOnUse"
                markerWidth="28"
                markerHeight="28"
                refX="24"
                refY="14"
                orient="auto"
              >
                <path d="M 0 0 L 28 14 L 0 28 Z" fill={arrow.color} />
              </marker>
            </defs>
            <path
              data-kind={arrow.kind}
              data-move={arrow.uci}
              d={path}
              stroke={arrow.color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              markerEnd={`url(#${marker})`}
            />
          </g>
        )
      })}
    </svg>
  )
}
