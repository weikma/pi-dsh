/** Bundled Shiki themes shared by HTML, streaming, and file highlighting. */
import githubLight from 'shiki/themes/github-light.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import lightPlus from 'shiki/themes/light-plus.mjs'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import solarizedLight from 'shiki/themes/solarized-light.mjs'
import solarizedDark from 'shiki/themes/solarized-dark.mjs'
import nord from 'shiki/themes/nord.mjs'
import type { CSSProperties } from 'react'

export const CODE_THEMES = {
  'github-light': githubLight, 'github-dark': githubDark,
  'light-plus': lightPlus, 'dark-plus': darkPlus,
  'solarized-light': solarizedLight, 'solarized-dark': solarizedDark, nord,
}
export type CodeTheme = 'css-variables' | keyof typeof CODE_THEMES

/** Scope foreground, background and gutter colors to a code surface, including its plain fallback. */
export function codeThemeStyle(theme: CodeTheme): CSSProperties | undefined {
  if (theme === 'css-variables') return undefined
  const value = CODE_THEMES[theme]
  const style: CSSProperties & Record<string, string | undefined> = {
    '--dsw-code-background': value.colors?.['editor.background'],
    '--dsw-code-foreground': value.colors?.['editor.foreground'],
    '--dsw-code-gutter': value.colors?.['editorLineNumber.activeForeground'] ?? value.colors?.['editor.foreground'],
  }
  return style
}
