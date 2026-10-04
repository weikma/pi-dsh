/** Provider management runs in a separate Node process with the selected Pi public SDK. */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { PiProcess } from './process.ts'
import { resolveProviderRuntime } from './provider-runtime.ts'
import { isJsonObject, type PiEvent, type PiRuntime, type JsonObject } from './types.ts'
import type { CustomProvider, ProviderInventory, ProviderAuthType, ProviderWorkerCommand, ProviderModel } from './provider-types.ts'
import type { ProviderAuthAttempt, ProviderAuthPrompt } from './provider-job.ts'

function isProviderModel(value: unknown): value is ProviderModel {
  return isJsonObject(value) && typeof value.id === 'string' && typeof value.provider === 'string' && typeof value.name === 'string'
    && (value.thinkingLevels === undefined || Array.isArray(value.thinkingLevels) && value.thinkingLevels.every(level => typeof level === 'string'))
    && (value.thinkingLevel === undefined || typeof value.thinkingLevel === 'string' && Array.isArray(value.thinkingLevels) && value.thinkingLevels.includes(value.thinkingLevel))
}

function isInventory(value: unknown): value is ProviderInventory {
  if (!isJsonObject(value) || typeof value.agentDir !== 'string' || typeof value.sdkVersion !== 'string'
    || !Array.isArray(value.providers) || !value.providers.every(provider => isJsonObject(provider) && typeof provider.id === 'string'
      && typeof provider.name === 'string' && Array.isArray(provider.authTypes) && provider.authTypes.every(type => type === 'api_key' || type === 'oauth')
      && isJsonObject(provider.authStatus) && typeof provider.authStatus.configured === 'boolean' && typeof provider.modelCount === 'number'
      && (provider.models === undefined || Array.isArray(provider.models) && provider.models.every(model => isProviderModel(model) && model.provider === provider.id) && provider.models.length === provider.modelCount))
    || !Array.isArray(value.models) || !value.models.every(isProviderModel)
    || value.defaultModel !== undefined && !isProviderModel(value.defaultModel)
    || !Array.isArray(value.limitations) || !value.limitations.every(item => typeof item === 'string') || value.extensionProvidersSupported !== false) {
    return false
  }
  return true
}

function inventory(value: unknown): ProviderInventory {
  if (!isInventory(value)) throw new Error('The selected Pi SDK returned an unsupported provider inventory')
  return value
}

function prompt(value: unknown): ProviderAuthPrompt {
  if (!isJsonObject(value) || typeof value.id !== 'string' || typeof value.message !== 'string'
    || (value.type !== 'text' && value.type !== 'secret' && value.type !== 'select' && value.type !== 'manual_code')) throw new Error('Pi returned an unsupported authentication prompt')
  return { id: value.id, type: value.type, message: value.message,
    ...(typeof value.placeholder === 'string' ? { placeholder: value.placeholder } : {}),
    ...(Array.isArray(value.options) ? { options: value.options.flatMap(option => isJsonObject(option) && typeof option.id === 'string' && typeof option.label === 'string'
      ? [{ id: option.id, label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }] : []) } : {}) }
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined }
  catch (error) { void error; return undefined /* An unusable provider link is never opened by the GUI. */ }
}

/** Owned management process and transient, secret-free login interactions. */
export class ProviderGateway {
  private process: PiProcess
  private jobs = new Map<string, ProviderAuthAttempt>()
  private completions = new Map<string, Promise<void>>()
  private cancelling = new Set<string>()
  private listeners = new Set<(attempt: ProviderAuthAttempt) => void>()
  private closed = false
  private unsubscribe: () => void

  private constructor(process: PiProcess) {
    this.process = process
    this.unsubscribe = process.subscribe(event => { this.receive(event) })
  }

  /** Load the selected SDK outside Electron; failed initialization joins its process.
   * @param runtime - Selected official Pi launch configuration.
   * @param worker - Real management-worker file, outside ASAR for packaged applications.
   * @param cwd - Configuration context, defaulting to the user's home directory.
   * @param bundledNode - Optional independent Node interpreter for CLI script selections.
   * @returns Initialized provider management process.
   */
  static async create(runtime: PiRuntime, worker: string, cwd = homedir(), bundledNode?: string): Promise<ProviderGateway> {
    cwd = await realpath(resolve(cwd))
    if (!(await stat(cwd)).isDirectory()) throw new Error('Provider configuration context must be a directory')
    await stat(worker)
    const selected = await resolveProviderRuntime(runtime, bundledNode)
    const environment = Object.fromEntries(Object.entries(selected.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const transport = new PiProcess({ command: selected.command, args: [worker], env: environment, cwd })
    const gateway = new ProviderGateway(transport)
    try {
      await transport.start()
      await gateway.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: selected.cliArgs, cwd,
        ...(selected.agentDir === undefined ? {} : { agentDir: selected.agentDir }) })
      return gateway
    } catch (error) { await gateway.dispose(); throw error }
  }

  private request(command: ProviderWorkerCommand) { return this.process.request({ ...command }) }

  /** Read Pi's current configured provider/model metadata without exposing credentials. */
  async inventory(): Promise<ProviderInventory> { return inventory(await this.request({ type: 'inventory' })) }

  /** Read or edit native configuration through the independently selected SDK worker. */
  async agentConfiguration(input?: JsonObject): Promise<unknown> {
    return this.request(input === undefined ? { type: 'agent_configuration' } : { ...input, type: 'update_agent_configuration' })
  }

  /** Subscribe to complete login state; no input values are published. */
  subscribe(listener: (attempt: ProviderAuthAttempt) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start one provider login, returning immediately while Pi awaits human interaction. */
  startLogin(providerId: string, authType: ProviderAuthType): ProviderAuthAttempt {
    if (this.closed) throw new Error('Provider management is closed')
    if ([...this.jobs.values()].some(job => job.status === 'working' || job.status === 'waiting')) throw new Error('Complete or cancel the current provider login first')
    const attempt: ProviderAuthAttempt = { id: randomUUID(), providerId, authType, status: 'working' }
    this.jobs.set(attempt.id, attempt)
    const completion = this.request({ type: 'login', operationId: attempt.id, providerId, authType }).then(() => {
      this.update(attempt.id, { status: 'complete', prompt: undefined, authUrl: undefined, userCode: undefined })
    }).catch((error: unknown) => {
      this.update(attempt.id, { status: this.cancelling.has(attempt.id) || this.closed ? 'cancelled' : 'error', prompt: undefined, authUrl: undefined, userCode: undefined,
        ...(this.cancelling.has(attempt.id) || this.closed ? {} : { error: error instanceof Error ? error.message : 'Pi provider authentication failed' }) })
    }).finally(() => { this.completions.delete(attempt.id) })
    this.completions.set(attempt.id, completion)
    return structuredClone(attempt)
  }

  /** Read transient state for a login started by this Host. */
  attempt(id: string): ProviderAuthAttempt | undefined {
    const value = this.jobs.get(id)
    return value === undefined ? undefined : structuredClone(value)
  }

  /** Whether quitting would interrupt an owned provider authentication flow. */
  hasActiveLogin(): boolean {
    return [...this.jobs.values()].some(job => job.status === 'working' || job.status === 'waiting')
  }

  /** Answer the currently displayed prompt once; stale replies are refused. */
  async reply(id: string, promptId: string, value: string): Promise<void> {
    const attempt = this.jobs.get(id)
    if (attempt?.status !== 'waiting' || attempt.prompt?.id !== promptId) throw new Error('The Pi authentication prompt is no longer pending')
    await this.request({ type: 'reply', operationId: id, promptId, value })
  }

  /** Cancel and join the provider's login operation before returning. */
  async cancel(id: string): Promise<void> {
    const attempt = this.jobs.get(id)
    if (!attempt) throw new Error('Provider login was not found')
    if (attempt.status !== 'working' && attempt.status !== 'waiting') return
    this.cancelling.add(id)
    try { await this.request({ type: 'cancel', operationId: id }); await this.completions.get(id) }
    finally { this.cancelling.delete(id) }
  }

  /** Delegate credential removal to Pi; environment and compatible endpoint settings remain Pi-owned. */
  async logout(providerId: string): Promise<void> { await this.request({ type: 'logout', providerId }) }

  /** Save non-secret compatible endpoint fields using the selected runtime's configuration format. */
  async addProvider(provider: CustomProvider): Promise<void> { await this.request({ type: 'add_custom_provider', ...provider }) }

  private update(id: string, changes: Partial<ProviderAuthAttempt>): void {
    const previous = this.jobs.get(id)
    if (!previous) return
    const value = { ...previous, ...changes }
    if (value.status === 'complete' || value.status === 'cancelled' || value.status === 'error') {
      delete value.prompt; delete value.authUrl; delete value.userCode; delete value.instructions; delete value.message
    }
    this.jobs.set(id, value)
    if (this.closed) return
    for (const listener of this.listeners) {
      try { listener(structuredClone(value)) }
      catch (error) { void error; console.error('Pi DSH provider subscriber failed') }
    }
  }

  private receive(event: PiEvent): void {
    if (event.type === 'bridge_error') {
      for (const attempt of this.jobs.values()) if (attempt.status === 'working' || attempt.status === 'waiting') {
        this.update(attempt.id, { status: 'error', prompt: undefined, authUrl: undefined, userCode: undefined, error: 'Pi provider management stopped unexpectedly' })
      }
      return
    }
    if (event.type !== 'provider_auth' || typeof event.operationId !== 'string') return
    const previous = this.jobs.get(event.operationId)
    if (!previous || (previous.status !== 'working' && previous.status !== 'waiting')) return
    if (event.event === 'prompt') this.update(previous.id, { status: 'waiting', prompt: prompt(event.prompt) })
    else if (event.event === 'prompt_cancelled' && previous.prompt?.id === event.promptId) this.update(previous.id, { status: 'working', prompt: undefined })
    else if (event.event === 'notify' && isJsonObject(event.notification)) {
      const notification = event.notification
      if (notification.type === 'auth_url') this.update(previous.id, { authUrl: webUrl(notification.url), instructions: typeof notification.instructions === 'string' ? notification.instructions : undefined })
      else if (notification.type === 'device_code') this.update(previous.id, { authUrl: webUrl(notification.verificationUri), userCode: typeof notification.userCode === 'string' ? notification.userCode : undefined })
      else if (typeof notification.message === 'string') this.update(previous.id, { message: notification.message })
    }
  }

  /** Stop events, abort pending SDK operations and join the independent Node process. */
  async dispose(): Promise<void> {
    this.closed = true
    this.listeners.clear(); this.unsubscribe()
    await this.process.dispose()
    await Promise.all(this.completions.values())
  }
}
