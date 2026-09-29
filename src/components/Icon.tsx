import type { CSSProperties } from 'react'

const paths = {
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7z" />,
  trophy: (
    <>
      <path d="M8 3h8v5a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3h8m-6-3h4v3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  book: (
    <>
      <path d="M12 5C8 2 4 3 3 4v15c4-2 7 0 9 1 2-1 5-3 9-1V4c-1-1-5-2-9 1v15" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />,
  knight: <path d="M7 21h13l-1-4c3-8-1-13-8-13l-2-2-1 5-5 6 2 3 5-2-3 7m4-13h.01" />,
  flag: <path d="M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0" />,
  puzzle: (
    <path d="M4 4h5a3 3 0 1 1 6 0h5v5a3 3 0 1 0 0 6v5h-5a3 3 0 1 0-6 0H4v-5a3 3 0 1 0 0-6z" />
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6M7 10h6m-3-3v6" />
    </>
  ),
  flame: <path d="M13 2c1 6-5 6-3 11 2 0 4-2 4-4 5 4 6 7 3 10-4 5-12 1-12-4 0-5 5-7 8-13z" />,
  shield: <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6" />,
  crown: <path d="m3 6 5 5 4-8 4 8 5-5-2 12H5zM6 21h12" />,
} as const

export type IconName = keyof typeof paths
export default function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName
  size?: number
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
    >
      {paths[name]}
    </svg>
  )
}
