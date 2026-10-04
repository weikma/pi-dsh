import { isJsonObject } from './types.ts'

/** Session-wide input-token-weighted rate from public Pi stats; input excludes cache reads/writes. */
export function readCacheHitRate(tokens: unknown): number | undefined {
  if (!isJsonObject(tokens)) return undefined
  const { input, cacheRead, cacheWrite } = tokens
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0
    || typeof cacheRead !== 'number' || !Number.isFinite(cacheRead) || cacheRead < 0
    || typeof cacheWrite !== 'number' || !Number.isFinite(cacheWrite) || cacheWrite < 0) return undefined
  const totalInput = input + cacheRead + cacheWrite
  return Number.isFinite(totalInput) && totalInput > 0 ? cacheRead / totalInput : undefined
}
