import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
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
      onAnimationEnd={
        fade
          ? (event) => {
              if (
                event.target === event.currentTarget &&
                event.animationName === 'move-arrows-fade'
              )
                setExpired(true)
            }
          : undefined
      }
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
        let finalStart = start
        if (Math.abs(dx) * Math.abs(dy) === 20000 && Math.abs(dx) + Math.abs(dy) === 300) {
          const bend =
            Math.abs(dx) > Math.abs(dy) ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
          path += ` L ${bend.x + ox} ${bend.y + oy}`
          finalStart = bend
        }
        // Stop every shaft layer inside the head, including its rounded cap.
        const headLength = 24
        const finalDx = end.x - finalStart.x,
          finalDy = end.y - finalStart.y,
          finalLength = Math.hypot(finalDx, finalDy)
        path += ` L ${end.x + ox - (finalDx / finalLength) * headLength} ${end.y + oy - (finalDy / finalLength) * headLength}`
        const marker = `${id}-feedback-${i}`
        return (
          <g
            key={arrow.kind + arrow.uci}
            className="feedback-arrow-entrance"
            style={{ '--arrow-color': arrow.color } as CSSProperties}
          >
            <defs>
              <marker
                id={marker}
                markerUnits="userSpaceOnUse"
                markerWidth="44"
                markerHeight="44"
                refX={39 - headLength}
                refY="22"
                orient="auto"
              >
                <path
                  d="M 4 4 L 39 22 L 4 40 L 11 22 Z"
                  fill={arrow.color}
                  stroke="#102017"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                <path d="M 8 8 L 34 22 L 13 18 Z" fill="#ffffff" opacity="0.42" />
              </marker>
            </defs>
            {/* Dark edging keeps the beam legible over every board palette and piece. */}
            <path
              d={path}
              className="feedback-arrow-draw"
              pathLength="1"
              stroke="#102017"
              strokeWidth="22"
              strokeOpacity="0.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              data-kind={arrow.kind}
              data-move={arrow.uci}
              d={path}
              className="feedback-arrow-draw feedback-arrow-beam"
              pathLength="1"
              stroke={arrow.color}
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              markerEnd={`url(#${marker})`}
            />
            <path
              d={path}
              className="feedback-arrow-draw"
              pathLength="1"
              stroke="#ffffff"
              strokeWidth="3"
              strokeOpacity="0.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <circle
              cx={start.x + ox}
              cy={start.y + oy}
              r="12"
              fill="#102017"
              stroke={arrow.color}
              strokeWidth="3"
            />
            <circle cx={start.x + ox} cy={start.y + oy} r="4.5" fill={arrow.color} />
            <circle
              cx={end.x + ox}
              cy={end.y + oy}
              r="25"
              fill="none"
              stroke={arrow.color}
              strokeWidth="2"
              strokeDasharray="7 8"
              opacity="0.7"
            />
            {arrow.kind === 'best' && (
              <g
                className="feedback-best-badge"
                transform={`translate(${Math.min(780, end.x + ox + 29)} ${Math.max(20, end.y + oy - 29)})`}
              >
                <path
                  d="M 0 -15 L 13 -7.5 L 13 7.5 L 0 15 L -13 7.5 L -13 -7.5 Z"
                  fill="#102017"
                  stroke={arrow.color}
                  strokeWidth="2.5"
                />
                <path
                  d="M 0 -9 L 2.5 -2.5 L 9 0 L 2.5 2.5 L 0 9 L -2.5 2.5 L -9 0 L -2.5 -2.5 Z"
                  fill={arrow.color}
                />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
