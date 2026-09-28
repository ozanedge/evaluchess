import type { PieceRenderObject } from 'react-chessboard'
import type { PlayerSettings } from '../lib/settings'

const palettes = {
  green: { dark: '#6b8c5a', light: '#eaded0' },
  walnut: { dark: '#987252', light: '#f0dfc2' },
  blue: { dark: '#607e96', light: '#e3eaf0' },
}

// Original, simplified silhouettes; the classic set remains the board library's default.
const shapes = {
  P: (
    <>
      <circle cx="24" cy="13" r="6" />
      <path d="M20 20h8l-1 7 6 10H15l6-10z" />
    </>
  ),
  R: (
    <>
      <path d="M12 8h6v6h4V8h4v6h4V8h6v13l-6 4 2 12H16l2-12-6-4z" />
      <path d="M16 21h16" />
    </>
  ),
  N: (
    <>
      <path d="m16 37 3-10-7 1-3-6 10-11 2-6 5 5c10 1 12 13 8 27z" />
      <path d="m19 12 5 4-7 9m9 1-6 11" />
      <circle cx="23" cy="17" r="1" />
    </>
  ),
  B: (
    <>
      <path d="M24 6c-4 5-10 9-10 15 0 4 4 6 7 7l-6 9h18l-6-9c3-1 7-3 7-7 0-6-6-10-10-15z" />
      <path d="m20 15 7 7M19 28h10" />
    </>
  ),
  Q: (
    <>
      <path d="m12 15 8 7 4-12 4 12 8-7-5 22H17z" />
      <circle cx="11" cy="12" r="3" />
      <circle cx="24" cy="8" r="3" />
      <circle cx="37" cy="12" r="3" />
      <path d="M17 30h14" />
    </>
  ),
  K: (
    <>
      <path d="M24 4v12m-5-7h10" />
      <path d="M24 18c-12-8-16 3-7 11l-1 8h16l-1-8c9-8 5-19-7-11z" />
      <path d="M18 29h12" />
    </>
  ),
}

const modernPieces: PieceRenderObject = Object.fromEntries(
  ['w', 'b'].flatMap((color) =>
    Object.entries(shapes).map(([type, shape]) => [
      color + type,
      () => (
        <svg
          data-piece-style="modern"
          viewBox="0 0 48 48"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          <g
            fill={color === 'w' ? '#fafaf5' : '#202733'}
            stroke={color === 'w' ? '#202733' : '#f4f4ed'}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            {shape}
            <path d="M14 37h20l3 6H11z" />
          </g>
        </svg>
      ),
    ])
  )
)

export function boardAppearance(settings: PlayerSettings) {
  const palette = palettes[settings.boardTheme]
  return {
    darkSquareStyle: { backgroundColor: palette.dark },
    lightSquareStyle: { backgroundColor: palette.light },
    pieces: settings.pieceStyle === 'modern' ? modernPieces : undefined,
  }
}
