/** Authentication runs under the selected external Node and Pi public SDK, outside the GUI. */
import { randomUUID } from 'node:crypto'
import { AgentConfiguration } from './agent-configuration.ts'
import { runPackageOperation } from './package-operation.ts'
import { lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isJsonObject, type JsonObject } from '../bridge/types.ts'
import type { CustomProvider, ProviderAuthEvent, ProviderAuthNotification, ProviderAuthPrompt, ProviderAuthType, ProviderInventory, ProviderModel } from '../bridge/provider-types.ts'

interface NativePrompt {
  type: ProviderAuthPrompt['type']; message: string; placeholder?: string
  options?: readonly { id: string; label: string; description?: string }[]
  signal?: AbortSignal
}
interface NativeModel { id: string; provider: string; name?: string; reasoning?: boolean; thinkingLevelMap?: Record<string, unknown> }
interface NativeProvider {
  id: string; name: string
  auth: { apiKey?: { login?: (...args: never[]) => unknown }; oauth?: { login?: (...args: never[]) => unknown } }
  getModels(): readonly NativeModel[]
}
interface NativeRuntime {
  getProviders(): readonly NativeProvider[]
  getProvider(id: string): NativeProvider | undefined
  getModels(): readonly NativeModel[]
  getModel(provider: string, modelId: string): NativeModel | undefined
  getAvailableSnapshot(): readonly NativeModel[]
  getProviderAuthStatus(id: string): { configured: boolean; source?: string; label?: string }
  getError(): string | undefined
  refresh(options: { allowNetwork: false }): Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }>
  login(id: string, type: ProviderAuthType, interaction: { signal: AbortSignal; prompt(prompt: NativePrompt): Promise<string>; notify(event: ProviderAuthNotification): void }, options: { getDeviceId(): string }): Promise<unknown>
  logout(id: string, options: { signal: AbortSignal }): Promise<void>
  setRuntimeApiKey(id: string, value: string): Promise<void>
}
interface NativeSettings { getDefaultProvider(): string | undefined; getDefaultModel(): string | undefined; getDefaultThinkingLevel?(): string | undefined; getModelThinkingLevel?(provider: string, model: string): string | undefined; getEnabledModels?(): string[] | undefined; getOrCreateDeviceId(): string; reload?(): Promise<void> }
interface NativeArgs { thinking?: string; provider?: string; model?: string; models?: string[]; apiKey?: string; session?: string; continue?: boolean; resume?: boolean; fork?: string; extensions?: string[]; noExtensions?: boolean; diagnostics?: { type: string }[] }
interface PublicSDK {
  VERSION: string
  getAgentDir(): string
  parseArgs(args: string[]): NativeArgs
  resolveCliModel(options: { cliProvider?: string; cliModel?: string; modelRuntime: NativeRuntime }): { model?: NativeModel; error?: string }
  resolveModelScopeWithDiagnostics?(patterns: string[], modelRuntime: NativeRuntime): Promise<{ scopedModels: readonly { model: NativeModel }[] }>
  ModelRuntime: { create(options: { authPath: string; modelsPath: string; allowModelNetwork: false; refreshOnCreate?: boolean; signal?: AbortSignal }): Promise<NativeRuntime> }
  SettingsManager: { create(cwd: string, agentDir: string): NativeSettings }
}
interface LoginOperation { controller: AbortController; promise: Promise<void> }
interface PendingPrompt { operationId: string; type: NativePrompt['type']; resolve(value: string): void; reject(reason: Error): void }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function publicSDK(value: unknown): value is PublicSDK {
  return record(value) && typeof value.VERSION === 'string' && typeof value.getAgentDir === 'function'
    && typeof value.parseArgs === 'function' && typeof value.resolveCliModel === 'function'
    && (record(value.ModelRuntime) || typeof value.ModelRuntime === 'function') && 'create' in value.ModelRuntime && typeof value.ModelRuntime.create === 'function'
    && (record(value.SettingsManager) || typeof value.SettingsManager === 'function') && 'create' in value.SettingsManager && typeof value.SettingsManager.create === 'function'
}
/** Pi 0.99.1 exposes model thinking constraints through public catalog metadata.
 * The real-RPC regression pins this projection; active sessions always use RPC levels.
 */
function model(value: NativeModel, settings?: NativeSettings, thinking?: string): ProviderModel {
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const thinkingLevels = value.reasoning ? levels.filter(level => value.thinkingLevelMap?.[level] !== null
    && (!['xhigh', 'max'].includes(level) || value.thinkingLevelMap?.[level] !== undefined)) : ['off']
  const requested = thinking ?? settings?.getModelThinkingLevel?.(value.provider, value.id) ?? settings?.getDefaultThinkingLevel?.() ?? 'medium'
  const index = levels.indexOf(requested)
  const thinkingLevel = thinkingLevels.includes(requested) ? requested
    : levels.slice(Math.max(0, index)).find(level => thinkingLevels.includes(level)) ?? [...thinkingLevels].reverse()[0] ?? 'off'
  return { id: value.id, provider: value.provider, name: value.name ?? value.id, thinkingLevels, thinkingLevel }
}
function text(input: JsonObject, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error('Provider request requires ' + key)
  return value
}
function cancelled(): Error { return new DOMException('Pi authentication cancelled', 'AbortError') }
function jsonConfiguration(source: string): JsonObject {
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('Pi models.json is invalid JSON; repair it with native Pi setup') }
  if (!isJsonObject(value)) throw new Error('Pi models.json must contain an object')
  return value
}
async function modelsDestination(path: string): Promise<string> {
  for (let count = 0; count < 32; count++) {
    try { return await realpath(path) }
    catch (error) { if (!record(error) || error.code !== 'ENOENT') throw new Error('Pi models.json is inaccessible') }
    try {
      if (!(await lstat(path)).isSymbolicLink()) return path
      path = resolve(dirname(path), await readlink(path))
    } catch (error) {
      if (record(error) && error.code === 'ENOENT') return path
      throw new Error('Pi models.json is inaccessible')
    }
  }
  throw new Error('Pi models.json contains an unresolved symbolic link')
}

/** The private worker owns login callbacks, never a GUI credential store. */
class ProviderWorker {
  private configuration: AgentConfiguration | undefined
  private configurationContext: { sdk: unknown; sdkEntry: string; cwd: string; agentDir: string } | undefined
  private packageAbort = new AbortController()
  private sdk: PublicSDK | undefined
  private runtime: NativeRuntime | undefined
  private settings: NativeSettings | undefined
  private requestedModel: NativeModel | undefined
  private args: NativeArgs = {}
  private agentDir = ''
  private closing = false
  private operations = new Map<string, LoginOperation>()
  private prompts = new Map<string, PendingPrompt>()
  private writes = Promise.resolve()
  private secrets = new Set<string>()

  constructor(private readonly publish: (event: ProviderAuthEvent) => void) {}

  async request(input: JsonObject): Promise<unknown> {
    if (this.closing) throw new Error('Pi provider worker is stopping')
    if (input.type === 'get_state') return { ready: true }
    if (input.type === 'init') return this.initialize(input)
    const runtime = this.requireRuntime()
    switch (input.type) {
      case 'inventory': return this.inventory()
      case 'agent_configuration':
      case 'update_agent_configuration': {
        const context = this.configurationContext
        if (!context) throw new Error('Pi configuration is unavailable')
        this.configuration ??= new AgentConfiguration(context.sdk, context.cwd, context.agentDir)
        const configuration = this.configuration
        const operation = this.writes.then(async () => {
          if (input.action === 'package') { await runPackageOperation(context, input, this.packageAbort.signal); return configuration.view() }
          return input.type === 'agent_configuration' ? configuration.view() : configuration.update(input)
        })
        this.writes = operation.then(() => {}, error => { void error /* The request owns the error; subsequent setup can retry. */ })
        return operation
      }
      case 'login': return this.login(input)
      case 'reply': {
        const promptId = text(input, 'promptId'), operationId = text(input, 'operationId')
        const prompt = this.prompts.get(promptId)
        if (!prompt || prompt.operationId !== operationId || typeof input.value !== 'string') throw new Error('Pi authentication prompt is no longer pending')
        if (prompt.type === 'secret' || prompt.type === 'manual_code') this.secrets.add(input.value)
        prompt.resolve(input.value)
        return null
      }
      case 'cancel': {
        const operation = this.operations.get(text(input, 'operationId'))
        if (operation) { operation.controller.abort(cancelled()); await Promise.allSettled([operation.promise]) }
        return null
      }
      case 'logout': {
        const providerId = text(input, 'providerId')
        if (this.operations.size > 0) throw new Error('Finish or cancel Pi login before signing out')
        await runtime.logout(providerId, { signal: new AbortController().signal })
        return this.inventory()
      }
      case 'add_custom_provider': return this.addProvider(input)
      default: throw new Error('Unsupported Pi provider request')
    }
  }

  private requireRuntime(): NativeRuntime {
    if (!this.runtime) throw new Error('Initialize the selected Pi public SDK first')
    return this.runtime
  }

  private async initialize(input: JsonObject): Promise<ProviderInventory> {
    if (this.sdk) throw new Error('Pi provider worker is already initialized')
    const sdkEntry = text(input, 'sdkEntry')
    const url = sdkEntry.startsWith('file:') ? new URL(sdkEntry) : pathToFileURL(resolve(sdkEntry))
    if (url.protocol !== 'file:') throw new Error('Selected Pi SDK entry must be a local public package export')
    let loaded: unknown
    try { loaded = await import(url.href) }
    catch { throw new Error('Selected Pi public SDK could not load; use native Pi setup') }
    if (!publicSDK(loaded)) throw new Error('Selected Pi does not expose the supported public authentication SDK; use native Pi setup')
    if (!Array.isArray(input.cliArgs) || !input.cliArgs.every((arg): arg is string => typeof arg === 'string')) throw new Error('Selected Pi arguments must be strings')
    const cwd = resolve(text(input, 'cwd'))
    if (!(await stat(cwd)).isDirectory()) throw new Error('Pi provider working directory must be a directory')
    if (input.agentDir !== undefined) process.env.PI_CODING_AGENT_DIR = text(input, 'agentDir')
    const agentDir = loaded.getAgentDir()
    this.args = loaded.parseArgs(input.cliArgs)
    if (this.args.diagnostics?.some(diagnostic => diagnostic.type === 'error')) throw new Error('Selected Pi arguments are invalid; use native Pi setup')
    if (this.args.apiKey) this.secrets.add(this.args.apiKey)
    let runtime: NativeRuntime
    try { runtime = await loaded.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false }) }
    catch { throw new Error('Selected Pi authentication configuration could not load; repair native auth/models configuration') }
    for (const method of ['getProviders', 'getProvider', 'getModels', 'getModel', 'getAvailableSnapshot', 'getProviderAuthStatus', 'getError', 'refresh', 'login', 'logout', 'setRuntimeApiKey'] as const) {
      if (typeof runtime[method] !== 'function') throw new Error('Selected Pi authentication SDK is incompatible; use native Pi setup')
    }
    this.settings = loaded.SettingsManager.create(cwd, agentDir)
    this.sdk = loaded; this.runtime = runtime; this.agentDir = agentDir
    this.configurationContext = { sdk: loaded, sdkEntry: url.href, cwd, agentDir }
    this.requestedModel = await this.resolveRequestedModel(Boolean(this.args.apiKey))
    if (this.args.apiKey && this.requestedModel) await runtime.setRuntimeApiKey(this.requestedModel.provider, this.args.apiKey)
    return this.inventory()
  }

  private async resolveRequestedModel(requireKeyModel: boolean): Promise<NativeModel | undefined> {
    const runtime = this.requireRuntime()
    if (this.args.model) {
      const selected = this.sdk?.resolveCliModel({ cliProvider: this.args.provider, cliModel: this.args.model, modelRuntime: runtime })
      if (selected?.model) return selected.model
    } else {
      const patterns = this.args.models ?? this.settings?.getEnabledModels?.()
      if (patterns?.length) {
        if (this.args.session || this.args.continue || this.args.resume || this.args.fork) {
          if (requireKeyModel) throw new Error('Selected --api-key model scope depends on a resumed session; use native Pi setup')
          return undefined
        }
        if (typeof this.sdk?.resolveModelScopeWithDiagnostics !== 'function') {
          if (requireKeyModel) throw new Error('Selected Pi has no supported public model-scope resolver; use native Pi setup')
          return undefined
        }
        const { scopedModels } = await this.sdk.resolveModelScopeWithDiagnostics(patterns, runtime)
        const provider = this.settings?.getDefaultProvider(), id = this.settings?.getDefaultModel()
        const saved = scopedModels.find(item => item.model.provider === provider && item.model.id === id)
        if (saved || scopedModels[0]) return (saved ?? scopedModels[0])?.model
      }
    }
    if (requireKeyModel) throw new Error('Selected --api-key requires --model or a resolvable model scope; use native Pi setup')
    return undefined
  }

  private defaultModel(): NativeModel | undefined {
    const runtime = this.requireRuntime(), settings = this.settings
    if (this.requestedModel) return runtime.getModel(this.requestedModel.provider, this.requestedModel.id)
    if (this.args.model || this.args.models?.length || settings?.getEnabledModels?.()?.length) return undefined
    const provider = settings?.getDefaultProvider(), id = settings?.getDefaultModel()
    return provider && id ? runtime.getAvailableSnapshot().find(model => model.provider === provider && model.id === id) : undefined
  }

  private async inventory(): Promise<ProviderInventory> {
    const runtime = this.requireRuntime()
    await this.settings?.reload?.()
    try { await runtime.refresh({ allowNetwork: false }) }
    catch { throw new Error('Pi provider configuration could not refresh; repair native auth/models configuration') }
    if (runtime.getError()) throw new Error('Pi provider configuration could not load; repair models.json with native Pi setup')
    this.requestedModel ??= await this.resolveRequestedModel(false)
    const defaultModel = this.defaultModel()
    const projectModel = (value: NativeModel) => model(value, this.settings, this.args.thinking)
    return {
      agentDir: this.agentDir, sdkVersion: this.sdk?.VERSION ?? '',
      ...(defaultModel ? { defaultModel: projectModel(defaultModel) } : {}),
      providers: runtime.getProviders().map(provider => {
        const models = provider.getModels().map(projectModel)
        const status = runtime.getProviderAuthStatus(provider.id)
        const source = typeof status.source === 'string' && ['runtime', 'stored', 'environment', 'models_json_command', 'models_json_key', 'fallback'].includes(status.source) ? status.source : undefined
        const label = typeof status.label === 'string' && /^[A-Z_][A-Z0-9_]*(?:, [A-Z_][A-Z0-9_]*)*$/u.test(status.label) ? this.safeText(status.label) : undefined
        return {
          id: provider.id, name: provider.name,
          authTypes: [...(typeof provider.auth.apiKey?.login === 'function' ? ['api_key' as const] : []), ...(typeof provider.auth.oauth?.login === 'function' ? ['oauth' as const] : [])],
          authStatus: { configured: status.configured, ...(source === undefined ? {} : { source }), ...(label === undefined ? {} : { label }) }, modelCount: models.length, models,
        }
      }).sort((a, b) => a.name.localeCompare(b.name)),
      models: runtime.getAvailableSnapshot().map(projectModel), extensionProvidersSupported: false,
      limitationCodes: ['extension_providers', ...(this.args.apiKey ? ['api_key_override' as const] : [])],
      limitations: ['Provider extensions and project-specific registrations are managed by native Pi setup.', ...(this.args.apiKey ? ['The selected --api-key overrides stored credentials for its provider.'] : [])],
    }
  }

  private login(input: JsonObject): Promise<void> {
    const operationId = text(input, 'operationId'), providerId = text(input, 'providerId')
    if (input.authType !== 'api_key' && input.authType !== 'oauth') throw new Error('Unsupported Pi authentication method')
    if (this.operations.size > 0) throw new Error('Finish or cancel the current Pi login first')
    const runtime = this.requireRuntime(), provider = runtime.getProvider(providerId)
    const method = input.authType === 'oauth' ? provider?.auth.oauth : provider?.auth.apiKey
    if (typeof method?.login !== 'function') throw new Error('Selected provider requires native Pi setup for this authentication method')
    const controller = new AbortController()
    const promise = Promise.resolve().then(async () => {
      try {
        await runtime.login(providerId, input.authType === 'oauth' ? 'oauth' : 'api_key', {
          signal: controller.signal,
          prompt: prompt => this.prompt(operationId, prompt, controller.signal),
          notify: notification => { this.publish({ type: 'provider_auth', operationId, event: 'notify', notification: this.notification(notification) }) },
        }, { getDeviceId: () => {
          if (!this.settings) throw new Error('Pi settings are unavailable')
          return this.settings.getOrCreateDeviceId()
        } })
      } catch (error) {
        if (record(error) && error.name === 'CredentialSynchronizationError') throw new Error('Pi credential was saved, but model refresh failed; refresh models or reopen the session')
        if (controller.signal.aborted) throw cancelled()
        throw new Error('Pi provider login failed; retry or use native Pi setup')
      } finally { this.operations.delete(operationId) }
    })
    this.operations.set(operationId, { controller, promise })
    return promise
  }

  private prompt(operationId: string, input: NativePrompt, operationSignal: AbortSignal): Promise<string> {
    const id = randomUUID()
    const signal = input.signal ? AbortSignal.any([operationSignal, input.signal]) : operationSignal
    if (signal.aborted) return Promise.reject(cancelled())
    return new Promise((resolvePrompt, rejectPrompt) => {
      const finish = (): void => { this.prompts.delete(id); signal.removeEventListener('abort', onAbort) }
      const onAbort = (): void => {
        finish(); this.publish({ type: 'provider_auth', operationId, event: 'prompt_cancelled', promptId: id }); rejectPrompt(cancelled())
      }
      this.prompts.set(id, { operationId, type: input.type, resolve: value => { finish(); resolvePrompt(value) }, reject: reason => { finish(); rejectPrompt(reason) } })
      signal.addEventListener('abort', onAbort, { once: true })
      this.publish({ type: 'provider_auth', operationId, event: 'prompt', prompt: {
        id, type: input.type, message: this.safeText(input.message),
        ...(input.placeholder === undefined ? {} : { placeholder: this.safeText(input.placeholder) }),
        ...(input.options === undefined ? {} : { options: input.options.map(option => ({ id: this.safeText(option.id), label: this.safeText(option.label), ...(option.description === undefined ? {} : { description: this.safeText(option.description) }) })) }),
      } })
    })
  }

  private addProvider(input: JsonObject): Promise<ProviderInventory> {
    if (this.operations.size > 0) return Promise.reject(new Error('Finish or cancel Pi login before changing providers'))
    const providerId = text(input, 'providerId'), baseUrl = text(input, 'baseUrl')
    if (input.name !== undefined && typeof input.name !== 'string') throw new Error('Provider name must be text')
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(providerId) || ['__proto__', 'constructor', 'prototype'].includes(providerId)) throw new Error('Provider ID must use lowercase letters, digits, dots, underscores or hyphens and cannot be a reserved property')
    let endpoint: URL
    try { endpoint = new URL(baseUrl) } catch { throw new Error('Provider endpoint must be an HTTP or HTTPS URL') }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Provider endpoint must be an HTTP or HTTPS base URL without embedded credentials or URL parameters')
    const api = input.api ?? 'openai-completions'
    if (!['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(String(api))) throw new Error('Unsupported compatible provider API')
    if (!Array.isArray(input.models) || input.models.length === 0 || !input.models.every(isJsonObject)) throw new Error('Compatible provider requires models')
    const models: CustomProvider['models'] = input.models.map(item => {
      const id = text(item, 'id')
      if (item.name !== undefined && typeof item.name !== 'string') throw new Error('Model name must be text')
      for (const field of ['contextWindow', 'maxTokens'] as const) if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] <= 0 || !Number.isFinite(item[field]))) throw new Error('Model limits must be positive numbers')
      if (item.reasoning !== undefined && typeof item.reasoning !== 'boolean') throw new Error('Model reasoning must be a boolean')
      return { id, ...(typeof item.name === 'string' ? { name: item.name } : {}), ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}), ...(typeof item.maxTokens === 'number' ? { maxTokens: item.maxTokens } : {}), ...(typeof item.reasoning === 'boolean' ? { reasoning: item.reasoning } : {}) }
    })
    if (new Set(models.map(item => item.id)).size !== models.length) throw new Error('Compatible provider model IDs must be unique')
    const operation = this.writes.then(async () => {
      const logicalPath = join(this.agentDir, 'models.json')
      const path = await modelsDestination(logicalPath)
      let source = ''
      try { source = await readFile(path, 'utf8') }
      catch (error) { if (!record(error) || error.code !== 'ENOENT') throw error }
      const data = source ? jsonConfiguration(source) : {}
      if (!isJsonObject(data) || (data.providers !== undefined && !isJsonObject(data.providers))) throw new Error('Pi models.json must contain a providers object')
      const providers = isJsonObject(data.providers) ? data.providers : {}
      const existing = providers[providerId]
      if (existing !== undefined && !isJsonObject(existing)) throw new Error('Existing Pi provider configuration is invalid')
      const previous = isJsonObject(existing) ? existing : {}
      const previousModels = Array.isArray(previous.models) && previous.models.every(isJsonObject) ? previous.models : []
      const remaining = previousModels.filter(item => !models.some(model => item.id === model.id))
      const merged = models.map(item => ({ ...previousModels.find(previous => previous.id === item.id), ...item }))
      const provider = { ...previous, ...(typeof input.name === 'string' ? { name: input.name } : {}), baseUrl, api, models: [...remaining, ...merged] }
      const next = { ...data, providers: { ...providers, [providerId]: provider } }
      await mkdir(this.agentDir, { recursive: true, mode: 0o700 })
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
        if (!this.sdk) throw new Error('Pi public SDK is unavailable')
        let validation: NativeRuntime
        try { validation = await this.sdk.ModelRuntime.create({ authPath: join(this.agentDir, 'auth.json'), modelsPath: temporary, allowModelNetwork: false, refreshOnCreate: false }) }
        catch { throw new Error('Pi rejected this compatible provider configuration') }
        if (validation.getError()) throw new Error('Pi rejected this compatible provider configuration')
        let current = ''
        try { current = await readFile(path, 'utf8') } catch (error) { if (!record(error) || error.code !== 'ENOENT') throw error }
        if (current !== source || await modelsDestination(logicalPath) !== path) throw new Error('Pi models.json changed during setup; retry provider configuration')
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      return this.inventory()
    })
    this.writes = operation.then(() => {}, () => {})
    return operation
  }

  private safeText(message: string): string {
    for (const secret of this.secrets) if (secret) {
      message = message.replaceAll(secret, '[redacted]')
      message = message.replaceAll(encodeURIComponent(secret), '[redacted]')
    }
    return message
  }

  private notification(event: ProviderAuthNotification): ProviderAuthNotification {
    switch (event.type) {
      case 'auth_url': return { type: event.type, url: this.safeText(event.url), ...(event.instructions === undefined ? {} : { instructions: this.safeText(event.instructions) }) }
      case 'device_code': return { type: event.type, userCode: this.safeText(event.userCode), verificationUri: this.safeText(event.verificationUri), ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }), ...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }) }
      case 'info': return { type: event.type, message: this.safeText(event.message), ...(event.links === undefined ? {} : { links: event.links.map(link => ({ url: this.safeText(link.url), ...(link.label === undefined ? {} : { label: this.safeText(link.label) }) })) }) }
      case 'progress': return { type: event.type, message: this.safeText(event.message) }
    }
  }

  error(error: unknown): string {
    return this.safeText(error instanceof Error ? error.message : 'Pi provider operation failed')
  }

  async close(): Promise<void> {
    this.closing = true
    this.packageAbort.abort()
    for (const operation of this.operations.values()) operation.controller.abort(cancelled())
    for (const prompt of this.prompts.values()) prompt.reject(cancelled())
    await Promise.allSettled([...this.operations.values()].map(operation => operation.promise))
    await this.writes
  }
}

/** Run the LF-only JSON worker; stdin EOF cancels authentication and waits for owned work.
 * @returns Completion after stdin ends and all requests and login tasks settle.
 */
export async function runProviderWorker(): Promise<void> {
  const output = (value: unknown): void => { process.stdout.write(JSON.stringify(value) + '\n') }
  const worker = new ProviderWorker(output)
  const pending = new Set<Promise<void>>()
  let buffer = ''
  const dispatch = (line: string): void => {
    let input: unknown
    try { input = JSON.parse(line) } catch { output({ type: 'response', success: false, error: 'Invalid provider JSON' }); return }
    if (!isJsonObject(input) || typeof input.id !== 'string' || typeof input.type !== 'string') { output({ type: 'response', success: false, error: 'Provider request requires id and type' }); return }
    const id = input.id, command = input.type
    const task = worker.request(input).then(data => { output({ type: 'response', id, command, success: true, data }) }, error => { output({ type: 'response', id, command, success: false, error: worker.error(error) }) })
    pending.add(task); void task.finally(() => { pending.delete(task) })
  }
  process.stdin.setEncoding('utf8')
  try {
    for await (const chunk of process.stdin) {
      buffer += String(chunk)
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) throw new Error('Provider JSON exceeds transport limit')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '')
        buffer = buffer.slice(newline + 1)
        if (line.trim()) dispatch(line)
        newline = buffer.indexOf('\n')
      }
    }
  } finally { await worker.close(); await Promise.allSettled(pending) }
}

const invoked = process.argv[1] === undefined ? undefined : await realpath(resolve(process.argv[1])).catch(() => undefined)
if (invoked === await realpath(fileURLToPath(import.meta.url))) {
  void runProviderWorker().catch(() => { process.stderr.write('Pi provider worker failed\n'); process.exitCode = 1 })
}
