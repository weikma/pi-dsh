/** Selected public Pi SDK adapters. Discovery does not load extension code or connect MCP servers. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, lstat, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isJsonObject, type JsonObject } from '../bridge/types.ts'
import type { AgentConfigurationView, AgentPreferences, AgentResource, ConfigurationScope, ResourceDocument, ResourceKind, ResourceId, PackageId, PiPackage } from '../bridge/agent-types.ts'

interface NativeSettings {
  getSettings(): JsonObject
  getGlobalSettings(): JsonObject
  getProjectSettings(): JsonObject
  flush(): Promise<void>
  drainErrors(): { error: Error }[]
  setDefaultModelAndProvider(provider: string, model: string): void
  setDefaultThinkingLevel(value: string): void
  setSteeringMode(value: 'all' | 'one-at-a-time'): void
  setFollowUpMode(value: 'all' | 'one-at-a-time'): void
  setCompactionEnabled(value: boolean): void
  setRetryEnabled(value: boolean): void
  setImageAutoResize(value: boolean): void
  setBlockImages(value: boolean): void
  setEnableSkillCommands(value: boolean): void
  setSkillPaths(value: string[]): void
  setProjectSkillPaths(value: string[]): void
  setPromptTemplatePaths(value: string[]): void
  setProjectPromptTemplatePaths(value: string[]): void
  setExtensionPaths(value: string[]): void
  setProjectExtensionPaths(value: string[]): void
  setProjectPackages(value: unknown[]): void
  setPackages(value: unknown[]): void
}
interface NativeResource { path: string; enabled: boolean; metadata: { scope: string; origin: string; source: string } }
interface NativePackageManager {
  resolve(onMissing: () => Promise<'skip'>): Promise<{ skills: NativeResource[]; prompts: NativeResource[]; extensions: NativeResource[] }>
  listConfiguredPackages(): { source: string; scope: ConfigurationScope; installedPath?: string }[]
  installAndPersist(source: string, options?: { local: boolean }): Promise<void>
  removeAndPersist(source: string, options?: { local: boolean }): Promise<boolean>
  update(source: string): Promise<void>
}
interface AgentSDK {
  VERSION: string
  SettingsManager: {
    create(cwd: string, agentDir: string, options?: { projectTrusted: boolean }): NativeSettings
    inMemory(settings: JsonObject, options?: { projectTrusted: boolean }): NativeSettings
  }
  ProjectTrustStore: new (agentDir: string) => { get(cwd: string): boolean | null; set(cwd: string, decision: boolean): void }
  DefaultPackageManager: new (options: { cwd: string; agentDir: string; settingsManager: NativeSettings; builtinExtensions: string[] }) => NativePackageManager
  loadProjectContextFiles(options: { cwd: string; agentDir: string }): { path: string; content: string }[]
  parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function sdk(value: unknown): value is AgentSDK {
  return object(value) && typeof value.VERSION === 'string' && typeof value.DefaultPackageManager === 'function'
    && typeof value.ProjectTrustStore === 'function' && typeof value.loadProjectContextFiles === 'function' && typeof value.parseFrontmatter === 'function'
    && (object(value.SettingsManager) || typeof value.SettingsManager === 'function') && 'create' in value.SettingsManager && typeof value.SettingsManager.create === 'function'
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const inside = (root: string, path: string): boolean => { const value = relative(root, path); return value !== '..' && !value.startsWith('..' + sep) && !value.startsWith(sep) }
const strings = (value: unknown): string[] => Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : []
const packageId = (scope: ConfigurationScope, value: string): PackageId => digest(scope + ':' + value) as PackageId

/** Accept native package sources without shell syntax, embedded credentials or ambiguous relative paths. */
function packageSource(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /\p{Cc}/u.test(value)) throw new Error('Enter an npm package, HTTPS Git repository, or absolute local path')
  const text = value.trim()
  if (/^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.*^~+_-][a-zA-Z0-9.*^~+_-]*)?$/u.test(text)) return text
  if (isAbsolute(text)) return text
  if (text.startsWith('https://') || text.startsWith('git:https://') || /^git:[a-z0-9.-]+\//u.test(text)) {
    const address = text.startsWith('git:') ? text.slice(4) : text
    const url = new URL(address.startsWith('https://') ? address : 'https://' + address)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname !== '/') return text
  }
  throw new Error('Use npm:name@version, a credential-free HTTPS Git repository, or an absolute local path')
}
async function source(path: string): Promise<string> {
  try { if ((await stat(path)).size > 256 * 1024) throw new Error('Configuration file exceeds 256 KiB'); return await readFile(path, 'utf8') }
  catch (error) { if (object(error) && error.code === 'ENOENT') return ''; throw error }
}
async function destination(path: string): Promise<string> {
  for (let count = 0; count < 32; count++) {
    try { return await realpath(path) }
    catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error }
    try {
      if ((await lstat(path)).isSymbolicLink()) { path = resolve(dirname(path), await readlink(path)); continue }
    } catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error }
    await mkdir(dirname(path), { recursive: true })
    return join(await realpath(dirname(path)), basename(path))
  }
  throw new Error('Configuration contains an unresolved symbolic link')
}

/** Compare immediately before atomic replacement; preserve existing permissions and symbolic links. */
async function replace(path: string, content: string, expected: string): Promise<void> {
  const target = await destination(path)
  if (digest(await source(target)) !== expected) throw new Error('Configuration changed on disk. Refresh before saving.')
  let mode = 0o600
  try { mode = (await stat(target)).mode & 0o777 } catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error }
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, content, { flag: 'wx', mode })
    if (digest(await source(target)) !== expected || await destination(path) !== target) throw new Error('Configuration changed on disk. Refresh before saving.')
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
}
function json(content: string): JsonObject {
  const value: unknown = content === '' ? {} : JSON.parse(content)
  if (!isJsonObject(value)) throw new Error('Pi configuration must contain a JSON object')
  return value
}
function preferences(value: JsonObject): AgentPreferences {
  const images = isJsonObject(value.images) ? value.images : {}
  return { defaultProvider: typeof value.defaultProvider === 'string' ? value.defaultProvider : '', defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel : '',
    thinking: typeof value.defaultThinkingLevel === 'string' ? value.defaultThinkingLevel : 'medium',
    steering: value.steeringMode === 'all' ? 'all' : 'one-at-a-time', followUp: value.followUpMode === 'all' ? 'all' : 'one-at-a-time',
    compaction: !isJsonObject(value.compaction) || value.compaction.enabled !== false, retry: !isJsonObject(value.retry) || value.retry.enabled !== false,
    autoResize: images.autoResize !== false, blockImages: images.blockImages === true, skillCommands: value.enableSkillCommands !== false }
}
function endpoint(value: JsonObject): string {
  if (typeof value.command === 'string') return basename(value.command)
  if (typeof value.url === 'string') { try { const url = new URL(value.url); return url.origin + url.pathname } catch { return 'Invalid URL' } }
  return 'Invalid configuration'
}

/** Native file/SDK setup operations, serialized by the owning worker and Host. */
export class AgentConfiguration {
  private readonly sdk: AgentSDK
  private resources = new Map<string, AgentResource>()
  private packages = new Map<string, PiPackage>()
  private packageRoots = new Map<string, string>()
  constructor(value: unknown, private readonly cwd: string, private readonly agentDir: string) {
    if (!sdk(value)) throw new Error('Selected Pi does not expose the supported public configuration SDK. Use native Pi setup.')
    this.sdk = value
  }
  private trusted(): boolean {
    const saved = new this.sdk.ProjectTrustStore(this.agentDir).get(this.cwd)
    if (saved !== null) return saved
    return this.sdk.SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: false }).getGlobalSettings().defaultProjectTrust === 'always'
  }
  private settings(): NativeSettings {
    const value = this.sdk.SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: this.trusted() })
    for (const method of ['getSettings', 'getGlobalSettings', 'getProjectSettings', 'flush', 'drainErrors'] as const) {
      if (typeof value[method] !== 'function') throw new Error('Selected Pi configuration SDK is incompatible. Use native Pi setup.')
    }
    if (value.drainErrors().length) throw new Error('Pi settings could not load. Repair the configuration before saving.')
    return value
  }
  private async flush(settings: NativeSettings): Promise<void> {
    await settings.flush()
    if (settings.drainErrors().length) throw new Error('Pi could not save settings. Check configuration file access and retry.')
  }
  private scopeRoot(scope: ConfigurationScope): string { return scope === 'user' ? this.agentDir : join(this.cwd, '.pi') }
  private manager(settings: NativeSettings): NativePackageManager {
    return new this.sdk.DefaultPackageManager({ cwd: this.cwd, agentDir: this.agentDir, settingsManager: settings, builtinExtensions: ['mcp', 'codemode', 'tool-search'] })
  }
  private resource(kind: ResourceKind, path: string, enabled: boolean, scope: ConfigurationScope, description = '', editable = true): AgentResource {
    const id = digest(kind + ':' + path) as ResourceId
    return { id, kind, path, scope, enabled, editable, name: kind === 'skills' && basename(path).toLowerCase() === 'skill.md' ? basename(dirname(path)) : basename(path).replace(/\.md$/i, ''), description }
  }
  async view(): Promise<AgentConfigurationView> {
    const settings = this.settings()
    const manager = this.manager(settings)
    const configured = manager.listConfiguredPackages()
    this.packageRoots = new Map(configured.flatMap(item => item.installedPath ? [[packageId(item.scope, item.source), item.installedPath]] : []))
    const packages: PiPackage[] = []
    for (const item of configured) {
      let metadata: JsonObject = {}
      if (item.installedPath) {
        try { metadata = json(await source(join(item.installedPath, 'package.json'))) }
        catch (error) { if (!object(error) || error.code !== 'ENOTDIR') throw error }
      }
      packages.push({ id: packageId(item.scope, item.source), source: item.source, scope: item.scope, installed: item.installedPath !== undefined,
        name: typeof metadata.name === 'string' ? metadata.name : item.source,
        version: typeof metadata.version === 'string' ? metadata.version : '', description: typeof metadata.description === 'string' ? metadata.description : '' })
    }
    this.packages = new Map(packages.map(item => [item.id, item]))
    const resolved = await manager.resolve(async () => 'skip')
    const resources: AgentResource[] = []
    for (const kind of ['skills', 'prompts', 'extensions'] as const) for (const entry of resolved[kind]) {
      const scope = entry.metadata.scope === 'project' ? 'project' : 'user'
      let path = entry.path, description = entry.metadata.source, skillName = ''
      if (kind === 'skills') {
        try { if ((await stat(path)).isDirectory()) path = join(path, 'SKILL.md') } catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error }
      }
      if (kind !== 'extensions') {
        const parsed = this.sdk.parseFrontmatter(await source(path))
        description = typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description : parsed.body.trim().split('\n')[0] ?? ''
        if (kind === 'skills' && typeof parsed.frontmatter.name === 'string') skillName = parsed.frontmatter.name
      }
      const owner = configured.find(item => item.scope === scope && item.installedPath && inside(item.installedPath, path))
      resources.push({ ...this.resource(kind, path, entry.enabled, scope, description, kind !== 'extensions' && entry.metadata.origin !== 'package'),
        ...(skillName ? { name: skillName } : {}),
        ...(owner ? { packageId: packageId(owner.scope, owner.source) } : {}) })
    }
    const instructions = this.sdk.loadProjectContextFiles({ cwd: this.cwd, agentDir: this.agentDir })
    for (const entry of instructions) resources.push(this.resource('instructions', entry.path, true, inside(this.agentDir, entry.path) ? 'user' : 'project', '', dirname(entry.path) === this.agentDir || dirname(entry.path) === this.cwd))
    for (const scope of ['user', 'project'] as const) {
      const path = scope === 'user' ? join(this.agentDir, 'AGENTS.md') : join(this.cwd, 'AGENTS.md')
      if (!resources.some(item => item.path === path)) resources.push(this.resource('instructions', path, true, scope, '', true))
    }
    this.resources = new Map(resources.map(item => [item.id, item]))
    const mcp: AgentConfigurationView['mcp'] = []
    const mcpSources: string[] = []
    for (const scope of ['user', 'project'] as const) {
      const content = await source(join(this.scopeRoot(scope), 'mcp.json')); mcpSources.push(content)
      const config = json(content)
      if (isJsonObject(config.mcpServers)) for (const [name, entry] of Object.entries(config.mcpServers)) if (isJsonObject(entry)) {
        mcp.push({ name, scope, endpoint: endpoint(entry), enabled: entry.enabled !== false, exposure: typeof entry.exposure === 'string' ? entry.exposure : 'codemode' })
      }
    }
    return { sdkVersion: this.sdk.VERSION, agentDir: this.agentDir, cwd: this.cwd, preferences: preferences(settings.getGlobalSettings()),
      projectTrusted: this.trusted(), overridden: Object.keys(settings.getProjectSettings()), resources, mcp,
      packages, packageManagement: typeof manager.installAndPersist === 'function' && typeof manager.removeAndPersist === 'function' && typeof manager.update === 'function' && typeof this.sdk.SettingsManager.inMemory === 'function',
      revision: digest(JSON.stringify(settings.getGlobalSettings()) + JSON.stringify(settings.getProjectSettings()) + mcpSources.join('\n')) }
  }
  async read(id: string): Promise<ResourceDocument> {
    await this.view()
    const item = this.resources.get(id)
    if (!item || item.kind === 'extensions') throw new Error('Resource is not available for reading')
    const content = await source(item.path)
    return { id: item.id, path: item.path, content, revision: digest(content) }
  }
  async update(input: JsonObject): Promise<AgentConfigurationView | ResourceDocument> {
    await this.view()
    if (input.action === 'read' && typeof input.resourceId === 'string') return this.read(input.resourceId)
    if (input.action === 'package') {
      const settings = this.settings(), manager = this.manager(settings)
      if (typeof manager.installAndPersist !== 'function' || typeof manager.removeAndPersist !== 'function' || typeof manager.update !== 'function') throw new Error('Selected Pi does not support package management. Use native Pi setup.')
      if (input.operation === 'install') {
        if (input.scope !== 'user' && input.scope !== 'project') throw new Error('Choose a package installation scope')
        if (input.scope === 'project' && !this.trusted()) throw new Error('Trust the project before installing its packages')
        const source = packageSource(input.source)
        await manager.installAndPersist(source, { local: input.scope === 'project' })
        await this.flush(settings)
      } else {
        const item = typeof input.packageId === 'string' ? this.packages.get(input.packageId) : undefined
        if (!item) throw new Error('Package changed on disk. Refresh before continuing.')
        if (item.scope === 'project' && !this.trusted()) throw new Error('Trust the project before managing its packages')
        if (input.operation === 'remove') {
          await manager.removeAndPersist(item.source, { local: item.scope === 'project' })
          await this.flush(settings)
        } else if (input.operation === 'update') {
          if (typeof this.sdk.SettingsManager.inMemory !== 'function') throw new Error('Selected Pi requires native package updates')
          // Native updates visit both scopes. A memory-only selection restricts this operation without rewriting the user's filters.
          const scoped = this.sdk.SettingsManager.inMemory({ ...settings.getSettings(), packages: item.scope === 'user' ? [item.source] : [] }, { projectTrusted: this.trusted() })
          if (item.scope === 'project') scoped.setProjectPackages([item.source])
          await this.manager(scoped).update(item.source)
        } else throw new Error('Unsupported package operation')
      }
    } else if (input.action === 'trust') {
      if (input.scope !== 'project' || typeof input.trusted !== 'boolean') throw new Error('A project trust decision is required')
      new this.sdk.ProjectTrustStore(this.agentDir).set(this.cwd, input.trusted)
    } else if (input.action === 'preferences') {
      if (!isJsonObject(input.values)) throw new Error('Pi settings require named values')
      const settings = this.settings(), values = input.values
      const allowed = ['defaultProvider', 'defaultModel', 'thinking', 'steering', 'followUp', 'compaction', 'retry', 'autoResize', 'blockImages', 'skillCommands']
      if (Object.keys(values).some(key => !allowed.includes(key))) throw new Error('Unsupported Pi setting')
      // Validate the entire edit before invoking any native setter.
      for (const key of ['compaction', 'retry', 'autoResize', 'blockImages', 'skillCommands']) if (values[key] !== undefined && typeof values[key] !== 'boolean') throw new Error('Pi toggle values must be boolean')
      if (values.thinking !== undefined && (typeof values.thinking !== 'string' || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(values.thinking))) throw new Error('Invalid Pi thinking level')
      for (const key of ['steering', 'followUp']) if (values[key] !== undefined && values[key] !== 'all' && values[key] !== 'one-at-a-time') throw new Error('Invalid Pi message delivery mode')
      if (values.defaultProvider !== undefined || values.defaultModel !== undefined) {
        if (typeof values.defaultProvider !== 'string' || !values.defaultProvider.trim() || typeof values.defaultModel !== 'string' || !values.defaultModel.trim()) throw new Error('Select a provider and model together')
        settings.setDefaultModelAndProvider(values.defaultProvider, values.defaultModel)
      }
      if (typeof values.thinking === 'string') settings.setDefaultThinkingLevel(values.thinking)
      if (values.steering === 'all' || values.steering === 'one-at-a-time') settings.setSteeringMode(values.steering)
      if (values.followUp === 'all' || values.followUp === 'one-at-a-time') settings.setFollowUpMode(values.followUp)
      if (typeof values.compaction === 'boolean') settings.setCompactionEnabled(values.compaction)
      if (typeof values.retry === 'boolean') settings.setRetryEnabled(values.retry)
      if (typeof values.autoResize === 'boolean') settings.setImageAutoResize(values.autoResize)
      if (typeof values.blockImages === 'boolean') settings.setBlockImages(values.blockImages)
      if (typeof values.skillCommands === 'boolean') settings.setEnableSkillCommands(values.skillCommands)
      await this.flush(settings)
    } else if (input.action === 'write') {
      const item = typeof input.resourceId === 'string' ? this.resources.get(input.resourceId) : undefined
      if (!item?.editable || typeof input.content !== 'string' || typeof input.revision !== 'string' || input.content.length > 256 * 1024) throw new Error('Resource cannot be edited')
      if (item.kind !== 'instructions' && !input.content.trim()) throw new Error('Resource content cannot be empty')
      this.sdk.parseFrontmatter(input.content)
      await replace(item.path, input.content, input.revision)
    } else if (input.action === 'create') {
      if ((input.kind !== 'skills' && input.kind !== 'prompts') || (input.scope !== 'user' && input.scope !== 'project') || typeof input.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.name)
        || typeof input.description !== 'string' || !input.description.trim() || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 128 * 1024) throw new Error('Enter a lowercase name, description, and non-empty content')
      const path = input.kind === 'skills' ? join(this.scopeRoot(input.scope), 'skills', input.name, 'SKILL.md') : join(this.scopeRoot(input.scope), 'prompts', input.name + '.md')
      if (await source(path) !== '') throw new Error('A resource with this name already exists')
      const content = '---\n' + (input.kind === 'skills' ? 'name: ' + input.name + '\n' : '') + 'description: ' + JSON.stringify(input.description.trim()) + '\n---\n\n' + input.content.trim() + '\n'
      await replace(path, content, digest(''))
    } else if (input.action === 'toggle') {
      const item = typeof input.resourceId === 'string' ? this.resources.get(input.resourceId) : undefined
      if (!item || item.kind === 'instructions' || typeof input.enabled !== 'boolean') throw new Error('Invalid resource selection')
      const settings = this.settings(), scoped = item.scope === 'user' ? settings.getGlobalSettings() : settings.getProjectSettings()
      if (item.packageId) {
        const owner = this.packages.get(item.packageId), root = this.packageRoots.get(item.packageId)
        if (!owner || !root || !Array.isArray(scoped.packages)) throw new Error('Package changed on disk. Refresh before saving.')
        const path = relative(root, item.path).split(sep).join('/')
        const packages = scoped.packages.map(entry => {
          const source = typeof entry === 'string' ? entry : isJsonObject(entry) ? entry.source : undefined
          if (source !== owner.source) return entry
          const previous = isJsonObject(entry) ? entry : { source }
          const patterns = previous[item.kind] === undefined ? previous.autoload === false ? [] : ['**'] : strings(previous[item.kind])
          return { ...previous, [item.kind]: [...patterns.filter(value => value !== '+' + path && value !== '-' + path), (input.enabled ? '+' : '-') + path] }
        })
        if (item.scope === 'user') settings.setPackages(packages); else settings.setProjectPackages(packages)
        await this.flush(settings)
        return this.view()
      }
      const paths = strings(scoped[item.kind]).filter(path => path !== item.path && path !== '-' + item.path && path !== '+' + item.path)
      paths.push((input.enabled ? '+' : '-') + item.path)
      if (item.kind === 'skills') { if (item.scope === 'user') settings.setSkillPaths(paths); else settings.setProjectSkillPaths(paths) }
      else if (item.kind === 'prompts') { if (item.scope === 'user') settings.setPromptTemplatePaths(paths); else settings.setProjectPromptTemplatePaths(paths) }
      else { if (item.scope === 'user') settings.setExtensionPaths(paths); else settings.setProjectExtensionPaths(paths) }
      await this.flush(settings)
    } else if (input.action === 'mcp') {
      if ((input.scope !== 'user' && input.scope !== 'project') || typeof input.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.name)) throw new Error('Invalid MCP name or scope')
      const path = join(this.scopeRoot(input.scope), 'mcp.json'), original = await source(path), config = json(original)
      if (config.mcpServers !== undefined && !isJsonObject(config.mcpServers)) throw new Error('Invalid Pi mcpServers configuration')
      const servers = isJsonObject(config.mcpServers) ? config.mcpServers : {}, previous = servers[input.name]
      if (previous !== undefined && !isJsonObject(previous)) throw new Error('Repair the existing MCP entry before editing')
      const entry: JsonObject = isJsonObject(previous) ? { ...previous } : {}
      if (input.command !== undefined || input.url !== undefined) {
        if (previous !== undefined) throw new Error('An MCP server with this name already exists')
        if (typeof input.url === 'string' && input.command === undefined) {
          const url = new URL(input.url)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Use an HTTP(S) MCP URL without embedded credentials')
          entry.url = url.href
        } else if (typeof input.command === 'string' && input.command.trim() && input.url === undefined && Array.isArray(input.args) && input.args.every(arg => typeof arg === 'string')) {
          entry.command = input.command.trim(); entry.args = input.args
        } else throw new Error('Choose an MCP URL or executable with arguments')
      }
      if (previous === undefined && entry.command === undefined && entry.url === undefined) throw new Error('MCP connection details are required')
      if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw new Error('MCP enabled must be boolean'); entry.enabled = input.enabled }
      if (input.exposure !== undefined) {
        if (typeof input.exposure !== 'string' || !['codemode', 'codemode-deferred', 'deferred', 'direct', 'hidden'].includes(input.exposure)) throw new Error('Invalid MCP exposure')
        entry.exposure = input.exposure
      }
      servers[input.name] = entry; config.mcpServers = servers
      await replace(path, JSON.stringify(config, null, 2) + '\n', digest(original))
    } else throw new Error('Unsupported Pi configuration action')
    return this.view()
  }
}
