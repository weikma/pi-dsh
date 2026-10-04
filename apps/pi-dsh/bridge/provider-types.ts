/** Secret-free authentication values projected by the external selected-Pi worker. */
export type ProviderAuthType = 'api_key' | 'oauth'

/** Provider methods that the selected public SDK can invoke interactively. */
export interface ProviderSummary {
  id: string
  name: string
  authTypes: ProviderAuthType[]
  authStatus: { configured: boolean; source?: string; label?: string }
  modelCount: number
  /** Full native catalog, including models whose provider is not authenticated. */
  models?: ProviderModel[]
}

/** Known catalog model; availability remains owned by Pi. */
export interface ProviderModel {
  id: string; provider: string; name: string
  /** Pi catalog capabilities and native default, available before a session starts. */
  thinkingLevels?: string[]
  thinkingLevel?: string
}

/** Public-SDK inventory excludes secrets and reports unsupported extension discovery. */
export interface ProviderInventory {
  agentDir: string
  sdkVersion: string
  defaultModel?: ProviderModel
  providers: ProviderSummary[]
  models: ProviderModel[]
  extensionProvidersSupported: false
  limitations: string[]
  limitationCodes?: ('extension_providers' | 'api_key_override')[]
}

/** An individual login input; each prompt can be cancelled independently of the login. */
export interface ProviderAuthPrompt {
  id: string
  type: 'text' | 'secret' | 'select' | 'manual_code'
  message: string
  placeholder?: string
  options?: { id: string; label: string; description?: string }[]
}

/** Safe provider-owned progress and browser/device instructions. */
export type ProviderAuthNotification =
  | { type: 'info'; message: string; links?: { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: 'progress'; message: string }

/** Worker login events; response completion belongs to the request's promise. */
export type ProviderAuthEvent =
  | { type: 'provider_auth'; operationId: string; event: 'prompt'; prompt: ProviderAuthPrompt }
  | { type: 'provider_auth'; operationId: string; event: 'prompt_cancelled'; promptId: string }
  | { type: 'provider_auth'; operationId: string; event: 'notify'; notification: ProviderAuthNotification }

/** Non-secret compatible-endpoint fields written into Pi's models.json. */
export interface CustomProvider {
  providerId: string
  name?: string
  baseUrl: string
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
  models: { id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean }[]
}

/** Requests sent over the worker's LF-delimited JSON transport. */
export type ProviderWorkerCommand =
  | { type: 'get_state' }
  | { type: 'init'; sdkEntry: string; cliArgs: string[]; cwd: string; agentDir?: string }
  | { type: 'inventory' }
  | { type: 'agent_configuration' }
  | ({ type: 'update_agent_configuration' } & import('./types.ts').JsonObject)
  | { type: 'login'; operationId: string; providerId: string; authType: ProviderAuthType }
  | { type: 'reply'; operationId: string; promptId: string; value: string }
  | { type: 'cancel'; operationId: string }
  | { type: 'logout'; providerId: string }
  | ({ type: 'add_custom_provider' } & CustomProvider)
