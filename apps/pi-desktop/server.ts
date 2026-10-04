/** Shared loopback host for the Electron and local Web presentations. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, writeFile, mkdir, rename, rm, stat, readdir, realpath, open } from 'node:fs/promises'
import { join, resolve, relative, extname, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PiBridge } from './bridge/manager.ts'
import { PiExtensionStartupError } from './bridge/process.ts'
import { isJsonObject, type PiCommand } from './bridge/types.ts'
import { loadRuntime, runtimeConfigPath } from './runtime/config.ts'
import { availableBundledRuntime, bundledPi, type BundledRuntime } from './runtime/bundled.ts'
import { OfficePreviewer, supportsOfficePreview } from './office-preview.ts'
import { createPiSetupLauncher } from './pi-setup.ts'
import { ProviderGateway } from './bridge/providers.ts'
import type { CustomProvider } from './bridge/provider-types.ts'
import { PackageMarketplace } from './marketplace.ts'
import { readPanelWidths, type PanelWidths } from './panel-layout.ts'
import { readTextAppearance, type TextAppearance } from './appearance.ts'
import { readLastModel, type LastModel } from './last-model.ts'
import { publicRuntimeArgs, restoreRuntimeArgs } from './runtime/public-args.ts'
import { UnreadChats } from './unread-chats.ts'
import { ProjectGit } from './project-git.ts'
import { Terminals, type TerminalShell } from './terminals.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? '.' : '..')
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

/** User-owned navigation metadata; Pi retains ownership of conversation files. */
interface Preferences { projects: { cwd: string; name: string }[]; gui: GuiPreferences }

/** Presentation settings survive the native Host's changing loopback port. */
interface GuiPreferences extends Partial<TextAppearance>, Partial<PanelWidths> { locale?: 'zh' | 'en'; appearance?: 'light' | 'dark' | 'system'; cwd?: string; sessionId?: string; sessionFile?: string; collapsedProjects?: string[]; pinnedSessions?: string[]; archivedSessions?: string[]; lastModel?: LastModel }

function guiPreferences(input: unknown): GuiPreferences {
  if (!isJsonObject(input)) throw new Error('GUI preferences must be an object')
  if (input.locale !== undefined && input.locale !== 'zh' && input.locale !== 'en') throw new Error('Unsupported GUI locale')
  if (input.appearance !== undefined && input.appearance !== 'light' && input.appearance !== 'dark' && input.appearance !== 'system') throw new Error('Unsupported GUI appearance')
  const paths: { cwd?: string; sessionId?: string; sessionFile?: string; collapsedProjects?: string[]; pinnedSessions?: string[]; archivedSessions?: string[] } = {}
  for (const key of ['cwd', 'sessionId', 'sessionFile'] as const) {
    const value = input[key]
    if (value !== undefined) { if (typeof value !== 'string') throw new Error('GUI ' + key + ' must be a string'); paths[key] = value }
  }
  const navigation: Pick<GuiPreferences, 'collapsedProjects' | 'pinnedSessions' | 'archivedSessions'> = {}
  for (const key of ['collapsedProjects', 'pinnedSessions', 'archivedSessions'] as const) {
    const value = input[key]
    if (value !== undefined) {
      if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) throw new Error('GUI ' + key + ' must be a string array')
      navigation[key] = [...new Set(value)]
    }
  }
  const lastModel = readLastModel(input.lastModel)
  return { ...paths, ...navigation, ...readTextAppearance(input), ...readPanelWidths(input), ...(lastModel === undefined ? {} : { lastModel }), ...(input.locale === undefined ? {} : { locale: input.locale }), ...(input.appearance === undefined ? {} : { appearance: input.appearance }) }
}

/** Host launch settings shared by tests, development, and Electron. */
export interface HostOptions {
  port?: number
  home?: string
  staticRoot?: string
  appRoot?: string
  allowedOrigins?: string[]
  bundledRoot?: string
  officeScript?: string
  providerWorker?: string
  /** Caller owns cancellation of its parallel shell read; only runtime-dependent routes wait. */
  environmentReady?: Promise<void>
  /** Explicit Host-owned shell selection, independent of renderer requests. */
  terminalShell?: TerminalShell
}

interface HostRuntimeServices { bundled: BundledRuntime | undefined; office: OfficePreviewer; bridge: PiBridge }

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('JSON request body required')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += bytes.length
    if (size > 24 * 1024 * 1024) throw new Error('Request exceeds the 24 MiB upload limit')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch (error) { void error; throw new Error('Request body must contain valid JSON') }
}

/** Start the local GUI server without importing the Pi implementation. */
export async function startHost(options: HostOptions = {}) {
  const marketplace = new PackageMarketplace()
  const terminals = new Terminals(options.terminalShell)
  const home = options.home ?? process.env.PI_DESKTOP_HOME ?? join(homedir(), '.pi-desktop')
  const appRoot = options.appRoot ?? APP_ROOT
  const staticRoot = options.staticRoot ?? join(appRoot, 'dist', 'client')
  await mkdir(home, { recursive: true, mode: 0o700 })
  const preferencesPath = join(home, 'preferences.json')
  let preferences: Preferences = { projects: [], gui: {} }
  try {
    const saved: unknown = JSON.parse(await readFile(preferencesPath, 'utf8'))
    if (isJsonObject(saved) && Array.isArray(saved.projects)) {
      preferences.projects = saved.projects.flatMap(row => isJsonObject(row) && typeof row.cwd === 'string' && typeof row.name === 'string' ? [{ cwd: row.cwd, name: row.name }] : [])
      if (saved.gui !== undefined) preferences.gui = guiPreferences(saved.gui)
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const runtimeOptions = { ...(options.bundledRoot === undefined ? {} : { bundledRoot: options.bundledRoot }), installationHome: home }
  const sessionRoots = new Map<string, string>()
  const resolveProjectFile = async (input: unknown): Promise<{ path: string; root: string; directory: boolean; size: number }> => {
    if (!isJsonObject(input) || (input.path !== undefined && typeof input.path !== 'string')) throw new Error('A project file path is required')
    const cwd = typeof input.sessionId === 'string' ? sessionRoots.get(input.sessionId)
      : typeof input.cwd === 'string' && preferences.projects.some(project => project.cwd === input.cwd) ? input.cwd : undefined
    if (cwd === undefined) throw new Error('Choose a registered project before browsing files')
    const root = await realpath(cwd)
    const path = await realpath(resolve(cwd, typeof input.path === 'string' ? input.path : '.'))
    const child = relative(root, path)
    if (child === '..' || child.startsWith('../') || child.startsWith('..\\') || resolve(root, child) !== path) throw new Error('File is outside the selected project')
    const info = await stat(path)
    if (!info.isFile() && !info.isDirectory()) throw new Error('Only regular files and directories can be opened')
    return { path, root, directory: info.isDirectory(), size: info.size }
  }
  const subscribers = new Map<ServerResponse, string>()
  const providerGateways = new Map<string, Promise<ProviderGateway>>()
  const authOwners = new Map<string, ProviderGateway>()
  const authSubscribers = new Map<ServerResponse, string>()
  const unread = await UnreadChats.open(join(home, 'unread-chats.json'))
  const unreadSubscribers = new Set<ServerResponse>()
  const visibleUnread = () => unread.snapshot().filter(item => preferences.projects.some(project => project.cwd === item.cwd) && !preferences.gui.archivedSessions?.includes(item.sessionFile))
  const publishUnread = (): void => {
    const frame = 'data: ' + JSON.stringify({ type: 'unread', items: visibleUnread() }) + '\n\n'
    for (const subscriber of unreadSubscribers) subscriber.write(frame)
  }
  unread.subscribe(publishUnread)
  let closing = false
  const createBridge = async (): Promise<PiBridge> => {
    const bridge = new PiBridge(await loadRuntime(appRoot, runtimeOptions))
    bridge.subscribeCompletions(completion => {
      if (!closing) void unread.mark(completion).catch(error => { console.error('Pi-DSH could not save unread reply:', error instanceof Error ? error.message : String(error)) })
    })
    return bridge
  }
  let prepared: HostRuntimeServices | undefined
  const preparation = (async (): Promise<HostRuntimeServices> => {
    // One offline copy runs alongside the shell read; runtime resolution then reuses it.
    const results = await Promise.allSettled([
      availableBundledRuntime(appRoot, options.bundledRoot, home), options.environmentReady,
    ])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    const payload = results[0]
    if (payload.status !== 'fulfilled') throw payload.reason
    const bundled = payload.value
    const bridge = await createBridge()
    prepared = { bundled, bridge, office: new OfficePreviewer(bundled, options.officeScript ?? join(APP_ROOT, 'assets', 'office-preview.py')) }
    return prepared
  })()
  // Deferred Desktop failures remain available to runtime routes without an unhandled rejection.
  void preparation.catch(error => { void error /* Runtime routes report preparation failure; the GUI remains usable. */ })
  if (options.environmentReady === undefined) await preparation
  const runtimeServices = async (): Promise<HostRuntimeServices> => {
    const services = await preparation
    if (closing) throw new Error('Host is stopping')
    return services
  }
  let writes = Promise.resolve()
  let runtimeWrites = Promise.resolve()
  let packageOperations = 0
  const hasBusySession = (): boolean => gitChanges.size > 0 || [...sessionRoots.keys()].some(id => {
    const snapshot = prepared?.bridge.get(id)?.snapshot()
    return snapshot !== undefined && (snapshot.resourcesReloading || snapshot.state.isStreaming || snapshot.state.isCompacting || snapshot.state.pendingMessageCount > 0 || snapshot.pendingUI.length > 0)
  })
  const gitChanges = new Set<string>()
  const projectOperations = new Map<string, number>()
  const inRepository = (root: string, path: string): boolean => { const child = relative(root, path); return child === '' || child !== '..' && !child.startsWith('../') && !child.startsWith('..\\') && resolve(root, child) === path }
  const projectOperation = async <T>(cwd: string, operation: () => Promise<T>): Promise<T> => {
    const path = await realpath(cwd)
    if ([...gitChanges].some(root => inRepository(root, path))) throw new Error('Wait for the Git branch change to finish before using Pi')
    projectOperations.set(path, (projectOperations.get(path) ?? 0) + 1)
    try { return await operation() }
    finally { const remaining = (projectOperations.get(path) ?? 1) - 1; if (remaining) projectOperations.set(path, remaining); else projectOperations.delete(path) }
  }
  const projectGit = new ProjectGit(async root => {
    gitChanges.add(root)
    try {
      if (packageOperations > 0 || [...projectOperations.keys()].some(path => inRepository(root, path))) { gitChanges.delete(root); return undefined }
      for (const [id, cwd] of sessionRoots) {
        const path = await realpath(cwd).catch(error => { if (isJsonObject(error) && error.code === 'ENOENT') return resolve(cwd); throw error })
        const state = prepared?.bridge.get(id)?.snapshot()
        if (inRepository(root, path) && state && (state.resourcesReloading || state.state.isStreaming || state.state.isCompacting || state.state.pendingMessageCount > 0 || state.pendingUI.length > 0)) {
          gitChanges.delete(root); return undefined
        }
      }
      return () => { gitChanges.delete(root) }
    } catch (error) { gitChanges.delete(root); throw error }
  })
  const setupLaunchers = new Set<() => Promise<void>>()
  const clearSetupLaunchers = async (): Promise<void> => {
    await Promise.all([...setupLaunchers].map(async dispose => {
      await dispose()
      setupLaunchers.delete(dispose)
    }))
  }
  const closeProviders = async (): Promise<void> => {
    for (const subscriber of authSubscribers.keys()) subscriber.end()
    authSubscribers.clear(); authOwners.clear()
    const owned = [...providerGateways.values()]
    providerGateways.clear()
    const results = await Promise.allSettled(owned.map(async pending => { await (await pending).dispose() }))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  const acquireProviders = async (context?: string): Promise<ProviderGateway> => {
    if (closing) throw new Error('Host is stopping')
    const cwd = await realpath(resolve(context ?? homedir()))
    if (closing) throw new Error('Host is stopping')
    let pending = providerGateways.get(cwd)
    if (!pending) {
      pending = (async () => {
        const { bundled } = await runtimeServices()
        const gateway = await ProviderGateway.create(await loadRuntime(appRoot, runtimeOptions), options.providerWorker ?? join(appRoot, 'dist', 'provider-worker.mjs'), cwd, bundled?.node.executable)
        gateway.subscribe(attempt => {
          for (const [subscriber, id] of authSubscribers) if (id === attempt.id) subscriber.write('data: ' + JSON.stringify({ type: 'provider_auth', attempt }) + '\n\n')
        })
        return gateway
      })()
      providerGateways.set(cwd, pending)
      const owned = pending
      void pending.catch(() => { if (providerGateways.get(cwd) === owned) providerGateways.delete(cwd) })
    }
    return pending
  }
  const manageProviders = <T>(context: string | undefined, operation: (gateway: ProviderGateway) => Promise<T>): Promise<T> => {
    const update = runtimeWrites.then(async () => operation(await acquireProviders(context)))
    runtimeWrites = update.then(() => {}, error => { void error /* The request reports failure; later management and runtime selection can retry. */ })
    return update
  }
  const providersFor = (context?: string): Promise<ProviderGateway> => manageProviders(context, async gateway => gateway)
  const save = (change: (current: Preferences) => Preferences | Promise<Preferences>): Promise<void> => {
    const update = writes.then(async () => {
      const next = await change(preferences)
      const content = JSON.stringify(next, null, 2) + '\n'
      const temporary = preferencesPath + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
        await rename(temporary, preferencesPath)
        preferences = next
        publishUnread()
      } finally { await rm(temporary, { force: true }) }
    })
    writes = update.catch(error => { void error /* The request reports the failure; later saves can retry. */ })
    return update
  }
  const json = (response: ServerResponse, value: unknown, status = 200): void => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (closing) { json(response, { error: 'Host is stopping' }, 503); return }
    const authority = request.headers.host
    if (authority !== new URL(url).host) { json(response, { error: 'Unexpected Host header' }, 403); return }
    const origin = request.headers.origin
    if (origin !== undefined && origin !== url && !options.allowedOrigins?.includes(origin)) { json(response, { error: 'Origin is not allowed' }, 403); return }
    if (origin !== undefined) response.setHeader('access-control-allow-origin', origin)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' }); response.end(); return
    }
    const address = new URL(request.url ?? '/', url)
    if (address.pathname === '/api/unread/events' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      unreadSubscribers.add(response)
      response.write('data: ' + JSON.stringify({ type: 'unread', items: visibleUnread() }) + '\n\n')
      response.on('close', () => { unreadSubscribers.delete(response) })
      return
    }
    if (address.pathname === '/api/unread') {
      if (request.method === 'POST') {
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.nativeSessionId !== 'string' || typeof input.entryId !== 'string') throw new Error('Viewed native session and reply entry required')
        await unread.read({ nativeSessionId: input.nativeSessionId, entryId: input.entryId })
      } else if (request.method !== 'GET') { json(response, { error: 'Unsupported unread operation' }, 405); return }
      json(response, { items: visibleUnread() }); return
    }
    if (address.pathname === '/api/preferences') {
      if (request.method === 'POST') {
        const patch = guiPreferences(await readBody(request))
        await save(current => ({ ...current, gui: { ...current.gui, ...patch } }))
      }
      json(response, preferences.gui); return
    }
    if (address.pathname === '/api/projects') {
      let selectedCwd: string | undefined
      if (request.method === 'POST') {
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.cwd !== 'string') throw new Error('Project directory required')
        const cwd = resolve(input.cwd)
        if (input.action === undefined && !(await stat(cwd)).isDirectory()) throw new Error('Project path must be a directory')
        await save(async current => {
          let selected = cwd
          if (input.action === undefined) {
            const canonical = await realpath(cwd)
            for (const project of current.projects) {
              const path = await realpath(project.cwd).catch(error => { if (isJsonObject(error) && error.code === 'ENOENT') return null; throw error })
              if (path === canonical) { selected = project.cwd; break }
            }
            selectedCwd = selected
          }
          const project = current.projects.find(project => project.cwd === selected)
          if (input.action === 'rename') {
            if (!project) throw new Error('Project is not registered')
            if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new Error('Project name must contain 1–200 characters')
            const name = input.name.trim()
            return { ...current, projects: current.projects.map(item => item.cwd === cwd ? { ...item, name } : item) }
          }
          if (input.action === 'remove') return { ...current,
            projects: current.projects.filter(project => project.cwd !== cwd),
            gui: current.gui.cwd === cwd ? { ...current.gui, cwd: '', sessionId: '', sessionFile: '' } : current.gui,
          }
          if (input.action !== undefined) throw new Error('Unsupported project action')
          return { ...current, projects: project ? current.projects : [...current.projects, { cwd, name: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd }] }
        })
      }
      json(response, { projects: preferences.projects, ...(selectedCwd === undefined ? {} : { cwd: selectedCwd }) }); return
    }
    if (address.pathname === '/api/project-git' || address.pathname === '/api/project-git/graph') {
      const cwd = address.searchParams.get('cwd')
      if (cwd === null || !preferences.projects.some(project => project.cwd === cwd)) throw new Error('Choose a registered project before using Git')
      await options.environmentReady
      if (request.method === 'GET') {
        json(response, address.pathname.endsWith('/graph') ? await projectGit.graph(cwd, Number(address.searchParams.get('skip') ?? 0)) : await projectGit.state(cwd)); return
      }
      if (request.method !== 'POST' || address.pathname.endsWith('/graph')) { json(response, { error: 'Unsupported Git operation' }, 405); return }
      const input = await readBody(request)
      if (!isJsonObject(input) || (input.action !== 'switch' && input.action !== 'create') || typeof input.branch !== 'string' || typeof input.revision !== 'string') throw new Error('Git branch action, name and observed revision required')
      json(response, await projectGit.change(cwd, input.action, input.branch, input.revision)); return
    }
    if (address.pathname === '/api/runtime') {
      const services = await runtimeServices()
      const { bundled } = services
      if (request.method === 'POST') {
        const input = await readBody(request)
        if (!isJsonObject(input)) throw new Error('Runtime selection required')
        const useBundled = input.mode === 'bundled'
        if (useBundled && bundled === undefined) throw new Error('Bundled Pi runtime is unavailable')
        if (!useBundled && (typeof input.command !== 'string' || !input.command.trim() || !Array.isArray(input.args) || !input.args.every(arg => typeof arg === 'string'))) throw new Error('Executable and string arguments required')
        if (input.agentDir !== undefined && typeof input.agentDir !== 'string') throw new Error('Agent directory must be a path')
        const requestedArgs = Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === 'string') : []
        const path = runtimeConfigPath(appRoot)
        const update = runtimeWrites.then(async () => {
          let current: unknown
          try { current = JSON.parse(await readFile(path, 'utf8')) }
          catch (error) {
            if (error instanceof SyntaxError) throw new Error('Pi runtime selection must contain valid JSON')
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          }
          const selected = isJsonObject(current) ? current : await loadRuntime(appRoot, runtimeOptions)
          const previousArgs: string[] = []
          if (Array.isArray(selected.args)) for (const arg of selected.args) if (typeof arg === 'string') previousArgs.push(arg)
          const args = restoreRuntimeArgs(previousArgs, requestedArgs)
          const unchanged = selected.command === input.command && JSON.stringify(selected.args) === JSON.stringify(args)
          await mkdir(dirname(path), { recursive: true })
          const temporary = path + '.' + randomUUID() + '.tmp'
          await writeFile(temporary, JSON.stringify(useBundled ? { mode: 'bundled', agentDir: input.agentDir || undefined } : { ...selected, mode: undefined, ...(unchanged ? {} : { version: undefined, package: undefined, gitHead: undefined, integrity: undefined }), command: input.command, args, agentDir: input.agentDir || undefined }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
          await rename(temporary, path)
          await clearSetupLaunchers()
          await closeProviders()
          await services.bridge.dispose()
          for (const subscriber of subscribers.keys()) subscriber.end()
          subscribers.clear(); sessionRoots.clear()
          services.bridge = await createBridge()
        })
        runtimeWrites = update.catch(error => { void error /* The rejected update reaches its request; later edits remain available. */ })
        await update
      }
      const runtime = await loadRuntime(appRoot, runtimeOptions)
      json(response, { command: runtime.command, args: publicRuntimeArgs(runtime.args), agentDir: runtime.agentDir, version: runtime.version, configured: true,
        source: bundled !== undefined && runtime.command === bundledPi(bundled).command && runtime.args[0] === bundled.pi.cli ? 'bundled' : 'external',
        ...(bundled === undefined ? {} : { bundled: { node: bundled.node.version, pi: bundled.pi.version, pnpm: bundled.pnpm.version, python: bundled.auxiliary.python.version } }) }); return
    }
    if (address.pathname === '/api/package-catalog' && request.method === 'GET') {
      const kind = address.searchParams.get('kind'), sort = address.searchParams.get('sort') ?? 'downloads'
      if ((kind !== 'extension' && kind !== 'skill') || (sort !== 'downloads' && sort !== 'recent' && sort !== 'name')) throw new Error('Invalid package search')
      json(response, await marketplace.browse({ kind, sort, query: address.searchParams.get('query') ?? '', page: Number(address.searchParams.get('page') ?? '1') }, address.searchParams.get('refresh') === 'true')); return
    }
    if (address.pathname === '/api/package-catalog/detail' && request.method === 'GET') {
      json(response, await marketplace.detail(address.searchParams.get('name') ?? '')); return
    }
    if (address.pathname === '/api/agent-configuration') {
      const input = request.method === 'POST' ? await readBody(request) : undefined
      if (input !== undefined && !isJsonObject(input)) throw new Error('Invalid Pi configuration request')
      const context = address.searchParams.get('cwd') ?? undefined
      if (input?.scope === 'project' && context === undefined) throw new Error('Select a project before changing project configuration')
      if (context !== undefined) {
        const canonical = await realpath(resolve(context))
        if (!preferences.projects.some(project => project.cwd === canonical)) throw new Error('Select a registered project for its configuration')
      }
      if (input?.action === 'package') {
        if (hasBusySession()) throw new Error('Finish current tasks, queued input and dialogs before changing packages')
        packageOperations++
      }
      try { json(response, await manageProviders(context, async gateway => gateway.agentConfiguration(input))) }
      finally { if (input?.action === 'package') packageOperations-- }
      return
    }
    if (address.pathname === '/api/providers' && request.method === 'GET') {
      json(response, await (await providersFor(address.searchParams.get('cwd') ?? undefined)).inventory()); return
    }
    if (['/api/providers/login', '/api/providers/logout', '/api/providers/custom'].includes(address.pathname) && request.method === 'POST') {
      const input = await readBody(request)
      if (!isJsonObject(input) || typeof input.providerId !== 'string' || !input.providerId.trim()
        || (input.cwd !== undefined && typeof input.cwd !== 'string')) throw new Error('Provider ID and valid configuration context required')
      if (address.pathname === '/api/providers/login') {
        if (input.authType !== 'api_key' && input.authType !== 'oauth') throw new Error('Unsupported Pi authentication method')
        const gateway = await providersFor(input.cwd)
        const attempt = gateway.startLogin(input.providerId, input.authType)
        authOwners.set(attempt.id, gateway)
        json(response, attempt); return
      }
      if (address.pathname === '/api/providers/logout') {
        const providerId = input.providerId
        await manageProviders(input.cwd, async gateway => gateway.logout(providerId)); json(response, { ok: true }); return
      }
      if (typeof input.baseUrl !== 'string' || !Array.isArray(input.models) || input.models.length === 0
        || !input.models.every(model => isJsonObject(model) && typeof model.id === 'string' && model.id.trim()
          && (model.name === undefined || typeof model.name === 'string') && (model.contextWindow === undefined || typeof model.contextWindow === 'number')
          && (model.maxTokens === undefined || typeof model.maxTokens === 'number') && (model.reasoning === undefined || typeof model.reasoning === 'boolean'))
        || (input.name !== undefined && typeof input.name !== 'string')
        || (input.api !== undefined && input.api !== 'openai-completions' && input.api !== 'openai-responses' && input.api !== 'anthropic-messages' && input.api !== 'google-generative-ai')) throw new Error('Invalid compatible provider configuration')
      const provider: CustomProvider = { providerId: input.providerId, baseUrl: input.baseUrl,
        ...(input.name === undefined ? {} : { name: input.name }), ...(input.api === undefined ? {} : { api: input.api }),
        models: input.models.map(model => { if (!isJsonObject(model) || typeof model.id !== 'string') throw new Error('Invalid model ID'); return { id: model.id,
          ...(typeof model.name === 'string' ? { name: model.name } : {}), ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
          ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}), ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}) } }) }
      await manageProviders(input.cwd, async gateway => gateway.addProvider(provider)); json(response, { ok: true }); return
    }
    const authRoute = /^\/api\/providers\/auth\/([^/]+)(?:\/(events|reply|cancel))?$/.exec(address.pathname)
    if (authRoute) {
      const id = decodeURIComponent(authRoute[1]!)
      const gateway = authOwners.get(id)
      const attempt = gateway?.attempt(id)
      if (!gateway || !attempt) { json(response, { error: 'Provider login was not found' }, 404); return }
      if (authRoute[2] === 'events' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        authSubscribers.set(response, id)
        response.write('data: ' + JSON.stringify({ type: 'provider_auth', attempt }) + '\n\n')
        response.on('close', () => { authSubscribers.delete(response) }); return
      }
      if (authRoute[2] === 'reply' && request.method === 'POST') {
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.promptId !== 'string' || typeof input.value !== 'string') throw new Error('Authentication prompt ID and response required')
        await gateway.reply(id, input.promptId, input.value); json(response, { ok: true }); return
      }
      if (authRoute[2] === 'cancel' && request.method === 'POST') { await readBody(request); await gateway.cancel(id); json(response, { ok: true }); return }
      if (authRoute[2] === undefined && request.method === 'GET') { json(response, attempt); return }
      json(response, { error: 'Unsupported provider operation' }, 405); return
    }
    if (address.pathname === '/api/pi-setup' && request.method === 'GET') {
      const update = runtimeWrites.then(async () => {
        if (closing) throw new Error('Host is stopping')
        await runtimeServices()
        const launcher = await createPiSetupLauncher(await loadRuntime(appRoot, runtimeOptions), address.searchParams.get('cwd') ?? undefined, home)
        if (closing) { await launcher.dispose(); throw new Error('Host is stopping') }
        setupLaunchers.add(launcher.dispose)
        return { commandLine: launcher.commandLine, cwd: launcher.cwd }
      })
      runtimeWrites = update.then(() => {}, error => { void error /* The request reports creation failure; later setup requests can retry. */ })
      json(response, await update); return
    }
    if (address.pathname === '/api/session-preview' && request.method === 'POST') {
      const input = await readBody(request)
      if (!isJsonObject(input) || typeof input.cwd !== 'string' || typeof input.sessionPath !== 'string') throw new Error('Session project and path required')
      const { bridge } = await runtimeServices()
      json(response, await bridge.previewSession(input.cwd, input.sessionPath)); return
    }
    if (address.pathname === '/api/sessions') {
      const { bridge } = await runtimeServices()
      if (request.method === 'POST') {
        if (packageOperations > 0) throw new Error('Wait for package management to finish before opening a Pi session')
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.cwd !== 'string') throw new Error('Session project directory required')
        const cwd = resolve(input.cwd)
        if (input.extensionRecovery !== undefined && typeof input.extensionRecovery !== 'boolean') throw new Error('Recovery selection must be boolean')
        const recovery = input.extensionRecovery
        const session = await projectOperation(cwd, () => bridge.createSession(cwd, typeof input.sessionPath === 'string' ? input.sessionPath : undefined, recovery))
        sessionRoots.set(session.id, cwd)
        json(response, { id: session.id }); return
      }
      json(response, { sessions: await bridge.listSessions(address.searchParams.get('cwd') ?? preferences.projects.map(project => project.cwd)) }); return
    }
    if (address.pathname === '/api/terminals' && request.method === 'POST') {
      const target = await resolveProjectFile(await readBody(request))
      if (!target.directory) throw new Error('Terminal requires a project directory')
      await options.environmentReady
      if (closing) throw new Error('Host is stopping')
      json(response, terminals.create(target.path)); return
    }
    const terminalRoute = /^\/api\/terminals\/([^/]+)\/(events|write|resize|close)$/.exec(address.pathname)
    if (terminalRoute) {
      const id = decodeURIComponent(terminalRoute[1]!)
      if (terminalRoute[2] === 'close' && request.method === 'POST') { await terminals.remove(id); json(response, { ok: true }); return }
      const terminal = terminals.get(id)
      if (terminalRoute[2] === 'events' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        let closed = false
        let unsubscribe: (() => void) | undefined
        const cleanup = (): void => { closed = true; unsubscribe?.(); clearInterval(heartbeat) }
        const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n') }, 10_000)
        response.once('close', cleanup)
        unsubscribe = await terminal.subscribe(event => {
          if (closed) return
          if (response.writableLength > 1024 * 1024) { response.end(); return }
          response.write('data: ' + JSON.stringify(event) + '\n\n')
          if (event.type === 'exit') response.end()
        })
        if (closed) unsubscribe()
        return
      }
      if (request.method !== 'POST') throw new Error('Terminal operation requires POST')
      const input = await readBody(request)
      if (!isJsonObject(input)) throw new Error('Terminal operation requires an object')
      if (terminalRoute[2] === 'write') {
        if (typeof input.data !== 'string' || input.data.length > 65536) throw new Error('Terminal input exceeds 64 KiB')
        terminal.write(input.data)
      } else if (terminalRoute[2] === 'resize') {
        if (typeof input.cols !== 'number' || typeof input.rows !== 'number' || !Number.isInteger(input.cols) || !Number.isInteger(input.rows) || input.cols < 2 || input.cols > 500 || input.rows < 1 || input.rows > 300) throw new Error('Invalid terminal dimensions')
        await terminal.resize(input.cols, input.rows)
      } else throw new Error('Unsupported terminal operation')
      json(response, { ok: true }); return
    }
    if (address.pathname === '/api/file-target' && request.method === 'POST') {
      json(response, await resolveProjectFile(await readBody(request))); return
    }
    if (address.pathname === '/api/files' || address.pathname === '/api/file-download') {
      const { path, root, directory, size } = await resolveProjectFile(Object.fromEntries(address.searchParams))
      if (address.pathname === '/api/file-download') {
        if (directory || size > 64 * 1024 * 1024) throw new Error('Download requires a file no larger than 64 MiB')
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(basename(path)), 'x-content-type-options': 'nosniff' })
        response.end(await readFile(path)); return
      }
      if (directory) {
        const all = await readdir(path, { withFileTypes: true })
        const entries = all.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0, 1000).map(entry => ({ name: entry.name, path: join(path, entry.name), kind: entry.isDirectory() ? 'directory' : 'file' }))
        json(response, { kind: 'directory', root, path, entries, truncated: all.length > entries.length }); return
      }
      if (supportsOfficePreview(path)) { json(response, await (await runtimeServices()).office.preview(path)); return }
      const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
      const imageType = images[extname(path).toLowerCase()]
      if (imageType !== undefined && size <= 8 * 1024 * 1024) { json(response, { kind: 'image', root, path, url: `data:${imageType};base64,${(await readFile(path)).toString('base64')}` }); return }
      const file = await open(path, 'r')
      let content: Buffer
      try { const buffer = Buffer.alloc(Math.min(size, 512 * 1024)); const result = await file.read(buffer, 0, buffer.length, 0); content = buffer.subarray(0, result.bytesRead) }
      finally { await file.close() }
      if (content.includes(0) || extname(path).toLowerCase() === '.pdf') { json(response, { kind: 'binary', root, path }); return }
      json(response, { kind: 'file', root, path, content: content.toString('utf8'), truncated: size > content.length }); return
    }
    const match = /^\/api\/sessions\/([^/]+)\/(snapshot|events|command|reconnect|reload|tree)$/.exec(address.pathname)
    if (match !== null) {
      const { bridge } = await runtimeServices()
      const session = bridge.get(decodeURIComponent(match[1]!))
      if (session === undefined) { json(response, { error: 'Session is not open' }, 404); return }
      if (match[2] === 'reconnect' && request.method === 'POST') {
        if (packageOperations > 0) throw new Error('Wait for package management to finish before reloading Pi')
        const input = await readBody(request)
        if (!isJsonObject(input) || input.extensionRecovery !== undefined && typeof input.extensionRecovery !== 'boolean') throw new Error('Recovery selection must be boolean')
        const recovery = input.extensionRecovery
        const replacement = await projectOperation(session.cwd, () => bridge.reconnect(session.id, recovery))
        sessionRoots.delete(session.id); sessionRoots.set(replacement.id, replacement.cwd)
        for (const [subscriber, id] of subscribers) if (id === session.id) { subscriber.end(); subscribers.delete(subscriber) }
        json(response, { id: replacement.id }); return
      }
      if (match[2] === 'reload' && request.method === 'POST') {
        if (packageOperations > 0) throw new Error('Wait for package management to finish before reloading Pi')
        await projectOperation(session.cwd, () => session.reloadResources())
        json(response, { ok: true }); return
      }
      if (match[2] === 'snapshot') { json(response, session.snapshot()); return }
      if (match[2] === 'tree' && request.method === 'POST') {
        if (packageOperations > 0) throw new Error('Wait for package management to finish before changing history')
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.entryId !== 'string' || (input.action !== 'navigate' && input.action !== 'fork')) throw new Error('Session entry and history action required')
        const entryId = input.entryId, action = input.action
        await projectOperation(session.cwd, () => session.navigate(entryId, action))
        json(response, { ok: true }); return
      }
      if (match[2] === 'command' && request.method === 'POST') {
        const input = await readBody(request)
        if (!isJsonObject(input) || typeof input.type !== 'string') throw new Error('Pi command type required')
        if (packageOperations > 0 && !input.type.startsWith('get_') && input.type !== 'abort' && input.type !== 'extension_ui_response') throw new Error('Wait for package management to finish before using Pi')
        const command: PiCommand = { ...input, type: input.type }
        const operation = () => session.command(command)
        json(response, await (command.type.startsWith('get_') || command.type === 'abort' || command.type === 'extension_ui_response' ? operation() : projectOperation(session.cwd, operation)) ?? null); return
      }
      if (match[2] === 'events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        subscribers.set(response, session.id)
        const publish = (snapshot: ReturnType<typeof session.snapshot>): void => { response.write('data: ' + JSON.stringify({ type: 'snapshot', snapshot }) + '\n\n') }
        const unsubscribe = session.subscribe(publish)
        publish(session.snapshot())
        response.on('close', () => { subscribers.delete(response); unsubscribe() })
        return
      }
    }
    if (address.pathname.startsWith('/api/')) { json(response, { error: 'Unknown API route' }, 404); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
    const path = resolve(staticRoot, '.' + decodeURIComponent(address.pathname))
    if (relative(staticRoot, path).startsWith('..')) { response.writeHead(403); response.end(); return }
    const target = extname(path) ? path : join(staticRoot, 'index.html')
    try {
      const bytes = await readFile(target)
      response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      response.writeHead(404); response.end('Build the GUI with pnpm build first')
    }
  }
  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.headersSent) { response.end(); return }
      json(response, { error: error instanceof Error ? error.message : String(error), ...(error instanceof PiExtensionStartupError ? { code: error.code } : {}) }, 400)
    })
  })
  await new Promise<void>((ready, reject) => { server.once('error', reject); server.listen(options.port ?? 19388, '127.0.0.1', ready) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Host did not bind a TCP address')
  const url = 'http://127.0.0.1:' + address.port
  return {
    url,
    hasActiveTasks: (): boolean => terminals.size > 0 || gitChanges.size > 0 || packageOperations > 0 || [...authOwners.values()].some(gateway => gateway.hasActiveLogin()) || [...sessionRoots.keys()].some(id => { const snapshot = prepared?.bridge.get(id)?.snapshot(); return snapshot?.resourcesReloading === true || snapshot?.state.isStreaming === true || snapshot?.state.isCompacting === true }),
    close: async (): Promise<void> => {
      closing = true
      const gitClosed = projectGit.close()
      const terminalsClosed = terminals.close()
      for (const subscriber of subscribers.keys()) subscriber.end()
      subscribers.clear()
      for (const subscriber of unreadSubscribers) subscriber.end()
      unreadSubscribers.clear()
      try {
        // Preparation owns no Pi child until a route acquires it, but its copy must still finish.
        await preparation.catch(error => { void error /* Failed preparation acquired no runtime processes. */ })
        // Closing management workers cancels package process groups before waiting for their serialized requests.
        const resources = await Promise.allSettled([closeProviders(), runtimeWrites, marketplace.close(), gitClosed, terminalsClosed])
        resources.push(...await Promise.allSettled([clearSetupLaunchers(), prepared?.office.close(), prepared?.bridge.dispose(), writes]))
        resources.push(...await Promise.allSettled([unread.close()]))
        const failures = resources.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
        if (failures.length > 0) throw new AggregateError(failures, 'Pi-DSH Host cleanup failed')
      } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
    },
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PI_DESKTOP_PORT ?? 19388)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('PI_DESKTOP_PORT must be a TCP port')
  const host = await startHost({ port })
  console.log('Pi-DSH Web: ' + host.url)
  const stop = (): void => { void host.close().then(() => { process.exitCode = 0 }).catch(console.error) }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
