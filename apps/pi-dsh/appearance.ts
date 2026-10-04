/** GUI-owned typography preferences; shared by the Host validator and settings controls. */
export const LIGHT_CODE_THEMES = ['css-variables', 'github-light', 'light-plus', 'solarized-light'] as const
export const DARK_CODE_THEMES = ['css-variables', 'github-dark', 'dark-plus', 'solarized-dark', 'nord'] as const
export const UI_FONT_RANGE = { min: 12, max: 20 } as const
export const CODE_FONT_RANGE = { min: 10, max: 24 } as const

export interface TextAppearance {
  uiFontSize: number
  codeFontSize: number
  lightCodeTheme: typeof LIGHT_CODE_THEMES[number]
  darkCodeTheme: typeof DARK_CODE_THEMES[number]
  codeLineNumbers: boolean
  codeWrapLines: boolean
}

export const DEFAULT_TEXT_APPEARANCE: TextAppearance = {
  uiFontSize: 14, codeFontSize: 12,
  lightCodeTheme: 'css-variables', darkCodeTheme: 'css-variables',
  codeLineNumbers: true, codeWrapLines: false,
}

/** Validate a partial wire/durable preference record; omitted fields retain existing values. */
export function readTextAppearance(input: Record<string, unknown>): Partial<TextAppearance> {
  const result: Partial<TextAppearance> = {}
  for (const [key, range] of [['uiFontSize', UI_FONT_RANGE], ['codeFontSize', CODE_FONT_RANGE]] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
      throw new Error(`GUI ${key} must be a whole number from ${range.min} to ${range.max}`)
    }
    result[key] = value
  }
  for (const key of ['codeLineNumbers', 'codeWrapLines'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw new Error(`GUI ${key} must be a boolean`)
    result[key] = value
  }
  if (input.lightCodeTheme !== undefined) {
    const theme = LIGHT_CODE_THEMES.find(value => value === input.lightCodeTheme)
    if (theme === undefined) throw new Error('Unsupported light code theme')
    result.lightCodeTheme = theme
  }
  if (input.darkCodeTheme !== undefined) {
    const theme = DARK_CODE_THEMES.find(value => value === input.darkCodeTheme)
    if (theme === undefined) throw new Error('Unsupported dark code theme')
    result.darkCodeTheme = theme
  }
  return result
}
