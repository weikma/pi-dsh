import { isJsonObject } from './types.ts'

/** Transient, numeric-only extension status; never added to Pi's model context or history. */
export const CONTEXT_STATUS_KEY = 'pi-desktop:context-v1'
export const CONTEXT_CATEGORIES = ['system', 'tools', 'mcp', 'extensions', 'skills', 'messages', 'results'] as const
export type ContextCategory = typeof CONTEXT_CATEGORIES[number]
export type ContextBreakdown = Record<ContextCategory, number>

/** Accept only finite, nonnegative composition weights from the external Pi process. */
export function readContextBreakdown(text: string | undefined): ContextBreakdown | undefined {
  if (!text || text.length > 2048) return undefined
  let value: unknown
  try { value = JSON.parse(text) }
  catch (error) { void error; return undefined /* Optional extension metadata cannot fail a conversation. */ }
  if (!isJsonObject(value)) return undefined
  const result: ContextBreakdown = { system: 0, tools: 0, mcp: 0, extensions: 0, skills: 0, messages: 0, results: 0 }
  for (const key of CONTEXT_CATEGORIES) {
    const weight = value[key]
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1e12) return undefined
    result[key] = weight
  }
  return result
}
