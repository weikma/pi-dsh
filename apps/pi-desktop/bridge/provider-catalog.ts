import type { ProviderInventory, ProviderModel, ProviderSummary } from './provider-types.ts'

/** Presentation catalog; native authentication status is independent of session availability. */
export interface ProviderCatalogEntry extends ProviderSummary {
  models: ProviderModel[]
  modelSource: 'catalog' | 'session'
}

/** Project the active Pi catalog without importing extensions into the settings worker.
 * Session models replace the same provider's static catalog, preserving Pi's registration precedence.
 * Undefined means no open chat; an empty session list means the chat has no available models.
 */
export function providerCatalog(inventory: ProviderInventory | null, sessionModels?: readonly ProviderModel[]): { providers: ProviderCatalogEntry[]; available: readonly ProviderModel[] } {
  const providers = new Map<string, ProviderCatalogEntry>((inventory?.providers ?? []).map(provider => [provider.id, {
    ...provider, models: provider.models ?? inventory?.models.filter(model => model.provider === provider.id) ?? [], modelSource: 'catalog',
  }]))
  const sessionProviders = new Map<string, ProviderModel[]>()
  for (const model of sessionModels ?? []) {
    const models = sessionProviders.get(model.provider) ?? []
    models.push(model); sessionProviders.set(model.provider, models)
  }
  for (const [id, models] of sessionProviders) {
    const provider = providers.get(id) ?? { id, name: id, authTypes: [], authStatus: { configured: false } }
    providers.set(id, { ...provider, models, modelCount: models.length, modelSource: 'session' })
  }
  return { providers: [...providers.values()].sort((a, b) => a.name.localeCompare(b.name)), available: sessionModels ?? inventory?.models ?? [] }
}
