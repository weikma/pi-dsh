import { isJsonObject } from './bridge/types.ts'

/** GUI default for new chats; native sessions retain their own model and thinking level. */
export interface LastModel { provider: string; id: string; name: string; thinkingLevel: string }

/** Validate persisted GUI data without storing provider configuration or credentials. */
export function readLastModel(input: unknown): LastModel | undefined {
  if (input === undefined) return undefined
  if (!isJsonObject(input) || typeof input.provider !== 'string' || !input.provider
    || typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || !input.name
    || typeof input.thinkingLevel !== 'string' || !input.thinkingLevel) throw new Error('GUI lastModel requires a provider, model, name and thinking level')
  return { provider: input.provider, id: input.id, name: input.name, thinkingLevel: input.thinkingLevel }
}
