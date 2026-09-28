export interface PlayerSettings {
  promotion: 'q' | 'r' | 'b' | 'n'
  moveFeedback: boolean
  sound: boolean
  premoves: boolean
  confirmResignation: boolean
  boardTheme: 'green' | 'walnut' | 'blue'
  pieceStyle: 'classic' | 'modern'
}

export const SETTINGS_KEY = 'evaluchess.settings.v1'
export const DEFAULT_SETTINGS: PlayerSettings = {
  promotion: 'q',
  moveFeedback: true,
  sound: false,
  premoves: true,
  confirmResignation: true,
  boardTheme: 'green',
  pieceStyle: 'classic',
}

export function readSettings(): PlayerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    const settings = { ...DEFAULT_SETTINGS }
    for (const key of ['moveFeedback', 'sound', 'premoves', 'confirmResignation'] as const) {
      if (typeof saved?.[key] === 'boolean') settings[key] = saved[key]
    }
    if (['q', 'r', 'b', 'n'].includes(saved?.promotion)) settings.promotion = saved.promotion
    if (['green', 'walnut', 'blue'].includes(saved?.boardTheme))
      settings.boardTheme = saved.boardTheme
    if (['classic', 'modern'].includes(saved?.pieceStyle)) settings.pieceStyle = saved.pieceStyle
    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
