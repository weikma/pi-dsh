import { createContext, useContext } from 'react'
import type { CodeTheme } from './code-themes.ts'

/** Optional owner defaults; standalone primitives retain their existing local controls. */
export interface CodeAppearance {
  theme: CodeTheme
  lineNumbers: boolean
  wrap: boolean
}
const Context = createContext<CodeAppearance | undefined>(undefined)
export const CodeAppearanceProvider = Context.Provider
export function useCodeAppearance(): CodeAppearance | undefined { return useContext(Context) }
