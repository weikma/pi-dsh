import type { PanelWidths } from '../panel-layout.ts'
import type { LastModel } from '../last-model.ts'
import type { ProjectGitState, GitGraphPage, GitChangeResult } from '../git-types.ts'
import type { TextAppearance } from '../appearance.ts'
/** Same-origin HTTP carrier shared by Electron and ordinary browsers. */
import type { PiCommand, PiSessionSummary, PiSnapshot, JsonValue } from '../bridge/types.ts'
import type { CustomProvider, ProviderAuthType, ProviderInventory } from '../bridge/provider-types.ts'
import type { AgentConfigurationAction, AgentConfigurationView, ResourceDocument, ResourceId } from '../bridge/agent-types.ts'
import type { ProviderAuthAttempt } from '../bridge/provider-job.ts'
import type { MarketplaceQuery, MarketplacePage, MarketplaceDetail } from '../bridge/marketplace-types.ts'
import { isUnreadChat, type UnreadChat, type UnreadReceipt } from '../unread-types.ts'
import { isJsonObject } from '../bridge/types.ts'
import type { TerminalId, TerminalInfo } from '../terminal-types.ts'
import type { DirectoryListing, FileActionRequest, FileActionResult, LocalApplicationsView } from '../local-files-types.ts'

/** A project directory registered on the local Host. */
export interface Project { cwd: string; name: string }
/** Bounded read-only file presentations produced by the Host. */
export type FilePreview = ({ kind: 'file'; path: string; content: string; truncated?: boolean }
  | { kind: 'directory'; path: string; entries: { name: string; path: string; kind: string }[]; truncated?: boolean }
  | { kind: 'spreadsheet'; path: string; sheets: { name: string; rows: string[][] }[]; truncated?: boolean }
  | { kind: 'document'; path: string; html: string; truncated?: boolean }
  | { kind: 'image'; path: string; url: string }
  | { kind: 'binary'; path: string }) & { root?: string }
/** Public executable configuration; credential values remain on the Host. */
export interface RuntimeConfig {
  command: string
  args: string[]
  agentDir?: string
  version?: string
  configured: boolean
  source?: 'bundled' | 'external'
  /** Available distribution versions; the selected command may use another pi runtime. */
  bundled?: { node: string; pi: string; pnpm: string; python: string }
}
/** Host-persisted GUI choices; empty session fields clear the selected session. */
export interface GuiPreferences extends Partial<TextAppearance>, Partial<PanelWidths> {
  lastModel?: LastModel
  locale?: 'zh' | 'en'
  appearance?: 'light' | 'dark' | 'system'
  cwd?: string
  sessionId?: string
  sessionFile?: string
  collapsedProjects?: string[]
  pinnedSessions?: string[]
  archivedSessions?: string[]
}

/** Typed startup failures allow an explicit recovery action without interpreting display text. */
export class PiApiError extends Error {
  constructor(message: string, readonly code?: 'extension_startup') { super(message) }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options)
  const value: unknown = await response.json()
  if (!response.ok) {
    const error = typeof value === 'object' && value !== null && 'error' in value ? value.error : response.statusText
    const code = typeof value === 'object' && value !== null && 'code' in value && value.code === 'extension_startup' ? value.code : undefined
    throw new PiApiError(typeof error === 'string' ? error : JSON.stringify(error), code)
  }
  return value as T
}

function post<T>(path: string, body: object): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** Local application requests, independent of either agent SDK. */
export const api = {
  directories: (path?: string, signal?: AbortSignal): Promise<DirectoryListing> => request('/api/directories' + (path ? '?' + new URLSearchParams({ path }) : ''), { signal }),
  createDirectory: (path: string, name: string): Promise<{ path: string }> => post('/api/directories', { path, name }),
  localApplications: (signal?: AbortSignal): Promise<LocalApplicationsView> => request('/api/applications', { signal }),
  openPath: (value: FileActionRequest): Promise<FileActionResult> => post('/api/file-actions', value),
  createTerminal: (cwd: string): Promise<TerminalInfo> => post('/api/terminals', { cwd, path: '.' }),
  writeTerminal: (id: TerminalId, data: string): Promise<{ ok: true }> => post(`/api/terminals/${encodeURIComponent(id)}/write`, { data }),
  resizeTerminal: (id: TerminalId, cols: number, rows: number): Promise<{ ok: true }> => post(`/api/terminals/${encodeURIComponent(id)}/resize`, { cols, rows }),
  closeTerminal: (id: TerminalId): Promise<{ ok: true }> => post(`/api/terminals/${encodeURIComponent(id)}/close`, {}),
  projectGit: (cwd: string, signal?: AbortSignal): Promise<ProjectGitState> => request('/api/project-git?' + new URLSearchParams({ cwd }), { signal }),
  gitGraph: (cwd: string, skip: number, signal?: AbortSignal): Promise<GitGraphPage> => request('/api/project-git/graph?' + new URLSearchParams({ cwd, skip: String(skip) }), { signal }),
  changeGitBranch: (cwd: string, action: 'switch' | 'create', branch: string, revision: string): Promise<GitChangeResult> => post('/api/project-git?' + new URLSearchParams({ cwd }), { action, branch, revision }),
  readChat: (receipt: UnreadReceipt): Promise<{ items: UnreadChat[] }> => post('/api/unread', receipt),
  marketplace: (query: MarketplaceQuery, signal?: AbortSignal, refresh = false): Promise<MarketplacePage> => request('/api/package-catalog?' + new URLSearchParams({ ...query, page: String(query.page), refresh: String(refresh) }), { signal }),
  marketplaceDetail: (name: string, signal?: AbortSignal): Promise<MarketplaceDetail> => request('/api/package-catalog/detail?' + new URLSearchParams({ name }), { signal }),
  agentConfiguration: (cwd?: string): Promise<AgentConfigurationView> => request('/api/agent-configuration' + (cwd ? '?' + new URLSearchParams({ cwd }) : '')),
  updateAgentConfiguration: (value: AgentConfigurationAction, cwd?: string): Promise<AgentConfigurationView> => post('/api/agent-configuration' + (cwd ? '?' + new URLSearchParams({ cwd }) : ''), value),
  resourceDocument: (id: ResourceId, cwd?: string): Promise<ResourceDocument> => post('/api/agent-configuration' + (cwd ? '?' + new URLSearchParams({ cwd }) : ''), { action: 'read', resourceId: id }),
  projects: (): Promise<{ projects: Project[] }> => request('/api/projects'),
  addProject: (cwd: string): Promise<{ projects: Project[]; cwd?: string }> => post('/api/projects', { cwd }),
  updateProject: (cwd: string, action: 'rename' | 'remove', name?: string): Promise<{ projects: Project[] }> => post('/api/projects', { cwd, action, name }),
  sessions: (cwd?: string, signal?: AbortSignal): Promise<{ sessions: PiSessionSummary[] }> =>
    request('/api/sessions' + (cwd === undefined ? '' : `?cwd=${encodeURIComponent(cwd)}`), signal === undefined ? {} : { signal }),
  previewSession: (cwd: string, sessionPath: string): Promise<PiSnapshot | null> => post('/api/session-preview', { cwd, sessionPath }),
  open: (cwd: string, sessionPath?: string, extensionRecovery?: boolean): Promise<{ id: string }> => post('/api/sessions', { cwd, sessionPath, extensionRecovery }),
  reconnect: (id: string, extensionRecovery?: boolean): Promise<{ id: string }> => post(`/api/sessions/${encodeURIComponent(id)}/reconnect`, { extensionRecovery }),
  reload: (id: string): Promise<{ ok: true }> => post(`/api/sessions/${encodeURIComponent(id)}/reload`, {}),
  snapshot: (id: string): Promise<PiSnapshot> => request(`/api/sessions/${encodeURIComponent(id)}/snapshot`),
  command: (id: string, command: PiCommand): Promise<JsonValue | undefined> => post(`/api/sessions/${encodeURIComponent(id)}/command`, command),
  branch: (id: string, entryId: string, action: 'navigate' | 'fork'): Promise<{ ok: true }> => post(`/api/sessions/${encodeURIComponent(id)}/tree`, { entryId, action }),
  file: (id: string | null, path: string, cwd?: string, signal?: AbortSignal): Promise<FilePreview> => request('/api/files?' + new URLSearchParams({ ...(id === null ? { cwd: cwd ?? '' } : { sessionId: id }), path }), { signal }),
  fileTarget: (cwd: string, path: string): Promise<{ path: string; root: string; directory: boolean }> => post('/api/file-target', { cwd, path }),
  runtime: (): Promise<RuntimeConfig> => request('/api/runtime'),
  piSetup: (cwd?: string): Promise<{ commandLine: string; cwd: string }> => request('/api/pi-setup' + (cwd ? '?' + new URLSearchParams({ cwd }) : '')),
  saveRuntime: (value: { command: string; args: string[]; agentDir?: string }): Promise<RuntimeConfig> => post('/api/runtime', value),
  useBundledRuntime: (agentDir?: string): Promise<RuntimeConfig> => post('/api/runtime', { mode: 'bundled', agentDir }),
  preferences: (): Promise<GuiPreferences> => request('/api/preferences'),
  savePreferences: (value: GuiPreferences): Promise<GuiPreferences> => post('/api/preferences', value),
  providers: (cwd?: string): Promise<ProviderInventory> => request('/api/providers' + (cwd ? '?' + new URLSearchParams({ cwd }) : '')),
  loginProvider: (providerId: string, authType: ProviderAuthType, cwd?: string): Promise<ProviderAuthAttempt> => post('/api/providers/login', { providerId, authType, cwd }),
  replyProvider: async (id: string, promptId: string, value: string): Promise<ProviderAuthAttempt> => {
    await post<{ ok: true }>(`/api/providers/auth/${encodeURIComponent(id)}/reply`, { promptId, value })
    return request(`/api/providers/auth/${encodeURIComponent(id)}`)
  },
  cancelProvider: async (id: string): Promise<ProviderAuthAttempt> => {
    await post<{ ok: true }>(`/api/providers/auth/${encodeURIComponent(id)}/cancel`, {})
    return request(`/api/providers/auth/${encodeURIComponent(id)}`)
  },
  logoutProvider: (providerId: string, cwd?: string): Promise<{ ok: true }> => post('/api/providers/logout', { providerId, cwd }),
  customProvider: (value: CustomProvider, cwd?: string): Promise<{ ok: true }> => post('/api/providers/custom', { ...value, cwd }),
}

/** Follow Host-owned unread replies across all live chats, including chats absent from the screen. */
export function followUnread(accept: (items: UnreadChat[]) => void): () => void {
  const stream = new EventSource('/api/unread/events')
  stream.onmessage = event => {
    let frame: unknown
    try { frame = JSON.parse(event.data) }
    catch (error) { void error; return /* A malformed optional notification cannot interrupt the conversation. */ }
    if (isJsonObject(frame) && frame.type === 'unread' && Array.isArray(frame.items) && frame.items.every(isUnreadChat)) accept(frame.items)
  }
  return () => { stream.onmessage = null; stream.close() }
}

/** Subscribe to authoritative complete Pi snapshots.
 * @param id - Host process/session identity.
 * @param accept - Snapshot publication callback.
 * @param connected - Connection status callback.
 * @returns Cleanup closing the browser's stream.
 */
export function follow(id: string, accept: (snapshot: PiSnapshot) => void, connected: (value: boolean) => void): () => void {
  const stream = new EventSource(`/api/sessions/${encodeURIComponent(id)}/events`)
  stream.onopen = () => { connected(true) }
  stream.onerror = () => { connected(false) }
  stream.onmessage = event => {
    const frame: { type: string; snapshot?: PiSnapshot } = JSON.parse(event.data)
    if (frame.type === 'snapshot' && frame.snapshot !== undefined) accept(frame.snapshot)
  }
  return () => { stream.onopen = null; stream.onerror = null; stream.onmessage = null; stream.close() }
}

/** Follow one Pi-owned login interaction without retaining any entered credential.
 * @param id - Host login attempt identity.
 * @param accept - Safe interaction state consumer.
 * @returns Cleanup closing the attempt stream.
 */
export function followProviderAuth(id: string, accept: (attempt: ProviderAuthAttempt) => void): () => void {
  const stream = new EventSource(`/api/providers/auth/${encodeURIComponent(id)}/events`)
  stream.onmessage = event => {
    const frame: { type: string; attempt?: ProviderAuthAttempt } = JSON.parse(event.data)
    if (frame.type === 'provider_auth' && frame.attempt !== undefined) accept(frame.attempt)
  }
  return () => { stream.close() }
}
