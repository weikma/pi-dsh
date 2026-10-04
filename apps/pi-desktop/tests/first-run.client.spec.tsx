/** Keyboard, IME and asynchronous readiness regressions for a pristine GUI. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../client/App.tsx'
import { api, PiApiError } from '../client/http.ts'
import type { PiSnapshot, PiSessionSummary } from '../bridge/types.ts'
import type { ProviderAuthAttempt } from '../bridge/provider-job.ts'
import type { PackageId, ResourceId } from '../bridge/agent-types.ts'
import { ProvidersPanel } from '../client/ProvidersPanel.tsx'
import { translate } from '../client/i18n.ts'

/** Vitest's owned jsdom window supplies DOM storage instead of Node's experimental storage global. */
declare global { var jsdom: { window: { localStorage: Storage } } }

const project = { cwd: '/test/project', name: 'Project' }
let snapshots = new Map<string, PiSnapshot>()
let authAttempts = new Map<string, ProviderAuthAttempt>()
let finishRequests: (() => void)[] = []
let streams: SnapshotStream[] = []

function snapshot(id = 'host-1', models: PiSnapshot['models'] = []): PiSnapshot {
  return { sessionId: id, state: { sessionId: 'native-pi', sessionFile: '/test/session.jsonl', thinkingLevel: 'off', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 0 },
    messages: [], entries: [], models, commands: [], thinkingLevels: ['off'], pendingUI: [], steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {} }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

class SnapshotStream {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  private closed = false
  constructor(url: string) {
    if (url === '/api/unread/events') return
    streams.push(this)
    const auth = url.startsWith('/api/providers/auth/')
    const id = decodeURIComponent(url.split('/')[auth ? 4 : 3] ?? '')
    queueMicrotask(() => {
      if (this.closed) return
      this.onopen?.(new Event('open'))
      if (auth) {
        const attempt = authAttempts.get(id)
        if (attempt !== undefined) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'provider_auth', attempt }) }))
      } else {
        const value = snapshots.get(id)
        if (value !== undefined) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: value }) }))
      }
    })
  }
  close() { this.closed = true }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', jsdom.window.localStorage)
  localStorage.clear()
  snapshots = new Map([['host-1', snapshot()]])
  authAttempts = new Map()
  finishRequests = []
  streams = []
  vi.stubGlobal('EventSource', SnapshotStream)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('innerWidth', 1280)
  delete window.piDesktop
  vi.spyOn(api, 'preferences').mockResolvedValue({ locale: 'en' })
  vi.spyOn(api, 'savePreferences').mockResolvedValue({})
  vi.spyOn(api, 'projectGit').mockResolvedValue({ kind: 'not-repository' })
  vi.spyOn(api, 'projects').mockResolvedValue({ projects: [] })
  vi.spyOn(api, 'addProject').mockResolvedValue({ projects: [project] })
  vi.spyOn(api, 'sessions').mockResolvedValue({ sessions: [] })
  vi.spyOn(api, 'previewSession').mockResolvedValue(null)
  vi.spyOn(api, 'open').mockResolvedValue({ id: 'host-1' })
  vi.spyOn(api, 'snapshot').mockImplementation(async id => snapshots.get(id) ?? snapshot(id))
  vi.spyOn(api, 'command').mockResolvedValue(undefined)
  vi.spyOn(api, 'piSetup').mockResolvedValue({ commandLine: '/runtime/node /runtime/pi', cwd: project.cwd })
  vi.spyOn(api, 'reconnect').mockResolvedValue({ id: 'host-2' })
  vi.spyOn(api, 'reload').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'runtime').mockResolvedValue({ command: '/runtime/node', args: ['/runtime/pi'], configured: true })
  vi.spyOn(api, 'agentConfiguration').mockResolvedValue({ sdkVersion: '0.99.1', agentDir: '/test/.pi/agent', cwd: project.cwd, preferences: { defaultModel: '', defaultProvider: '', thinking: 'medium', steering: 'one-at-a-time', followUp: 'one-at-a-time', compaction: true, retry: true, autoResize: true, blockImages: false, skillCommands: true }, projectTrusted: false, overridden: [], resources: [], packages: [], packageManagement: true, mcp: [], revision: 'one' })
  vi.spyOn(api, 'marketplace').mockResolvedValue({ packages: [], total: 0, page: 1, hasNext: false, url: 'https://pi.dev/packages?type=skill' })
  vi.spyOn(api, 'marketplaceDetail').mockResolvedValue({ name: 'example-skill', version: '1.2.3', description: 'Skill workflow', license: 'MIT', resources: [{ type: 'skill', paths: ['./skills'] }], url: 'https://pi.dev/packages/example-skill' })
  vi.spyOn(api, 'providers').mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [], models: [], extensionProvidersSupported: false, limitations: [] })
  vi.spyOn(api, 'loginProvider').mockResolvedValue({ id: 'login-1', providerId: 'configured', authType: 'api_key', status: 'waiting', prompt: { id: 'key-1', type: 'secret', message: 'Enter API key' } })
  vi.spyOn(api, 'replyProvider').mockResolvedValue({ id: 'login-1', providerId: 'configured', authType: 'api_key', status: 'complete' })
  vi.spyOn(api, 'cancelProvider').mockResolvedValue({ id: 'login-1', providerId: 'configured', authType: 'oauth', status: 'cancelled' })
  vi.spyOn(api, 'logoutProvider').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'customProvider').mockResolvedValue({ ok: true })
})

afterEach(() => {
  for (const finish of finishRequests) finish()
  cleanup()
  vi.useRealTimers()
  delete window.piDesktop
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function launch() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'New chat' })
  return { user, input: screen.getByRole('textbox', { name: 'Ask pi to work on your project…' }) as HTMLTextAreaElement }
}

it('restores panel widths, resizes with keys and retains saved sizes across collapse and small windows', async () => {
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', sidebarWidth: 320, workspaceWidth: 480 })
  const { user } = await launch()
  const history = screen.getByRole('separator', { name: 'Resize conversation history' })
  expect(history.getAttribute('aria-valuenow')).toBe('320')
  fireEvent.keyDown(history, { key: 'ArrowRight' })
  await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith({ sidebarWidth: 336 }))
  await user.click(screen.getByRole('button', { name: 'Files' }))
  const workspace = screen.getByRole('separator', { name: 'Resize workspace panel' })
  expect(workspace.getAttribute('aria-valuenow')).toBe('480')
  fireEvent.keyDown(workspace, { key: 'ArrowLeft' })
  expect(workspace.getAttribute('aria-valuenow')).toBe('496')
  fireEvent.keyDown(workspace, { key: 'Home' })
  expect(workspace.getAttribute('aria-valuenow')).toBe('240')
  fireEvent.keyDown(history, { key: 'Home' })
  expect(history.getAttribute('aria-valuenow')).toBe('264')
  fireEvent.keyDown(history, { key: 'ArrowRight' })
  await user.click(screen.getByRole('button', { name: 'Hide sidebar' }))
  expect(screen.queryByRole('separator', { name: 'Resize conversation history' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
  expect(screen.getByRole('separator', { name: 'Resize conversation history' }).getAttribute('aria-valuenow')).toBe('280')
  fireEvent.keyDown(workspace, { key: 'End' })
  await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith({ workspaceWidth: 640 }))
  vi.mocked(api.savePreferences).mockClear()
  vi.stubGlobal('innerWidth', 500)
  fireEvent(window, new Event('resize'))
  expect(workspace.getAttribute('aria-valuenow')).toBe('452')
  vi.stubGlobal('innerWidth', 1280)
  fireEvent(window, new Event('resize'))
  expect(workspace.getAttribute('aria-valuenow')).toBe('640')
  expect(api.savePreferences).not.toHaveBeenCalled()
})

it('drags both panel edges, clamps their minima and cancels without saving on Escape or lost capture', async () => {
  const { user, input } = await launch()
  await user.type(input, 'Keep this draft')
  await user.click(screen.getByRole('button', { name: 'Files' }))
  for (const [name, start, move, expected, key] of [
    ['Resize conversation history', 280, 350, 350, 'sidebarWidth'],
    ['Resize workspace panel', 860, 790, 490, 'workspaceWidth'],
  ] as const) {
    const handle = screen.getByRole('separator', { name })
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() })
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x })
      Object.defineProperty(event, 'pointerId', { value: 7 })
      fireEvent(handle, event)
    }
    vi.mocked(api.savePreferences).mockClear()
    pointer('pointerdown', start); pointer('pointermove', move)
    expect(handle.getAttribute('aria-valuenow')).toBe(String(expected))
    expect(api.savePreferences).not.toHaveBeenCalled()
    pointer('pointerup', move)
    await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith({ [key]: expected }))
    vi.mocked(api.savePreferences).mockClear()
    pointer('pointerdown', move); pointer('pointermove', name.includes('history') ? -100 : 2000)
    expect(handle.getAttribute('aria-valuenow')).toBe(name.includes('history') ? '264' : '240')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handle.getAttribute('aria-valuenow')).toBe(String(expected))
    expect(api.savePreferences).not.toHaveBeenCalled()
    pointer('pointerdown', move); pointer('pointermove', move + 30)
    fireEvent(handle, new Event('lostpointercapture', { bubbles: true }))
    expect(handle.getAttribute('aria-valuenow')).toBe(String(expected))
    expect(api.savePreferences).not.toHaveBeenCalled()
  }
  expect(input.value).toBe('Keep this draft')
})

function existingProject() {
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', cwd: project.cwd })
  vi.mocked(api.projects).mockResolvedValue({ projects: [project] })
}

function resumedSession() {
  existingProject()
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', cwd: project.cwd, sessionId: 'native-pi', sessionFile: '/test/session.jsonl' })
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Chat', modified: '2026-09-30T00:00:00Z', messageCount: 0 }] })
}

it.each(['isStreaming', 'isCompacting'] as const)('reuses Send as Stop during %s and preserves a draft when stopping', async state => {
  resumedSession()
  const { user, input } = await launch()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Session branches' }).hasAttribute('disabled')).toBe(false))
  const send = screen.getByRole('button', { name: 'Send message' })
  const update = async (value: PiSnapshot) => {
    snapshots.set('host-1', value)
    await act(async () => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: value }) })) })
  }
  const active = snapshot(); active.state[state] = true
  await update(active)
  expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Stop' })).toBe(send)
  expect(send.getAttribute('type')).toBe('button')
  expect(send.getAttribute('aria-keyshortcuts')).toBe('Escape')
  expect(send.hasAttribute('disabled')).toBe(false)
  await user.type(input, 'Keep this draft')
  await user.click(send)
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'abort' }))
  expect(api.command).toHaveBeenCalledTimes(1)
  expect(input.value).toBe('Keep this draft')
  await update(snapshot())
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Send message' })).toBe(send)
  expect(send.getAttribute('type')).toBe('submit')
  expect(send.hasAttribute('disabled')).toBe(false)
  await user.click(input)
  await user.keyboard('{Escape}')
  expect(api.command).toHaveBeenCalledTimes(1)
  await update(active)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
  expect(api.command).toHaveBeenLastCalledWith('host-1', { type: 'abort' })
  expect(input.value).toBe('Keep this draft')
})

it('keeps Enter available for queued input while the composer button remains Stop', async () => {
  resumedSession()
  const active = snapshot(); active.state.isStreaming = true
  snapshots.set('host-1', active)
  const { user, input } = await launch()
  const stop = await screen.findByRole('button', { name: 'Stop' })
  await user.type(input, 'Follow up after this{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Follow up after this', streamingBehavior: 'followUp' }))
  expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Stop' })).toBe(stop)
  expect(input.value).toBe('')
})

describe('First-run readiness', () => {
  it('preserves a collapsed Working section across startup, native receipt and tool streaming', async () => {
    existingProject()
    const opening = deferred<{ id: string }>()
    const command = deferred<undefined>()
    finishRequests.push(() => { opening.resolve({ id: 'host-1' }); command.resolve(undefined) })
    vi.mocked(api.open).mockReturnValue(opening.promise)
    vi.mocked(api.command).mockReturnValue(command.promise)
    const { user, input } = await launch()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(1000)
    await user.type(input, 'Keep progress collapsed{Enter}')
    act(() => { vi.advanceTimersByTime(1000) })
    const header = await screen.findByRole('button', { name: /^Working for / })
    await user.click(header)
    opening.resolve({ id: 'host-1' })
    await waitFor(() => expect(api.command).toHaveBeenCalled())
    const native = { ...snapshot(), state: { ...snapshot().state, isStreaming: true }, messages: [
      { role: 'user', content: 'Keep progress collapsed', timestamp: 1000 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a.ts' } }] },
    ] }
    await act(async () => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: native }) })) })
    expect(screen.getByRole('button', { name: /^Working for / })).toBe(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(within(screen.getByRole('log', { name: 'Conversation' })).getAllByText('Keep progress collapsed')).toHaveLength(1)
    expect(screen.queryByText('Sending…')).toBeNull()
  })

  it('shows the first message before Pi startup completes and captures it before later edits', async () => {
    existingProject()
    const opening = deferred<{ id: string }>()
    finishRequests.push(() => { opening.resolve({ id: 'host-1' }) })
    vi.mocked(api.open).mockReturnValue(opening.promise)
    const { user, input } = await launch()
    await user.type(input, 'Start this task')
    await user.keyboard('{Enter}')
    const log = await screen.findByRole('log', { name: 'Conversation' })
    expect(within(log).getByText('Start this task')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Project' })).getByText('Start this task')).toBeTruthy()
    expect(input.value).toBe('')
    expect(api.command).not.toHaveBeenCalled()
    await user.type(input, 'A later draft')
    opening.resolve({ id: 'host-1' })
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Start this task' }))
    expect(input.value).toBe('A later draft')
  })

  it('restores a rejected first message and keeps text typed while Pi starts', async () => {
    existingProject()
    const opening = deferred<{ id: string }>()
    finishRequests.push(() => { opening.resolve({ id: 'host-1' }) })
    vi.mocked(api.open).mockReturnValue(opening.promise)
    vi.mocked(api.command).mockRejectedValue(new Error('No model configured'))
    const { user, input } = await launch()
    await user.type(input, 'Original request{Enter}')
    await screen.findByRole('log')
    await user.type(input, 'Additional context')
    opening.resolve({ id: 'host-1' })
    await waitFor(() => expect(input.value).toBe('Original request\n\nAdditional context'))
    expect(screen.queryByText(/^Working for /)).toBeNull()
  })

  it('replaces the pending bubble with the native user event without duplicating the message', async () => {
    existingProject()
    const pending = deferred<undefined>()
    finishRequests.push(() => { pending.resolve(undefined) })
    vi.mocked(api.command).mockReturnValue(pending.promise)
    const { user, input } = await launch()
    await user.type(input, 'Native receipt{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalled())
    const native = { ...snapshot(), messages: [{ role: 'user', content: 'Native receipt' }] }
    await act(async () => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: native }) })) })
    expect(within(screen.getByRole('log', { name: 'Conversation' })).getAllByText('Native receipt')).toHaveLength(1)
    expect(screen.queryByText('Sending…')).toBeNull()
    snapshots.set('host-1', native)
    pending.resolve(undefined)
    await waitFor(() => expect(within(screen.getByRole('log', { name: 'Conversation' })).getAllByText('Native receipt')).toHaveLength(1))
  })

  it('does not send a first request into another chat selected during startup', async () => {
    resumedSession()
    const opening = deferred<{ id: string }>()
    finishRequests.push(() => { opening.resolve({ id: 'host-2' }) })
    vi.mocked(api.open).mockImplementation(async (_cwd, path) => path ? { id: 'host-1' } : opening.promise)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    await user.type(input, 'Cancelled startup request{Enter}')
    await within(screen.getByRole('log', { name: 'Conversation' })).findByText('Cancelled startup request')
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    await waitFor(() => expect(api.open).toHaveBeenLastCalledWith(project.cwd, '/test/session.jsonl'))
    opening.resolve({ id: 'host-2' })
    await waitFor(() => expect(screen.queryByText(/^Working for /)).toBeNull())
    expect(api.command).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(input.value).toBe('')
  })

  it('admits one prompt when Enter repeats before Pi startup acknowledges the first submission', async () => {
    existingProject()
    const opening = deferred<{ id: string }>()
    finishRequests.push(() => { opening.resolve({ id: 'host-1' }) })
    vi.mocked(api.open).mockReturnValue(opening.promise)
    const { user, input } = await launch()
    await user.type(input, 'One request')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1))
    opening.resolve({ id: 'host-1' })
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))
  })

  it('accepts genuine keyboard input with no project, session, or authentication', async () => {
    const { user, input } = await launch()
    await user.type(input, 'First draft')
    expect(input.value).toBe('First draft')
    expect(input.disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(await screen.findByText('Configure models in Settings → Models and providers.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input.value).toBe('First draft')
  })

  it('retains a typed message through project selection and sends it to the actual opened handle', async () => {
    const { user, input } = await launch()
    await user.type(input, 'Ship this change')
    await user.keyboard('{Enter}')
    const chooser = await screen.findByRole('dialog', { name: 'Add project' })
    expect(input.value).toBe('Ship this change')
    await user.type(within(chooser).getByRole('textbox', { name: 'Project directory' }), project.cwd)
    await user.click(within(chooser).getByRole('button', { name: 'Open project' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Ship this change' }))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('keeps new keyboard edits while a prior native prompt acknowledgement is pending', async () => {
    existingProject()
    const pending = deferred<undefined>()
    finishRequests.push(() => { pending.resolve(undefined) })
    vi.mocked(api.command).mockImplementation(async (_id, command) => command.type === 'prompt' ? pending.promise : undefined)
    const { user, input } = await launch()
    await user.type(input, 'First request')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'First request' }))
    expect(input.disabled).toBe(false)
    await user.clear(input)
    await user.type(input, 'Second draft')
    pending.resolve(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false))
    expect(input.value).toBe('Second draft')
  })

  it('preserves edits made before asynchronous session restoration completes', async () => {
    resumedSession()
    const pending = deferred<{ sessions: PiSessionSummary[] }>()
    const sessions = [{ id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Chat', modified: '2026-09-30T00:00:00Z', messageCount: 0 }]
    finishRequests.push(() => { pending.resolve({ sessions }) })
    vi.mocked(api.sessions).mockReturnValue(pending.promise)
    const { user, input } = await launch()
    await user.type(input, 'Keep my draft')
    pending.resolve({ sessions })
    await waitFor(() => expect(api.open).toHaveBeenCalledWith(project.cwd, '/test/session.jsonl'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Session branches' }).hasAttribute('disabled')).toBe(false))
    expect(input.value).toBe('Keep my draft')
  })

  it('does not send Enter while an IME composition is active', async () => {
    const { input } = await launch()
    input.focus()
    fireEvent.compositionStart(input)
    fireEvent.compositionUpdate(input, { data: '中文' })
    fireEvent.input(input, { target: { value: '中文' }, inputType: 'insertCompositionText', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })
    expect(api.open).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull()
    expect(input.value).toBe('中文')
    fireEvent.compositionEnd(input, { data: '中文' })
  })

  it('offers native Pi configuration for an empty model list instead of an invisible menu', async () => {
    existingProject()
    const unavailable = snapshot()
    unavailable.state.model = { id: 'unknown', provider: 'unknown', name: 'unknown' }
    snapshots.set('host-1', unavailable)
    const openPiTerminal = vi.fn(async () => {})
    window.piDesktop = { platform: 'darwin', pickDirectory: async () => project.cwd, openExternal: async () => {}, openPiTerminal }
    const { user, input } = await launch()
    await user.type(input, 'Keep this draft')
    const modelButton = screen.getByRole('button', { name: 'Model' })
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(modelButton.textContent).toContain('Choose model')
    expect(modelButton.textContent).not.toContain('unknown')
    expect(within(dialog).getByText('Providers registered by Pi extensions require setup in the Pi terminal. Conversations still load your Pi extensions.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Open Pi terminal' }))
    expect(openPiTerminal).toHaveBeenCalledWith(project.cwd)
    expect(input.value).toBe('Keep this draft')
  })

  it('refreshes credentials through a fresh public Pi handle and preserves the draft until model selection', async () => {
    resumedSession()
    snapshots.set('host-2', snapshot('host-2', [{ id: 'available', provider: 'configured', name: 'Available model' }]))
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, 'Keep this request')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(dialog).getByRole('button', { name: 'Refresh models' }))
    await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith('host-1'))
    await user.click(await screen.findByRole('menuitem', { name: 'configured · 1 models' }))
    const model = await screen.findByRole('menuitem', { name: /Available model/ })
    expect(input.value).toBe('Keep this request')
    await user.click(model)
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-2', { type: 'set_model', provider: 'configured', modelId: 'available' }))
    expect(input.value).toBe('Keep this request')
  })

  it('explains the busy refresh restriction without reconnecting an active agent', async () => {
    resumedSession()
    const active = snapshot()
    active.state.isStreaming = true
    snapshots.set('host-1', active)
    const { user } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('button', { name: 'Refresh models' }).hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByText('Finish the current task, queued messages, and Pi dialogs before refreshing models.')).toBeTruthy()
    expect(api.reconnect).not.toHaveBeenCalled()
  })

  it('reads configured models without a project and applies an explicit choice before sending', async () => {
    const model = { provider: 'configured', id: 'available', name: 'Available model' }
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', defaultModel: model, providers: [], models: [model], extensionProvidersSupported: false, limitations: [] })
    const { user, input } = await launch()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('Available model'))
    expect(api.open).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(await screen.findByRole('menuitem', { name: 'configured · 1 models' }))
    await user.click(await screen.findByRole('menuitem', { name: /Available model/ }))
    await user.type(input, 'Use my model')
    await user.keyboard('{Enter}')
    const chooser = await screen.findByRole('dialog', { name: 'Add project' })
    await user.type(within(chooser).getByRole('textbox', { name: 'Project directory' }), project.cwd)
    await user.click(within(chooser).getByRole('button', { name: 'Open project' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Use my model' }))
    const commands = vi.mocked(api.command).mock.calls.map(([, command]) => command.type)
    expect(commands.indexOf('set_model')).toBeLessThan(commands.indexOf('prompt'))
    expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_model', provider: 'configured', modelId: 'available' })
  })

  it('submits a write-only password prompt to Pi and keeps the conversation draft', async () => {
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [{ id: 'configured', name: 'Provider', authTypes: ['api_key'], authStatus: { configured: true }, modelCount: 1 }], models: [], extensionProvidersSupported: false, limitations: [] })
    const { user, input } = await launch()
    await user.type(input, 'Do not clear this')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(await within(dialog).findByRole('button', { name: 'API key' }))
    const key = await within(dialog).findByLabelText('Enter API key') as HTMLInputElement
    expect(key.type).toBe('password')
    expect(key.value).toBe('')
    await user.type(key, 'test-key-new')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.replyProvider).toHaveBeenCalledWith('login-1', 'key-1', 'test-key-new'))
    await waitFor(() => expect(within(dialog).queryByLabelText('Enter API key')).toBeNull())
    expect(dialog.textContent).not.toContain('test-key-new')
    expect(Object.keys(localStorage).map(key => localStorage.getItem(key)).join(' ')).not.toContain('test-key-new')
    expect(input.value).toBe('Do not clear this')
    expect(api.open).not.toHaveBeenCalled()
  })

  it('shows native OAuth browser instructions and cancels the owned login when dismissed', async () => {
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [{ id: 'configured', name: 'Provider', authTypes: ['oauth'], authStatus: { configured: false }, modelCount: 0 }], models: [], extensionProvidersSupported: false, limitations: [] })
    vi.mocked(api.loginProvider).mockResolvedValue({ id: 'oauth-1', providerId: 'configured', authType: 'oauth', status: 'working' })
    authAttempts.set('oauth-1', { id: 'oauth-1', providerId: 'configured', authType: 'oauth', status: 'waiting', authUrl: 'https://provider.example.test/login', userCode: 'SAFE-CODE', instructions: 'Finish in your browser' })
    const openExternal = vi.fn(async () => {})
    window.piDesktop = { platform: 'darwin', pickDirectory: async () => null, openExternal }
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(await within(dialog).findByRole('button', { name: 'Sign in' }))
    expect(await within(dialog).findByText('SAFE-CODE')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Open sign-in page' }))
    expect(openExternal).toHaveBeenCalledWith('https://provider.example.test/login')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(api.cancelProvider).toHaveBeenCalledWith('oauth-1'))
  })

  it('writes a compatible endpoint without credentials and starts the native key prompt', async () => {
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(dialog).getByText('Add compatible provider'))
    await user.type(within(dialog).getByRole('textbox', { name: 'Provider ID' }), 'custom')
    await user.type(within(dialog).getByRole('textbox', { name: 'Base URL' }), 'https://compatible.example.test/v1')
    await user.type(within(dialog).getByRole('textbox', { name: 'Model ID' }), 'custom-model')
    await user.click(within(dialog).getByRole('button', { name: 'Save endpoint and add key' }))
    await waitFor(() => expect(api.customProvider).toHaveBeenCalledWith({ providerId: 'custom', baseUrl: 'https://compatible.example.test/v1', api: 'openai-completions', models: [{ id: 'custom-model' }] }, undefined))
    await waitFor(() => expect(api.loginProvider).toHaveBeenCalledWith('custom', 'api_key', undefined))
    expect(await within(dialog).findByLabelText('Enter API key')).toBeTruthy()
    expect(api.open).not.toHaveBeenCalled()
  })

  it('cancels a login that becomes ready after its panel has closed', async () => {
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [{ id: 'configured', name: 'Provider', authTypes: ['oauth'], authStatus: { configured: false }, modelCount: 0 }], models: [], extensionProvidersSupported: false, limitations: [] })
    const pending = deferred<ProviderAuthAttempt>()
    const attempt: ProviderAuthAttempt = { id: 'late-1', providerId: 'configured', authType: 'oauth', status: 'working' }
    finishRequests.push(() => { pending.resolve(attempt) })
    vi.mocked(api.loginProvider).mockReturnValue(pending.promise)
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(await within(dialog).findByRole('button', { name: 'Sign in' }))
    await user.keyboard('{Escape}')
    pending.resolve(attempt)
    await waitFor(() => expect(api.cancelProvider).toHaveBeenCalledWith('late-1'))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('keeps a running Pi session alive after provider setup and offers an idle refresh', async () => {
    resumedSession()
    const active = snapshot(); active.state.isStreaming = true; snapshots.set('host-1', active)
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [{ id: 'configured', name: 'Provider', authTypes: ['api_key'], authStatus: { configured: false }, modelCount: 0 }], models: [], extensionProvidersSupported: false, limitations: [] })
    const { user } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(await within(dialog).findByRole('button', { name: 'API key' }))
    await user.type(await within(dialog).findByLabelText('Enter API key'), 'test-key')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(await within(dialog).findByText('Provider configuration saved. Finish the current task and Pi dialogs, then refresh models to use it in this chat.')).toBeTruthy()
    expect(api.reconnect).not.toHaveBeenCalled()
    expect(api.command).not.toHaveBeenCalledWith('host-1', { type: 'abort' })
  })

  it('prioritizes configured providers and searches the separate add catalog', async () => {
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [
      { id: 'alpha', name: 'Alpha provider', authTypes: ['api_key'], authStatus: { configured: false }, modelCount: 1 },
      { id: 'existing', name: 'Existing provider', authTypes: ['api_key'], authStatus: { configured: true }, modelCount: 2 },
      { id: 'beta', name: 'Beta provider', authTypes: ['api_key'], authStatus: { configured: false }, modelCount: 1 },
    ], models: [], extensionProvidersSupported: false, limitations: [] })
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    const configured = await within(dialog).findByRole('list', { name: 'Configured providers' })
    expect(within(configured).getByText('Existing provider')).toBeTruthy()
    expect(within(configured).queryByText('Alpha provider')).toBeNull()
    const summary = within(dialog).getByText('Add provider')
    const disclosure = summary.closest('details') as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    expect(configured.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(summary)
    await user.type(within(disclosure).getByRole('textbox', { name: 'Search providers' }), 'beta')
    expect(within(disclosure).queryByText('Alpha provider')).toBeNull()
    expect(within(disclosure).getByText('Beta provider')).toBeTruthy()
    await user.click(within(disclosure).getByRole('button', { name: 'API key' }))
    expect(api.loginProvider).toHaveBeenCalledWith('beta', 'api_key', undefined)
  })

  it('expands provider models, searches names and IDs, and keeps unavailable models read-only', async () => {
    const user = userEvent.setup(), selectModel = vi.fn(async () => {}), feedback = vi.fn()
    const models = Array.from({ length: 10 }, (_, index) => ({ provider: 'gateway', id: `model-${index}`, name: `Model ${index}` }))
    render(<ProvidersPanel inventory={{ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [
      { id: 'gateway', name: 'Gateway', authTypes: ['api_key'], authStatus: { configured: true }, modelCount: 10, models },
      { id: 'empty', name: 'Empty', authTypes: [], authStatus: { configured: true }, modelCount: 0, models: [] },
    ], models: models.slice(0, 9), extensionProvidersSupported: false, limitations: [] }} loading={false} error="" t={(key, values) => translate('en', key, values)} refresh={async () => {}} changed={async () => {}} selectModel={selectModel} feedback={feedback} />)
    const cards = screen.getByRole('list', { name: 'Configured providers' })
    expect(within(cards).queryByRole('button', { name: 'Use Model 0' })).toBeNull()
    await user.click(within(cards).getByText('Gateway'))
    const group = within(cards).getByRole('group', { name: 'Models for Gateway' })
    expect(within(group).getAllByRole('button')).toHaveLength(10)
    expect((within(group).getByRole('button', { name: 'Use Model 9' }) as HTMLButtonElement).disabled).toBe(true)
    const search = within(cards).getByRole('textbox', { name: 'Search Gateway models' })
    await user.type(search, 'model-2')
    expect(within(group).getAllByRole('button')).toHaveLength(1)
    await user.click(within(group).getByRole('button', { name: 'Use Model 2' }))
    expect(selectModel).toHaveBeenCalledWith(models[2])
    await user.clear(search); await user.type(search, 'no-such-model')
    expect(within(cards).getByText('No matching models')).toBeTruthy()
    await user.click(within(cards).getByText('Gateway'))
    expect(within(cards).queryByRole('group', { name: 'Models for Gateway' })).toBeNull()
    await user.click(within(cards).getByText('Empty'))
    expect(within(cards).getByText('Pi has no registered models for this provider.')).toBeTruthy()
  })

  it('shows the active chat catalog including extension models instead of the worker subset', async () => {
    resumedSession()
    const model = { provider: 'litellm', id: 'discovered-model', name: 'Discovered model' }
    snapshots.set('host-1', snapshot('host-1', [model, { provider: 'extension-only', id: 'extra', name: 'Extra model' }]))
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [
      { id: 'litellm', name: 'LiteLLM', authTypes: ['api_key'], authStatus: { configured: true }, modelCount: 1, models: [{ provider: 'litellm', id: 'static-model', name: 'Static model' }] },
    ], models: [{ provider: 'litellm', id: 'static-model', name: 'Static model' }], extensionProvidersSupported: false, limitations: [] })
    const { user } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Models and providers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    const cards = await within(dialog).findByRole('list', { name: 'Configured providers' })
    await user.click(within(cards).getByText('LiteLLM'))
    expect(within(cards).queryByText('Static model')).toBeNull()
    expect(within(cards).getByText('From the current Pi chat, including its loaded extensions')).toBeTruthy()
    expect(within(cards).getByText('extension-only')).toBeTruthy()
    await user.click(within(cards).getByRole('button', { name: 'Use Discovered model' }))
    expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_model', provider: 'litellm', modelId: 'discovered-model' })
  })

  it('localizes provider limitations instead of rendering backend implementation prose', async () => {
    vi.mocked(api.preferences).mockResolvedValue({ locale: 'zh' })
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/.pi/agent', sdkVersion: '0.99.1', providers: [], models: [], extensionProvidersSupported: false,
      limitationCodes: ['extension_providers', 'api_key_override'], limitations: ['Provider extensions and project-specific registrations are managed by native Pi setup.', 'The selected --api-key overrides stored credentials for its provider.'] })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('button', { name: '模型与服务商' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(await within(dialog).findByText('当前运行时通过启动参数提供 API 密钥，将覆盖对应服务商已保存的凭据')).toBeTruthy()
    expect(dialog.textContent).not.toContain('Provider extensions and project-specific registrations')
    expect(dialog.textContent).not.toContain('The selected --api-key')
  })
})


describe('Desktop navigation and files', () => {
  it('routes supported TUI shortcuts to GUI controls and public RPC instead of a model prompt', async () => {
    resumedSession()
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/name Verification chat')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_session_name', name: 'Verification chat' }))
    await waitFor(() => expect(input.value).toBe(''))
    await user.type(input, '/compact Keep file results')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'compact', customInstructions: 'Keep file results' }))
    await waitFor(() => expect(input.value).toBe(''))
    await user.type(input, '/tree')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Session branches' })).toBeTruthy()
    expect(vi.mocked(api.command).mock.calls.some(([, command]) => command.type === 'prompt')).toBe(false)
  })

  it('highlights the current visible history entry when Pi adds a rename record at the leaf', async () => {
    resumedSession()
    const value = snapshot()
    value.entries = [
      { id: 'reply', type: 'message', parentId: null, message: { role: 'assistant', content: 'Current answer' } },
      { id: 'rename', type: 'session_info', parentId: 'reply', name: 'Renamed chat' },
    ]
    value.leafId = 'rename'
    snapshots.set('host-1', value)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/tree')
    await user.keyboard('{Enter}')
    const tree = await screen.findByRole('dialog', { name: 'Session branches' })
    expect(within(tree).getByText('Pi · Current position')).toBeTruthy()
  })

  it('preserves Pi-registered commands that share a GUI shortcut name', async () => {
    resumedSession()
    snapshots.set('host-1', { ...snapshot(), commands: [{ name: 'model', source: 'extension', description: 'Native command' }] })
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/model')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: '/model' }))
  })

  it('uses native model IDs and validates thinking levels without sending a prompt', async () => {
    resumedSession()
    const value = snapshot('host-1', [{ provider: 'configured', id: 'family/model', name: 'Available model' }])
    value.thinkingLevels = ['off', 'low', 'high']
    snapshots.set('host-1', value)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/model configured/family/model{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_model', provider: 'configured', modelId: 'family/model' }))
    await user.type(input, '/thinking high{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_thinking_level', level: 'high' }))
    await user.type(input, '/thinking impossible{Enter}')
    expect(await screen.findByText('Choose a supported thinking level: off, low, high')).toBeTruthy()
    expect(input.value).toBe('/thinking impossible')
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
    await user.clear(input)
    await user.type(input, '/thinking {Enter}')
    expect(await screen.findByRole('menuitem', { name: 'High' })).toBeTruthy()
  })

  it('reads session statistics and the last reply through Pi instead of reconstructing totals', async () => {
    resumedSession()
    vi.mocked(api.command).mockImplementation(async (_id, command) => {
      if (command.type === 'get_last_assistant_text') return { text: 'Native last reply' }
      if (command.type === 'get_session_stats') return { sessionId: 'native-pi', sessionFile: '/test/session.jsonl', totalMessages: 17, userMessages: 3, assistantMessages: 4, toolCalls: 5, tokens: { total: 1200 }, cost: 0.0125, contextUsage: { percent: null } }
      return undefined
    })
    const { user, input } = await launch()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/copy {Enter}')
    await waitFor(() => expect(write).toHaveBeenCalledWith('Native last reply'))
    await user.type(input, '/session {Enter}')
    const modal = await screen.findByRole('dialog', { name: 'Session information' })
    expect(within(modal).getByText('17')).toBeTruthy()
    expect(within(modal).getByText('1200')).toBeTruthy()
    expect(within(modal).getByText('$0.0125')).toBeTruthy()
    expect(within(modal).getByText('/test/session.jsonl')).toBeTruthy()
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
  })

  it('keeps the copy command available after an empty reply or clipboard failure', async () => {
    resumedSession()
    vi.mocked(api.command).mockResolvedValue({ text: null })
    const { user, input } = await launch()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'))
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/copy {Enter}')
    expect(await screen.findByText('There is no Pi reply to copy yet.')).toBeTruthy()
    expect(input.value).toBe('/copy ')
    vi.mocked(api.command).mockResolvedValue({ text: 'Native last reply' })
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Clipboard unavailable')).toBeTruthy()
    expect(input.value).toBe('/copy ')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('opens a user-message fork picker and leaves the original chat owned by Pi', async () => {
    resumedSession()
    const value = snapshot()
    value.messages = [{ role: 'user', content: 'Original request', entryId: 'user-1' }, { role: 'assistant', content: 'Original reply', entryId: 'assistant-1' }]
    value.entries = [{ type: 'message', id: 'user-1', parentId: null, message: value.messages[0] }, { type: 'message', id: 'assistant-1', parentId: 'user-1', message: value.messages[1] }]
    value.commands = [{ name: 'desktop-session', source: 'extension' }]
    snapshots.set('host-1', value)
    vi.spyOn(api, 'branch').mockResolvedValue({ ok: true })
    const { user, input } = await launch()
    await screen.findByText('Original reply')
    await user.type(input, '/fork {Enter}')
    const modal = await screen.findByRole('dialog', { name: 'Fork chat' })
    expect(within(modal).queryByText('Original reply')).toBeNull()
    expect(within(modal).queryByRole('button', { name: 'Continue from here' })).toBeNull()
    await user.click(within(modal).getByRole('button', { name: 'Fork chat' }))
    await waitFor(() => expect(api.branch).toHaveBeenCalledWith('host-1', 'user-1', 'fork'))
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
  })

  it('focuses saved chats for resume and refreshes native state after cloning', async () => {
    resumedSession()
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    await user.type(input, '/resume {Enter}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search chats' })))
    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy()
    const cloned = snapshot()
    cloned.state.sessionId = 'cloned-native'; cloned.state.sessionFile = '/test/clone.jsonl'; cloned.state.sessionName = 'Cloned chat'
    vi.mocked(api.command).mockImplementation(async (_id, command) => { if (command.type === 'clone') snapshots.set('host-1', cloned); return undefined })
    await user.click(input)
    await user.type(input, '/clone {Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'clone' }))
    await waitFor(() => expect(document.title).toContain('Cloned chat'))
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
  })

  it('exports HTML through Pi with literal paths and retains native-only commands for terminal setup', async () => {
    resumedSession()
    vi.mocked(api.command).mockResolvedValue({ path: '/test/project/chat export.html' })
    const openPiTerminal = vi.fn(async () => {})
    window.piDesktop = { platform: 'darwin', pickDirectory: async () => project.cwd, openExternal: async () => {}, openPiTerminal }
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/export /test/project/chat export.html{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'export_html', outputPath: '/test/project/chat export.html' }))
    expect(await screen.findByText('Exported HTML to /test/project/chat export.html')).toBeTruthy()
    await user.type(input, '/hotkeys {Enter}')
    const modal = await screen.findByRole('dialog', { name: 'Pi terminal command' })
    expect(input.value).toBe('/hotkeys ')
    await user.click(within(modal).getByRole('button', { name: 'Open Pi terminal' }))
    expect(openPiTerminal).toHaveBeenCalledWith(project.cwd)
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
    await user.click(within(modal).getByRole('button', { name: 'Close' }))
    await user.clear(input)
    await user.type(input, '/export result.jsonl{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Pi terminal command' })).toBeTruthy()
    expect(api.command).toHaveBeenCalledTimes(1)
  })

  it.each(['thinking', 'reload'])('curates default commands, searches secondary commands, and forwards registered /%s unchanged', async name => {
    resumedSession()
    const value = snapshot()
    value.thinkingLevels = ['off', 'high']
    value.commands = [{ name, source: 'extension' }, { name: 'desktop-session', source: 'extension' }]
    snapshots.set('host-1', value)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/')
    expect(screen.getAllByRole('option').map(item => '/' + item.getAttribute('data-command'))).toEqual(['/model', '/thinking', '/compact', '/fork', '/session', '/tree'])
    expect(screen.queryByRole('option', { name: /\/export/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /\/logout/ })).toBeNull()
    await user.type(input, 'ex')
    expect(screen.getByRole('option', { name: /\/export/ })).toBeTruthy()
    await user.clear(input)
    await user.type(input, '/lo')
    expect(screen.getByRole('option', { name: /\/logout/ })).toBeTruthy()
    await user.clear(input)
    await user.type(input, `/${name} custom argument{Enter}`)
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: `/${name} custom argument` }))
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'set_thinking_level' }))
  })

  it('keeps the initial slash menu to project-free actions while allowing explicit command discovery', async () => {
    const { user, input } = await launch()
    await user.type(input, '/')
    expect(screen.getAllByRole('option').map(item => '/' + item.getAttribute('data-command'))).toEqual(['/model'])
    await user.type(input, 'login')
    expect(screen.getByRole('option', { name: /\/login/ })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(input.value).toBe('/login')
    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).toBeNull()
    await user.clear(input)
    await user.type(input, '/login')
    expect(screen.getByRole('option', { name: /\/login/ })).toBeTruthy()
  })

  it.each(['working', 'queued'])('retains history commands while Pi has %s input', async state => {
    resumedSession()
    const value = snapshot()
    if (state === 'working') value.state.isStreaming = true
    else value.state.pendingMessageCount = 1
    snapshots.set('host-1', value)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/clone {Enter}')
    expect(await screen.findByText('Finish the current task, queued messages, and Pi dialogs before using this command.')).toBeTruthy()
    expect(input.value).toBe('/clone ')
    expect(api.command).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '/resume {Enter}')
    expect(input.value).toBe('/resume ')
    expect(api.command).not.toHaveBeenCalled()
  })

  it('keeps login text out of Pi prompts and opens provider setup before project selection', async () => {
    const { user, input } = await launch()
    await user.type(input, '/login')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(input.value).toBe('')
    expect(api.command).not.toHaveBeenCalled()
    expect(api.open).not.toHaveBeenCalled()
  })

  it('completes public Pi commands with arrow keys and preserves the draft when dismissed', async () => {
    resumedSession()
    const value = snapshot()
    value.commands = [{ name: 'ui-check', description: 'Check dialogs' }, { name: 'desktop-session' }]
    snapshots.set('host-1', value)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, '/ui')
    await screen.findByRole('option', { name: /ui-check.*Check dialogs/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input.value).toBe('/ui-check ')
    expect(api.command).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '/')
    expect(screen.queryByRole('option', { name: /desktop-session/ })).toBeNull()
    await user.keyboard('{Escape}')
    expect(input.value).toBe('/')
    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).toBeNull()
  })

  it('restores unsent drafts when revisiting a chat and keeps them on same-chat clicks', async () => {
    resumedSession()
    snapshots.set('host-2', { ...snapshot('host-2'), state: { ...snapshot('host-2').state, sessionId: 'second-pi', sessionFile: '/test/second.jsonl' } })
    vi.mocked(api.open).mockImplementation(async (_cwd, path) => ({ id: path ? 'host-1' : 'host-2' }))
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, 'First chat draft')
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    expect(input.value).toBe('First chat draft')
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    await waitFor(() => expect(input.value).toBe(''))
    await user.type(input, 'Second chat draft')
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    await waitFor(() => expect(input.value).toBe('First chat draft'))
  })

  it('does not restore a sent draft after its acknowledgement arrives in another chat', async () => {
    resumedSession()
    snapshots.set('host-2', { ...snapshot('host-2'), state: { ...snapshot('host-2').state, sessionId: 'second-pi', sessionFile: '/test/second.jsonl' } })
    vi.mocked(api.open).mockImplementation(async (_cwd, path) => ({ id: path ? 'host-1' : 'host-2' }))
    const pending = deferred<undefined>()
    finishRequests.push(() => { pending.resolve(undefined) })
    vi.mocked(api.command).mockReturnValue(pending.promise)
    const { user, input } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.type(input, 'Accepted request')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.command).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    await waitFor(() => expect(input.value).toBe(''))
    await user.type(input, 'Other chat draft')
    pending.resolve(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Chat' }))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('searches model names across providers and focuses the search field on open', async () => {
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models: [
      { provider: 'first', id: 'same', name: 'Desired model' }, { provider: 'second', id: 'same', name: 'Desired model' },
    ], extensionProvidersSupported: false, limitations: [] })
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Model' }))
    const search = await screen.findByRole('textbox', { name: 'Search providers' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    await user.type(search, 'Desired')
    const choices = await screen.findAllByRole('menuitem', { name: /Desired model/ })
    expect(choices).toHaveLength(2)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('Desired model')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('registers a project for browsing without starting Pi or losing a draft', async () => {
    const { user, input } = await launch()
    vi.spyOn(api, 'file').mockResolvedValue({ kind: 'directory', path: project.cwd, root: project.cwd, entries: [{ name: 'ready.txt', path: project.cwd + '/ready.txt', kind: 'file' }] })
    await user.type(input, 'Draft before browsing')
    await user.click(screen.getByRole('button', { name: 'Files' }))
    const panel = screen.getByRole('complementary', { name: 'Workspace panel' })
    await user.click(within(panel).getByRole('button', { name: 'Choose a project' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add project' })
    await user.type(within(chooser).getByRole('textbox', { name: 'Project directory' }), project.cwd)
    await user.click(within(chooser).getByRole('button', { name: 'Open project' }))
    await user.click(await within(panel).findByRole('button', { name: /Project Files/ }))
    await within(panel).findByRole('button', { name: 'ready.txt' })
    expect(api.open).not.toHaveBeenCalled()
    expect(input.value).toBe('Draft before browsing')
  })

  it('ignores a prior Pi startup when the user changes projects', async () => {
    existingProject()
    vi.mocked(api.projects).mockResolvedValue({ projects: [project, { cwd: '/test/other', name: 'Other' }] })
    const opening = deferred<{ id: string }>()
    finishRequests.push(() => { opening.resolve({ id: 'old-handle' }) })
    vi.mocked(api.open).mockReturnValue(opening.promise)
    const { user, input } = await launch()
    await user.type(input, 'Keep this project draft')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'New chat in Other' }))
    expect(screen.getByRole('button', { name: 'Model' }).hasAttribute('disabled')).toBe(false)
    opening.resolve({ id: 'old-handle' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Session branches' }).hasAttribute('disabled')).toBe(true))
    expect(input.value).toBe('')
    await user.click(screen.getByRole('button', { name: 'New chat in Project' }))
    expect(input.value).toBe('')
    expect(screen.getByRole('heading', { name: 'What are we working on?' })).toBeTruthy()
  })

  it.each(['darwin', 'win32'])('toggles both panels with %s keyboard bindings and preserves the draft', async platform => {
    existingProject()
    window.piDesktop = { platform, pickDirectory: async () => project.cwd, openExternal: async () => {} }
    vi.spyOn(api, 'file').mockResolvedValue({ kind: 'directory', path: project.cwd, root: project.cwd, entries: [] })
    const { user, input } = await launch()
    await user.type(input, 'Keep this draft')
    const modifier = platform === 'darwin' ? 'Meta' : 'Control'
    await user.keyboard(`{${modifier}>}b{/${modifier}}`)
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Search chats' })).toBeNull()
    expect(document.activeElement).toBe(input)
    await user.keyboard(`{${modifier}>}b{/${modifier}}`)
    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeTruthy()
    await user.keyboard(`{${modifier}>}{Alt>}b{/Alt}{/${modifier}}`)
    const filePanel = await screen.findByRole('complementary', { name: 'Workspace panel' })
    expect(api.file).not.toHaveBeenCalled()
    await user.click(await within(filePanel).findByRole('button', { name: /Project Files/ }))
    await waitFor(() => expect(api.file).toHaveBeenCalledWith(null, '.', project.cwd, expect.any(AbortSignal)))
    expect(api.open).not.toHaveBeenCalled()
    await user.type(await within(filePanel).findByRole('searchbox', { name: 'Search' }), 'notes')
    await user.keyboard(`{${modifier}>}{Alt>}b{/Alt}{/${modifier}}`)
    expect(screen.queryByRole('complementary', { name: 'Workspace panel' })).toBeNull()
    expect(filePanel.isConnected).toBe(true)
    expect(filePanel.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(input)
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toBe(filePanel)
    expect(within(filePanel).getByRole('searchbox', { name: 'Search' }).getAttribute('value')).toBe('notes')
    expect(filePanel.hasAttribute('inert')).toBe(false)
    await user.click(within(filePanel).getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Keep this draft')
  })

  it('searches models within the chosen provider and returns to providers', async () => {
    const models = Array.from({ length: 80 }, (_, index) => ({ provider: 'first', id: `model-${index}`, name: `Model ${index}` }))
    vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models: [...models, { provider: 'second', id: 'other', name: 'Other model' }], extensionProvidersSupported: false, limitations: [] })
    const { user } = await launch()
    await waitFor(() => expect(api.providers).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(await screen.findByRole('menuitem', { name: 'first · 80 models' }))
    expect(screen.queryByRole('menuitem', { name: /Other model/ })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'Model 72')
    expect(screen.getByRole('menuitem', { name: /Model 72/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Model 71/ })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Choose provider' }))
    await user.click(screen.getByRole('menuitem', { name: 'second · 1 models' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps nested folders, searches and separate file tabs while switching projects', async () => {
    existingProject()
    const second = { cwd: '/test/other', name: 'Other' }
    vi.mocked(api.projects).mockResolvedValue({ projects: [project, second] })
    vi.spyOn(api, 'file').mockImplementation(async (_id, path, cwd) => {
      if (path === '.') return { kind: 'directory', path: cwd ?? project.cwd, entries: [{ name: 'src', path: project.cwd + '/src', kind: 'directory' }, { name: 'README.md', path: project.cwd + '/README.md', kind: 'file' }] }
      if (path.endsWith('/src')) return { kind: 'directory', path, entries: [{ name: 'nested.ts', path: path + '/nested.ts', kind: 'file' }] }
      return { kind: 'file', path, content: path.endsWith('nested.ts') ? 'nested file content' : 'readme file content' }
    })
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    const panel = screen.getByRole('complementary', { name: 'Workspace panel' })
    expect(within(panel).getByRole('button', { name: /Terminal/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /Browser/ })).toBeTruthy()
    expect(api.file).not.toHaveBeenCalled()
    await user.click(within(panel).getByRole('button', { name: /Project Files/ }))
    await user.click(await within(panel).findByRole('button', { name: 'src' }))
    await user.click(await within(panel).findByRole('button', { name: 'nested.ts' }))
    await within(panel).findByText('nested file content')
    await user.click(within(panel).getByRole('tab', { name: /^Files(?: Close tab)?$/ }))
    expect(within(panel).getByRole('button', { name: 'src' }).getAttribute('aria-expanded')).toBe('true')
    await user.click(within(panel).getByRole('button', { name: 'README.md' }))
    await within(panel).findByText('readme file content')
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
    await user.click(within(panel).getByRole('tab', { name: /^Files(?: Close tab)?$/ }))
    await user.type(within(panel).getByRole('searchbox', { name: 'Search' }), 'nested')
    expect(within(panel).queryByRole('button', { name: 'README.md' })).toBeNull()
    expect(within(panel).getByRole('button', { name: 'nested.ts' })).toBeTruthy()
    expect(within(panel).queryByRole('textbox', { name: 'File path' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'New chat in Other' }))
    expect(within(panel).getByRole('button', { name: /Project Files/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'New chat in Project' }))
    expect(within(panel).getByRole('searchbox', { name: 'Search' }).getAttribute('value')).toBe('nested')
    expect(within(panel).getAllByRole('tab')).toHaveLength(3)
    expect(api.open).not.toHaveBeenCalled()
  })

  it('collapses after the last tab closes and reopens the project navigation guide', async () => {
    existingProject()
    const { user, input } = await launch()
    await user.type(input, 'Keep the composer draft')
    await user.click(screen.getByRole('button', { name: 'Files' }))
    const panel = screen.getByRole('complementary', { name: 'Workspace panel' })
    await user.click(within(panel).getByRole('button', { name: /^Browser/ }))
    await user.click(within(panel).getByRole('button', { name: 'New tab' }))
    await user.click(within(within(panel).getByRole('tab', { name: /^New tab/ })).getByRole('button', { name: 'Close tab' }))
    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toBe(panel)
    expect(within(panel).getByRole('tab', { name: /^Browser/ })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Close tab' }))
    expect(screen.queryByRole('complementary', { name: 'Workspace panel' })).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Keep the composer draft')
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(within(panel).getAllByRole('tab')).toHaveLength(1)
    expect(within(panel).getByRole('button', { name: /Project Files/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /^Terminal/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /^Browser/ })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Close tab' }))
    expect(screen.queryByRole('complementary', { name: 'Workspace panel' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(within(panel).getByRole('button', { name: /Project Files/ })).toBeTruthy()
  })

  it('uses an empty browser address with a working Go button and Enter navigation', async () => {
    existingProject()
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    const panel = screen.getByRole('complementary', { name: 'Workspace panel' })
    await user.click(within(panel).getByRole('button', { name: /^Browser/ }))
    const address = within(panel).getByRole('textbox', { name: 'Website address' })
    expect(address.getAttribute('value')).toBe('')
    expect(address.getAttribute('placeholder')).toBe('Enter a URL')
    const go = within(panel).getByRole('button', { name: 'Go' })
    expect(go.hasAttribute('disabled')).toBe(true)
    await user.type(address, 'first.example/path')
    expect(go.hasAttribute('disabled')).toBe(false)
    await user.click(go)
    expect(within(panel).getByTitle('Browser').getAttribute('src')).toBe('https://first.example/path')
    await user.clear(address)
    await user.type(address, 'https://second.example/{Enter}')
    expect(within(panel).getByTitle('Browser').getAttribute('src')).toBe('https://second.example/')
    await user.click(within(panel).getByRole('button', { name: 'Back' }))
    expect(address.getAttribute('value')).toBe('https://first.example/path')
    expect(within(panel).getByRole('button', { name: 'Open in browser' })).toBeTruthy()
    await user.clear(address)
    await user.type(address, 'javascript:alert(1)')
    await user.click(go)
    expect(within(panel).getByRole('alert').textContent).toBe('Enter an http or https website address.')
    expect(within(panel).getByTitle('Browser').getAttribute('src')).toBe('https://first.example/path')
  })

  it('opens a project file through the restricted native editor action', async () => {
    existingProject()
    const openFile = vi.fn(async () => {})
    window.piDesktop = { platform: 'darwin', pickDirectory: async () => project.cwd, openExternal: async () => {}, openFile }
    vi.spyOn(api, 'file').mockResolvedValueOnce({ kind: 'directory', path: project.cwd, root: project.cwd, entries: [{ name: 'file.ts', path: project.cwd + '/file.ts', kind: 'file' }] }).mockResolvedValueOnce({ kind: 'file', path: project.cwd + '/file.ts', root: project.cwd, content: 'export const value = 1' })
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(await screen.findByRole('button', { name: /Project Files/ }))
    await user.click(await screen.findByRole('button', { name: 'file.ts' }))
    await user.click(await screen.findByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledWith({ cwd: project.cwd, path: project.cwd + '/file.ts', action: 'editor' })
    await user.click(screen.getByRole('button', { name: 'File actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Choose another editor…' }))
    expect(openFile).toHaveBeenLastCalledWith({ cwd: project.cwd, path: project.cwd + '/file.ts', action: 'chooseEditor' })
  })

  it('branches from an AI reply through the native-history endpoint', async () => {
    resumedSession()
    const value = snapshot()
    value.messages = [{ role: 'user', content: 'Original request', entryId: 'user-1' }, { role: 'assistant', content: [{ type: 'text', text: 'Completed reply' }], entryId: 'assistant-1' }]
    value.entries = [{ type: 'message', id: 'user-1', parentId: null, message: value.messages[0] }, { type: 'message', id: 'assistant-1', parentId: 'user-1', message: value.messages[1] }]
    value.leafId = 'assistant-1'
    value.commands = [{ name: 'desktop-session', source: 'extension' }]
    snapshots.set('host-1', value)
    vi.spyOn(api, 'branch').mockResolvedValue({ ok: true })
    const { user } = await launch()
    await screen.findByText('Completed reply')
    await user.click(screen.getAllByRole('button', { name: 'Branch from this message' })[1]!)
    await user.click(await screen.findByRole('menuitem', { name: 'Fork chat' }))
    await waitFor(() => expect(api.branch).toHaveBeenCalledWith('host-1', 'assistant-1', 'fork'))
    expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'navigate_tree' }))
  })

  it('shows a tool-only assistant entry in the full tree and navigates its native ID', async () => {
    resumedSession()
    const value = snapshot()
    value.messages = [{ role: 'user', content: 'Read the source', entryId: 'user-1' }]
    value.entries = [
      { type: 'message', id: 'user-1', parentId: null, message: value.messages[0] },
      { type: 'message', id: 'tool-ai', parentId: 'user-1', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspecting' }, { type: 'toolCall', name: 'read', id: 'call-1', arguments: { path: 'source.ts' } }] } },
    ]
    value.leafId = 'tool-ai'; value.commands = [{ name: 'desktop-session', source: 'extension' }]
    snapshots.set('host-1', value)
    vi.spyOn(api, 'branch').mockResolvedValue({ ok: true })
    const { user } = await launch()
    await screen.findByText('Read the source')
    await user.click(screen.getByRole('button', { name: 'Session branches' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Session branches' }))
    const modal = await screen.findByRole('dialog', { name: 'Session branches' })
    const row = within(modal).getByText('read').closest('[role="listitem"]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Continue from here' }))
    await waitFor(() => expect(api.branch).toHaveBeenCalledWith('host-1', 'tool-ai', 'navigate'))
  })

  it('saving appearance without a runtime edit does not pin the current bundled installation', async () => {
    const { user } = await launch()
    vi.spyOn(api, 'saveRuntime').mockResolvedValue({ command: '/runtime/node', args: ['/runtime/pi'], configured: true })
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const modal = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(modal).getByRole('button', { name: 'Appearance' }))
    await user.selectOptions(within(modal).getByRole('combobox', { name: 'App theme' }), 'dark')
    await user.selectOptions(within(modal).getByRole('combobox', { name: 'Light code theme' }), 'github-light')
    await user.selectOptions(within(modal).getByRole('combobox', { name: 'Dark code theme' }), 'nord')
    const uiSize = within(modal).getByRole('spinbutton', { name: 'UI font size' })
    await user.clear(uiSize); await user.type(uiSize, '18')
    const codeSize = within(modal).getByRole('spinbutton', { name: 'Code font size' })
    await user.clear(codeSize); await user.type(codeSize, '16')
    await user.click(within(modal).getByRole('switch', { name: 'Show line numbers' }))
    await user.click(within(modal).getByRole('switch', { name: 'Wrap long lines' }))
    await user.click(within(modal).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ appearance: 'dark', uiFontSize: 18, codeFontSize: 16, lightCodeTheme: 'github-light', darkCodeTheme: 'nord', codeLineNumbers: false, codeWrapLines: true })))
    expect(document.body.style.getPropertyValue('--dsw-ui-font-delta')).toBe('4px')
    expect(document.body.style.getPropertyValue('--dsw-code-font-size')).toBe('16px')
    expect(api.saveRuntime).not.toHaveBeenCalled()
  })

  it('restores text preferences before saving and rejects an out-of-range font edit', async () => {
    const saved = { locale: 'en' as const, uiFontSize: 17, codeFontSize: 15, lightCodeTheme: 'solarized-light' as const, darkCodeTheme: 'nord' as const, codeLineNumbers: false, codeWrapLines: true }
    const preferences = deferred<typeof saved>()
    vi.mocked(api.preferences).mockReturnValue(preferences.promise)
    const user = userEvent.setup()
    render(<App />)
    expect(api.savePreferences).not.toHaveBeenCalled()
    await act(async () => { preferences.resolve(saved) })
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const modal = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(modal).getByRole('button', { name: 'Appearance' }))
    const size = within(modal).getByRole('spinbutton', { name: 'UI font size' })
    expect(size.getAttribute('value')).toBe('17')
    expect(within(modal).getByRole('switch', { name: 'Show line numbers' }).getAttribute('aria-checked')).toBe('false')
    expect(within(modal).getByRole('switch', { name: 'Wrap long lines' }).getAttribute('aria-checked')).toBe('true')
    await user.clear(size); await user.type(size, '99'); await user.tab()
    expect(size.getAttribute('value')).toBe('17')
    for (const [input] of vi.mocked(api.savePreferences).mock.calls) {
      if (input.uiFontSize !== undefined) expect(input).toEqual(expect.objectContaining(saved))
    }
  })

  it('restores bundled selection without leaving a disconnected banner or discarding the file preview', async () => {
    resumedSession()
    vi.mocked(api.runtime).mockResolvedValue({ command: '/external/node', args: ['/external/pi'], configured: true, source: 'external', bundled: { node: '24.21.0', pi: '0.99.1', pnpm: '11.7.0', python: '3.12.14' } })
    vi.spyOn(api, 'file').mockImplementation(async (_id, path) => path === '.' ? { kind: 'directory', path: project.cwd, entries: [{ name: 'ready.txt', path: project.cwd + '/ready.txt', kind: 'file' }] } : { kind: 'file', path: project.cwd + '/ready.txt', content: 'Preview survives runtime selection' })
    vi.spyOn(api, 'useBundledRuntime').mockImplementation(async () => {
      streams[0]?.onerror?.(new Event('error'))
      return { command: '/bundled/node', args: ['/bundled/pi'], configured: true, source: 'bundled' }
    })
    const { user } = await launch()
    await waitFor(() => expect(api.open).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(await screen.findByRole('button', { name: /Project Files/ }))
    await user.click(await screen.findByRole('button', { name: 'ready.txt' }))
    await screen.findByText('Preview survives runtime selection')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'pi runtime' }))
    await user.click(await screen.findByRole('button', { name: 'Use bundled Pi' }))
    await waitFor(() => expect(api.useBundledRuntime).toHaveBeenCalled())
    await user.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Connection lost. Reconnecting…')).toBeNull()
    expect(screen.getByText('Preview survives runtime selection')).toBeTruthy()
    await act(async () => { streams[0]?.onerror?.(new Event('error')) })
    expect(screen.queryByText('Connection lost. Reconnecting…')).toBeNull()
  })
})


it('opens GUI settings from an explicit slash command without exposing it in the default suggestions', async () => {
  const { user, input } = await launch()
  await user.type(input, '/')
  expect(screen.queryByRole('option', { name: /settings/ })).toBeNull()
  await user.type(input, 'settings {Enter}')
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
  expect(input.value).toBe('')
  expect(api.command).not.toHaveBeenCalled()
})

it('saves a native Agent toggle, retains errors, and does not rewrite the runtime', async () => {
  const initial = await api.agentConfiguration()
  const update = vi.spyOn(api, 'updateAgentConfiguration').mockResolvedValue({ ...initial, preferences: { ...initial.preferences, compaction: false } })
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  await user.click(within(dialog).getByRole('button', { name: 'Agent' }))
  const toggle = await within(dialog).findByRole('switch', { name: 'Automatic compaction' })
  await user.click(toggle)
  await waitFor(() => expect(update).toHaveBeenCalledWith({ action: 'preferences', values: { compaction: false } }, undefined))
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(within(dialog).getByRole('button', { name: 'Reload current chat' }).hasAttribute('disabled')).toBe(true)
  update.mockRejectedValueOnce(new Error('Configuration is read-only'))
  await user.click(toggle)
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Configuration is read-only')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
})

it('keeps keyboard focus on an Agent switch while a native save is pending', async () => {
  const initial = await api.agentConfiguration()
  const saved = deferred<typeof initial>()
  const update = vi.spyOn(api, 'updateAgentConfiguration').mockReturnValue(saved.promise)
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  await user.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Agent' }))
  const toggle = await screen.findByRole('switch', { name: 'Automatic compaction' })
  await user.click(toggle)
  expect(document.activeElement).toBe(toggle)
  expect(toggle.getAttribute('aria-disabled')).toBe('true')
  await user.keyboard(' ')
  expect(update).toHaveBeenCalledTimes(1)
  await act(async () => { saved.resolve({...initial,preferences:{...initial.preferences,compaction:false}}) })
  expect(document.activeElement).toBe(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
})

it('creates a Pi prompt template and guards unsaved edits before leaving Settings', async () => {
  const initial = await api.agentConfiguration()
  const update = vi.spyOn(api, 'updateAgentConfiguration').mockResolvedValue(initial)
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  await user.click(within(dialog).getByRole('button', { name: 'Commands' }))
  await user.click(await within(dialog).findByRole('button', { name: 'New' }))
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'focused-review')
  await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Review focused changes')
  await user.type(within(dialog).getByRole('textbox', { name: 'Content' }), 'Review $ARGUMENTS')
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  const unsaved = screen.getByRole('dialog', { name: 'Unsaved changes' })
  await user.click(within(unsaved).getByRole('button', { name: 'Keep editing' }))
  expect(within(dialog).getByRole('textbox', { name: 'Content' }).getAttribute('aria-label')).toBe('Content')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith({ action: 'create', kind: 'prompts', scope: 'user', name: 'focused-review', description: 'Review focused changes', content: 'Review $ARGUMENTS' }, undefined))
})

it('keeps a preview opened while Pi is still starting in the same project', async () => {
  existingProject()
  const opening = deferred<{ id: string }>()
  finishRequests.push(() => { opening.resolve({ id: 'host-1' }) })
  vi.mocked(api.open).mockReturnValue(opening.promise)
  vi.spyOn(api, 'file').mockImplementation(async (_id, path) => path === '.' ? { kind: 'directory', path: project.cwd, entries: [{ name: 'ready.txt', path: project.cwd + '/ready.txt', kind: 'file' }] } : { kind: 'file', path: project.cwd + '/ready.txt', content: 'Preview stays visible' })
  const { user, input } = await launch()
  await user.type(input, 'Begin work{Enter}')
  await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('button', { name: 'Files' }))
  await user.click(await screen.findByRole('button', { name: /Project Files/ }))
    await user.click(await screen.findByRole('button', { name: 'ready.txt' }))
    await screen.findByText('Preview stays visible')
  opening.resolve({ id: 'host-1' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Model' }).hasAttribute('disabled')).toBe(false))
  expect(screen.getByText('Preview stays visible')).toBeTruthy()
})


it('enters a new chat immediately without starting Pi and creates only one session on first send', async () => {
  resumedSession()
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1))
  await user.type(input, 'Retain the old draft')
  vi.mocked(api.open).mockClear()
  const pending = deferred<{ id: string }>()
  finishRequests.push(() => pending.resolve({ id: 'host-2' }))
  vi.mocked(api.open).mockReturnValue(pending.promise)
  snapshots.set('host-2', snapshot('host-2'))
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'What are we working on?' })).toBeTruthy()
  expect(api.open).not.toHaveBeenCalled()
  await user.type(input, 'New draft')
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(input.value).toBe('')
  expect(api.open).not.toHaveBeenCalled()
  await user.type(input, 'New draft')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1))
  pending.resolve({ id: 'host-2' })
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-2', { type: 'prompt', message: 'New draft' }))
})

it('groups all project histories, persists disclosure, and expands search in the header', async () => {
  resumedSession()
  vi.mocked(api.projects).mockResolvedValue({ projects: [project, { cwd: '/test/other', name: 'Other' }] })
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [
    { id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Chat', modified: '2026-09-30T00:00:00Z', messageCount: 1 },
    { id: 'other', path: '/test/other.jsonl', cwd: '/test/other', name: 'Design review', modified: '2026-09-30T00:00:00Z', messageCount: 1 },
  ] })
  const { user } = await launch()
  const group = await screen.findByRole('region', { name: 'Other' })
  const retainedChat = within(group).getByRole('button', { name: 'Design review' })
  expect(retainedChat).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Search chats' })).toBeNull()
  await user.click(within(group).getByRole('button', { name: 'Other' }))
  await waitFor(() => expect(within(group).queryByRole('button', { name: 'Design review' })).toBeNull())
  expect(retainedChat.isConnected).toBe(true)
  expect(retainedChat.closest('[inert]')).toBeTruthy()
  expect(api.savePreferences).toHaveBeenCalledWith({ collapsedProjects: ['/test/other'] })
  await user.click(screen.getByRole('button', { name: 'Search chats' }))
  const search = screen.getByRole('textbox', { name: 'Search chats' })
  await user.type(search, 'Design')
  expect(within(group).getByRole('button', { name: 'Design review' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('textbox', { name: 'Search chats' })).toBeNull()
  expect(within(group).queryByRole('button', { name: 'Design review' })).toBeNull()
})

it('pins, archives and restores history without rewriting a Pi conversation', async () => {
  resumedSession()
  const { user } = await launch()
  await screen.findByRole('button', { name: 'Chat' })
  await user.click(screen.getByRole('button', { name: 'Pin chat' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin chat' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Chat actions: Chat' }))
  expect(screen.getAllByRole('menuitem')[0]?.textContent).toBe('Unpin chat')
  await user.click(screen.getByRole('menuitem', { name: 'Unpin chat' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pin chat' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Chat actions: Chat' }))
  expect(screen.getAllByRole('menuitem')[0]?.textContent).toBe('Pin chat')
  await user.click(screen.getByRole('menuitem', { name: 'Pin chat' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin chat' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Archive chat' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull())
  await user.click(screen.getByRole('button', { name: 'View options' }))
  await user.click(screen.getByRole('menuitem', { name: 'Archived chats' }))
  await screen.findByRole('button', { name: 'Chat' })
  await user.click(screen.getByRole('button', { name: 'Restore chat' }))
  await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith({ archivedSessions: [] }))
  expect(api.command).not.toHaveBeenCalled()
})


it('highlights native session identity even when Pi and discovery use different symlink paths', async () => {
  resumedSession()
  snapshots.set('host-1', { ...snapshot(), state: { ...snapshot().state, sessionFile: '/alias/session.jsonl' } })
  const { user } = await launch()
  const chat = await screen.findByRole('button', { name: 'Chat' })
  await waitFor(() => expect(chat.getAttribute('aria-current')).toBe('page'))
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(chat.getAttribute('aria-current')).toBeNull()
})

it('retains project and chat rename forms on failure and shows project removal scope', async () => {
  resumedSession()
  const update = vi.spyOn(api, 'updateProject').mockRejectedValue(new Error('Navigation could not be saved'))
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Project actions: Project' }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename project' }))
  const dialog = screen.getByRole('dialog', { name: 'Rename project' })
  const input = within(dialog).getByRole('textbox', { name: 'Name' })
  await user.clear(input); await user.type(input, 'Alias')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByRole('alert')).toBeTruthy()
  expect(update).toHaveBeenCalledWith(project.cwd, 'rename', 'Alias')
  expect((input as HTMLInputElement).value).toBe('Alias')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Project actions: Project' }))
  await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))
  expect(within(screen.getByRole('dialog', { name: 'Remove project' })).getByText(/folder and Pi chats will remain on disk/)).toBeTruthy()
  expect(update).toHaveBeenCalledTimes(1)
})


it('keeps editor focus while browsing commands and opens the chosen GUI control in one step', async () => {
  resumedSession()
  const value = snapshot(); value.thinkingLevels = ['off', 'high']; value.commands = [{ name: 'desktop-session' }]
  snapshots.set('host-1', value)
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/')
  const list = screen.getByRole('listbox', { name: 'Command suggestions' })
  expect(within(list).getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true')
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(input)
  expect(input.getAttribute('aria-activedescendant')).toBe(within(list).getByRole('option', { name: /thinking/ }).id)
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).toBeNull()
  expect(await screen.findByRole('menuitem', { name: 'High' })).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thinking Level' })))
  await user.keyboard('{End}{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_thinking_level', level: 'high' }))
  expect(input.value).toBe('')
  expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
})

it('searches localized descriptions and keeps native skill and prompt invocation names when completing', async () => {
  resumedSession()
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'zh', cwd: project.cwd, sessionId: 'native-pi', sessionFile: '/test/session.jsonl' })
  const value = snapshot(); value.commands = [{ name: 'skill:audit', source: 'skill', description: '审查文件' }, { name: 'audit-prompt', source: 'prompt', description: '审查变更' }]
  snapshots.set('host-1', value)
  const user = userEvent.setup(); render(<App />)
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  const input = screen.getByRole('textbox', { name: '让 pi 帮你处理项目…' }) as HTMLTextAreaElement
  await user.type(input, '/推理')
  expect(screen.getByRole('option', { name: /thinking/ })).toBeTruthy()
  await user.clear(input); await user.type(input, '/audit')
  expect(screen.getByRole('listbox', { name: '命令建议' }).textContent).toContain('提示模板')
  expect(screen.getByRole('listbox', { name: '命令建议' }).textContent).toContain('技能')
  await user.click(screen.getByRole('option', { name: /skill:audit/ }))
  expect(input.value).toBe('/skill:audit ')
  expect(document.activeElement).toBe(input)
  expect(api.command).not.toHaveBeenCalled()
})

it('uses Tab only to complete a GUI command and leaves Shift+Enter as a newline', async () => {
  const { user, input } = await launch()
  await user.type(input, '/mo')
  await user.keyboard('{Tab}')
  expect(input.value).toBe('/model ')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(input)
  await user.clear(input); await user.type(input, '/mo')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(input.value).toBe('/mo\n')
  expect(api.open).not.toHaveBeenCalled()
})

it('does not send a partial command while a selected action is pending and retains a full command on failure', async () => {
  resumedSession()
  const pending = deferred<undefined>(); finishRequests.push(() => pending.resolve(undefined))
  vi.mocked(api.command).mockReturnValue(pending.promise)
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/sess')
  await user.click(screen.getByRole('option', { name: /session.*View context/ }))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input.value).toBe('/session')
  expect(api.command).toHaveBeenCalledTimes(1)
  pending.resolve(undefined)
  await screen.findByText('Pi did not return the requested result. Try again.')
  expect(input.value).toBe('/session')
})

it('opens optional compaction instructions before a model operation and preserves them on failure', async () => {
  resumedSession()
  vi.mocked(api.command).mockRejectedValueOnce(new Error('Compaction unavailable'))
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/compact')
  await user.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'Compact conversation' })
  expect(api.command).not.toHaveBeenCalled()
  const instructions = within(dialog).getByRole('textbox', { name: 'Instructions (optional)' })
  await user.type(instructions, 'Keep the migration decisions')
  await user.click(within(dialog).getByRole('button', { name: 'Compact conversation' }))
  expect(await within(dialog).findByRole('alert')).toBeTruthy()
  expect((instructions as HTMLTextAreaElement).value).toBe('Keep the migration decisions')
  expect(api.command).toHaveBeenCalledWith('host-1', { type: 'compact', customInstructions: 'Keep the migration decisions' })
})


it('uses the highlighted slash choice when clicking Send instead of sending a partial command to the model', async () => {
  const { user, input } = await launch()
  await user.type(input, '/mo')
  await user.click(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByText('Configure models in Settings → Models and providers.')).toBeTruthy()
  expect(input.value).toBe('')
  expect(api.open).not.toHaveBeenCalled()
  expect(api.command).not.toHaveBeenCalled()
})

it('keeps IME candidate keys away from slash commands and lets an open compaction request be stopped', async () => {
  resumedSession()
  const pending = deferred<undefined>(); finishRequests.push(() => pending.resolve(undefined))
  vi.mocked(api.command).mockImplementation(async (_id, command) => command.type === 'compact' ? pending.promise : undefined)
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/compact')
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.compositionEnd(input)
  await user.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'Compact conversation' })
  await user.click(within(dialog).getByRole('button', { name: 'Compact conversation' }))
  await user.click(within(dialog).getByRole('button', { name: 'Stop' }))
  expect(api.command).toHaveBeenCalledWith('host-1', { type: 'abort' })
  pending.resolve(undefined)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})


it('keeps the command menu below the measured conversation header as native caption space changes', async () => {
  let headerBottom = 88
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'HEADER') return new DOMRect(0, headerBottom - 52, 700, 52)
    if (this.hasAttribute('data-menu-material')) return new DOMRect(0, 100, 372, 200)
    return original.call(this)
  })
  const { user, input } = await launch()
  await user.type(input, '/')
  const surface = screen.getByRole('listbox', { name: 'Command suggestions' }).closest<HTMLElement>('[data-menu-material]')
  expect(surface?.style.maxHeight).toBe('204px')
  headerBottom = 52
  fireEvent(window, new Event('resize'))
  expect(surface?.style.maxHeight).toBe('240px')
})


it('completes an exact native command on pointer selection and submits only after Enter', async () => {
  resumedSession()
  const value = snapshot(); value.commands = [{ name: 'ui-check', source: 'extension', description: 'Check dialogs' }]
  snapshots.set('host-1', value)
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/ui-check')
  await user.click(screen.getByRole('option', { name: /ui-check.*Check dialogs/ }))
  expect(input.value).toBe('/ui-check ')
  expect(api.command).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: '/ui-check ' }))
})

it('opens the extension centre without installing and retains failed package input', async () => {
  const view = await api.agentConfiguration()
  const saving = vi.spyOn(api, 'updateAgentConfiguration').mockRejectedValue(new Error('Package could not be installed'))
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Extensions' }))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  await within(settings).findByText('Default collection')
  expect(saving).not.toHaveBeenCalled()
  await user.click(within(settings).getByRole('button', { name: 'Add extension' }))
  const dialog = screen.getByRole('dialog', { name: 'Add extension' })
  await user.type(within(dialog).getByRole('textbox', { name: 'Package source' }), 'npm:example-package@1.0.0')
  await user.click(within(dialog).getByRole('button', { name: 'Install' }))
  expect(await within(dialog).findByRole('alert')).toBeTruthy()
  expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('npm:example-package@1.0.0')
  saving.mockResolvedValue(view)
  await user.click(within(dialog).getByRole('button', { name: 'Install' }))
  await waitFor(() => expect(screen.queryByRole('dialog', {name:'Add extension'})).toBeNull())
  expect(saving).toHaveBeenLastCalledWith({action:'package',operation:'install',scope:'user',source:'npm:example-package@1.0.0'}, undefined)
  expect(api.command).not.toHaveBeenCalled()
})

it('keeps existing search in defaults without blocking explicit native coexistence', async () => {
  const view = await api.agentConfiguration()
  view.packages = [{ id: 'existing-search' as PackageId, name: 'pi-web-search', source: 'npm:pi-web-search', scope: 'project', installed: true, version: '1.5.0', description: '' }]
  vi.mocked(api.agentConfiguration).mockResolvedValue(view)
  const saving = vi.spyOn(api, 'updateAgentConfiguration').mockResolvedValue(view)
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Extensions' }))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  await within(settings).findByText('Already using pi-web-search. Defaults keep it; you can install this package separately. Coexistence may need distinct tool names in Pi configuration.')
  await user.click(within(settings).getByRole('button', { name: 'Install defaults' }))
  await waitFor(() => expect(saving).toHaveBeenCalledTimes(3))
  expect(saving.mock.calls.map(([action]) => action)).toEqual([
    { action: 'package', operation: 'install', scope: 'user', source: 'npm:pi-subagents@0.74.0' },
    { action: 'package', operation: 'install', scope: 'user', source: 'npm:@juicesharp/rpiv-ask-user-question@2.12.0' },
    { action: 'package', operation: 'install', scope: 'user', source: 'npm:@juicesharp/rpiv-todo@2.12.0' },
  ])
  await user.click(within(settings).getByRole('button', { name: 'Add extension' }))
  const dialog = screen.getByRole('dialog', { name: 'Add extension' })
  await user.type(within(dialog).getByRole('textbox', { name: 'Package source' }), 'npm:pi-web-access@0.35.0')
  expect((within(dialog).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(false)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(saving).toHaveBeenCalledTimes(4))
  expect(saving).toHaveBeenLastCalledWith({ action: 'package', operation: 'install', scope: 'user', source: 'npm:pi-web-access@0.35.0' }, undefined)
})

it('opens a separate skill market, discloses mixed package contents, pins install and retains native skill management', async () => {
  const view = await api.agentConfiguration(), packageId = 'mixed-package' as PackageId, skillId = 'mixed-skill' as ResourceId
  const installedView = { ...view, packages: [{ id: packageId, name: 'example-skill', source: 'npm:example-skill@1.2.3', scope: 'user' as const, installed: true, version: '1.2.3', description: 'Skill workflow' }], resources: [
    { id: skillId, kind: 'skills' as const, name: 'review-plan', description: 'Review a plan', path: '/test/skills/review-plan/SKILL.md', scope: 'user' as const, enabled: true, editable: false, packageId },
    { id: 'mixed-extension' as ResourceId, kind: 'extensions' as const, name: 'index.ts', description: '', path: '/test/index.ts', scope: 'user' as const, enabled: true, editable: false, packageId },
  ] }
  const saving = vi.spyOn(api, 'updateAgentConfiguration').mockResolvedValue(installedView)
  vi.mocked(api.marketplace).mockResolvedValue({ packages: [{ name: 'example-skill', description: 'Skill workflow', author: 'example', downloads: 1234, types: ['skill'], url: 'https://pi.dev/packages/example-skill' }], total: 1, page: 1, hasNext: false, url: 'https://pi.dev/packages?type=skill' })
  vi.mocked(api.marketplaceDetail).mockResolvedValue({ name: 'example-skill', version: '1.2.3', description: 'Skill workflow', license: 'MIT', resources: [{ type: 'skill', paths: ['./skills'] }, { type: 'extension', paths: ['./index.ts'] }], url: 'https://pi.dev/packages/example-skill' })
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  const settings = await screen.findByRole('dialog', { name: 'Settings' })
  await user.click(within(settings).getByRole('button', { name: 'Skills' }))
  await user.click(await within(settings).findByText('example-skill'))
  const detail = await screen.findByRole('dialog', { name: 'example-skill' })
  await within(detail).findByText('1.2.3')
  expect(within(detail).getByText('./index.ts')).toBeTruthy()
  expect(within(detail).getByText('Pi installs the whole package, including its other resource types. Manage extensions, skills and prompts individually after installation.')).toBeTruthy()
  expect(saving).not.toHaveBeenCalled()
  await user.click(within(detail).getByRole('button', { name: 'Install package' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'example-skill' })).toBeNull())
  expect(saving).toHaveBeenCalledWith({ action: 'package', operation: 'install', source: 'npm:example-skill@1.2.3', scope: 'user' }, undefined)
  await user.click(within(settings).getByRole('tab', { name: /Installed/ }))
  expect(within(settings).getByText('/skill:review-plan · example-skill')).toBeTruthy()
  await user.click(within(settings).getByRole('switch', { name: 'Enable review-plan' }))
  expect(saving).toHaveBeenLastCalledWith({ action: 'toggle', resourceId: skillId, enabled: false }, undefined)
  expect(api.command).not.toHaveBeenCalled()
})

it('keeps installed skills usable when the market fails and supports explicit search and retry', async () => {
  vi.mocked(api.marketplace).mockRejectedValueOnce(new Error('Offline'))
  const { user } = await launch()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  const settings = await screen.findByRole('dialog', { name: 'Settings' })
  await user.click(within(settings).getByRole('button', { name: 'Skills' }))
  expect(await within(settings).findByText('The gallery could not load. Retry or browse the official Pi gallery. Your installed packages are still available.')).toBeTruthy()
  await user.click(within(settings).getByRole('tab', { name: /Installed/ }))
  expect(within(settings).getByRole('button', { name: 'New' })).toBeTruthy()
  await user.click(within(settings).getByRole('tab', { name: 'Marketplace' }))
  const search = within(settings).getByRole('textbox', { name: 'Search skills' })
  await user.type(search, 'review')
  expect(api.marketplace).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'review' }), expect.anything(), expect.anything())
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.marketplace).toHaveBeenLastCalledWith({ kind: 'skill', query: 'review', sort: 'downloads', page: 1 }, expect.any(AbortSignal), false))
  expect(await within(settings).findByText('No packages match this search.')).toBeTruthy()
})

it('reloads the running session through the native reload endpoint without restarting or sending a model prompt', async () => {
  resumedSession()
  const value = snapshot(); value.commands = [{ name: 'desktop-session', source: 'extension' }, { name: 'desktop-reload', source: 'extension' }]
  snapshots.set('host-1', value)
  const { user, input } = await launch()
  await waitFor(() => expect(api.open).toHaveBeenCalled())
  await user.type(input, '/reload {Enter}')
  await waitFor(() => expect(api.reload).toHaveBeenCalledWith('host-1'))
  expect(api.reconnect).not.toHaveBeenCalled()
  expect(api.command).not.toHaveBeenCalledWith('host-1', expect.objectContaining({ type: 'prompt' }))
  expect(input.value).toBe('')
  await user.click(screen.getByRole('button', { name: 'Extensions' }))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  await within(settings).findByRole('button', { name: 'Reload current chat' })
  await user.click(within(settings).getByRole('button', { name: 'Reload current chat' }))
  await waitFor(() => expect(api.reload).toHaveBeenCalledTimes(2))
  expect(api.reconnect).not.toHaveBeenCalled()
})

it('offers explicit extension recovery after native startup failure, preserves the draft and restores normal loading', async () => {
  resumedSession()
  vi.mocked(api.open).mockRejectedValueOnce(new PiApiError('Native extension could not load', 'extension_startup'))
  const { user, input } = await launch()
  const recover = await screen.findByRole('button', { name: 'Continue in recovery mode' })
  await user.type(input, 'Keep this unsent request')
  expect(api.open).toHaveBeenCalledTimes(1)
  const recovering = snapshot(); recovering.extensionRecovery = true
  snapshots.set('host-1', recovering); snapshots.set('host-2', snapshot('host-2'))
  await user.click(recover)
  await waitFor(() => expect(api.open).toHaveBeenLastCalledWith(project.cwd, '/test/session.jsonl', true))
  expect(await screen.findByText(/Recovery mode: automatically discovered extensions/)).toBeTruthy()
  expect(input.value).toBe('Keep this unsent request')
  expect(api.command).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Restore normal extension loading' }))
  await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith('host-1', false))
  await waitFor(() => expect(screen.queryByText(/Recovery mode: automatically discovered extensions/)).toBeNull())
  expect(input.value).toBe('Keep this unsent request')
})


it('reads an unopened transcript while native startup is held and replaces it without dropping the draft', async () => {
  const user = userEvent.setup(), ready = deferred<{ id: string }>()
  vi.mocked(api.projects).mockResolvedValue({ projects: [project] })
  const history = snapshot('')
  history.messages = [{ role: 'user', content: 'Saved question', entryId: 'u' }, { role: 'assistant', content: 'Saved answer', entryId: 'a' }]
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Saved chat', modified: new Date().toISOString(), messageCount: 2 }] })
  vi.mocked(api.previewSession).mockResolvedValue(history)
  vi.mocked(api.open).mockReturnValue(ready.promise)
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Saved chat' }))
  expect(await screen.findByText('Saved answer')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
  const composer = screen.getByRole('textbox', { name: 'Ask pi to work on your project…' })
  await user.type(composer, 'Later draft')
  snapshots.set('resumed', { ...history, sessionId: 'resumed' })
  await act(async () => { ready.resolve({ id: 'resumed' }); await ready.promise })
  await waitFor(() => expect(screen.queryByText('Restoring Pi… You can read the conversation while it connects.')).toBeNull())
  expect(screen.getAllByText('Saved answer')).toHaveLength(1)
  expect(composer).toHaveProperty('value', 'Later draft')
})

it('ignores late history previews when another chat is selected', async () => {
  const user = userEvent.setup(), preview = deferred<PiSnapshot | null>(), opening = deferred<{ id: string }>()
  vi.mocked(api.projects).mockResolvedValue({ projects: [project] })
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ id: 'old-native', path: '/test/old.jsonl', cwd: project.cwd, name: 'Old chat', modified: new Date().toISOString(), messageCount: 1 }] })
  vi.mocked(api.previewSession).mockReturnValue(preview.promise)
  vi.mocked(api.open).mockReturnValue(opening.promise)
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Old chat' }))
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  const old = snapshot(); old.messages = [{ role: 'user', content: 'Wrong conversation' }]
  await act(async () => { preview.resolve(old); opening.resolve({ id: 'host-1' }) })
  expect(screen.queryByText('Wrong conversation')).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Ask pi to work on your project…' })).toHaveProperty('value', '')
})


it('keeps readable history and its draft when Pi startup fails', async () => {
  const user = userEvent.setup()
  vi.mocked(api.projects).mockResolvedValue({ projects: [project] })
  const history = snapshot(''); history.messages = [{ role: 'assistant', content: 'Retained history' }]
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Unavailable runtime chat', modified: new Date().toISOString(), messageCount: 1 }] })
  vi.mocked(api.previewSession).mockResolvedValue(history)
  let reject!: (error: Error) => void
  vi.mocked(api.open).mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Unavailable runtime chat' }))
  await screen.findByText('Retained history')
  await user.type(screen.getByRole('textbox', { name: 'Ask pi to work on your project…' }), 'History draft')
  await act(async () => { reject(new Error('Native startup failed')) })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Native startup failed')
  expect(screen.getByText('Retained history')).toBeTruthy()
  vi.mocked(api.open).mockResolvedValue({ id: 'host-1' })
  await user.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(api.open).toHaveBeenLastCalledWith(project.cwd, '/test/session.jsonl'))
  expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'History draft' })
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(screen.getByRole('textbox', { name: 'Ask pi to work on your project…' })).toHaveProperty('value', '')
})


it('does not overwrite a streamed question with an older post-send HTTP snapshot', async () => {
  resumedSession()
  const late = deferred<PiSnapshot>()
  vi.mocked(api.snapshot).mockReturnValue(late.promise)
  const { user, input } = await launch()
  await user.type(input, 'Ask a question{Enter}')
  await waitFor(() => expect(api.snapshot).toHaveBeenCalled())
  const old = snapshot()
  const current = { ...old, pendingUI: [{ type: 'extension_ui_request' as const, id: 'new-question', method: 'select', title: 'Choose the next step', options: ['First', 'Second'] }] }
  await act(async () => { streams.at(-1)!.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: current }) })) })
  expect(screen.getByRole('region', { name: 'Choose the next step' })).toBeTruthy()
  await act(async () => { late.resolve(old); await late.promise })
  expect(screen.getByRole('region', { name: 'Choose the next step' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'Ask pi to work on your project…' })).toBeNull()
})

it('adds a quoted project file reference at the cursor and sends only the visible draft', async () => {
  existingProject()
  const files = vi.spyOn(api, 'file').mockResolvedValue({ kind: 'directory', root: project.cwd, path: project.cwd, entries: [{ name: 'source file.ts', path: project.cwd + '/source file.ts', kind: 'file' }] })
  vi.spyOn(api, 'fileTarget').mockResolvedValue({ root: project.cwd, path: project.cwd + '/source file.ts', directory: false })
  const { user, input } = await launch()
  await user.type(input, 'Read this carefully')
  input.setSelectionRange(9, 9)
  await user.click(screen.getByRole('button', { name: 'Add files and commands' }))
  expect(screen.queryByRole('button', { name: 'Configure providers' })).toBeNull()
  await user.click(screen.getByRole('option', { name: /Add files Reference/ }))
  await user.click(await screen.findByRole('option', { name: 'source file.ts' }))
  await waitFor(() => expect(input.value).toBe('Read this @"source file.ts"  carefully'))
  expect(files).toHaveBeenCalledWith(null, '.', project.cwd, expect.any(AbortSignal))
  expect(api.command).not.toHaveBeenCalled()
  await user.click(input)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Read this @"source file.ts"  carefully' }))
})

it('keeps a running draft through action selection, IME, Escape and outside dismissal', async () => {
  resumedSession()
  const value = snapshot('host-1', [{ provider: 'test', id: 'model' }]); value.state.isStreaming = true
  snapshots.set('host-1', value)
  const { user, input } = await launch()
  await user.type(input, 'Keep my draft')
  const open = async () => { await user.click(screen.getByRole('button', { name: 'Add files and commands' })); return screen.getByRole('combobox', { name: 'Search actions and commands…' }) }
  const search = await open()
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
  expect(screen.getByRole('listbox', { name: 'Add files and commands' })).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(input.value).toBe('Keep my draft')
  expect(api.command).not.toHaveBeenCalled()
  await open()
  await user.click(input)
  expect(screen.queryByRole('listbox')).toBeNull()
  await open()
  await user.click(screen.getByRole('option', { name: /Model \/model/ }))
  expect(input.value).toBe('Keep my draft')
  expect(await screen.findByRole('menuitem', { name: 'test · 1 models' })).toBeTruthy()
  expect(api.command).not.toHaveBeenCalled()
})

it('shows Pi context usage and max, then clears context when switching to a new draft', async () => {
  resumedSession()
  const value = snapshot(); value.contextUsage = { tokens: 32000, contextWindow: 128000, percent: 25 }; value.thinkingLevels = ['off', 'max']; value.state.thinkingLevel = 'max'
  value.completedContext = { usage: value.contextUsage }
  snapshots.set('host-1', value)
  const { user } = await launch()
  await screen.findByRole('img', { name: '25.0% context used. 32K / 128K tokens' })
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('Max')
  act(() => { streams[0]?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: { ...value, completedContext: { usage: { tokens: null, percent: null, contextWindow: 128000 } } } }) })) })
  expect(screen.getByRole('img', { name: /Context usage unknown.*next response/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(screen.queryByRole('img', { name: /context/i })).toBeNull()
})

it('hides context before the first completed reply and renders only completed context during later streaming', async () => {
  existingProject()
  const { user, input } = await launch()
  expect(screen.queryByRole('img', { name: /context/i })).toBeNull()
  const value = snapshot(); value.state.isStreaming = true; value.contextUsage = { tokens: 1000, contextWindow: 10000, percent: 10 }
  snapshots.set('host-1', value)
  await user.type(input, 'First message{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'First message' }))
  const publish = () => act(() => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: value }) })) })
  expect(screen.queryByRole('img', { name: /context/i })).toBeNull()
  value.messages = [{ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'tool', name: 'read', arguments: {} }] }]
  publish()
  expect(screen.queryByRole('img', { name: /context/i })).toBeNull()
  value.state.isStreaming = false; value.completedContext = { usage: value.contextUsage }; publish()
  expect(screen.getByRole('img', { name: '10.0% context used. 1K / 10K tokens' })).toBeTruthy()
  value.state.isStreaming = true; value.contextUsage = { tokens: 3000, contextWindow: 10000, percent: 30 }; publish()
  expect(screen.getByRole('img', { name: '10.0% context used. 1K / 10K tokens' })).toBeTruthy()
  value.state.isStreaming = false; value.completedContext = { usage: value.contextUsage }; publish()
  expect(screen.getByRole('img', { name: '30.0% context used. 3K / 10K tokens' })).toBeTruthy()
})


it('keeps thinking selectable in a new draft and applies it before the first prompt', async () => {
  existingProject()
  const model = { provider: 'test', id: 'reasoner', name: 'Reasoner', thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' }
  vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models: [model], defaultModel: model, extensionProvidersSupported: false, limitations: [] })
  const value = snapshot('host-1', [model]); value.thinkingLevels = model.thinkingLevels; value.state.thinkingLevel = 'high'; value.state.model = model
  snapshots.set('host-1', value)
  const { user, input } = await launch()
  expect((await screen.findByRole('button', { name: 'Thinking Level' })).textContent).toBe('Low')
  await user.click(screen.getByRole('button', { name: 'Thinking Level' }))
  await user.click(screen.getByRole('menuitem', { name: 'High' }))
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('High')
  expect(api.open).not.toHaveBeenCalled()
  expect(api.command).not.toHaveBeenCalled()
  await user.type(input, 'First message{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'First message' }))
  expect(vi.mocked(api.command).mock.calls.slice(0, 2).map(([, command]) => command.type)).toEqual(['set_thinking_level', 'prompt'])
  expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_thinking_level', level: 'high' })
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(screen.getByRole('button', { name: 'Thinking Level' })).toBeTruthy()
  expect(api.open).toHaveBeenCalledTimes(1)
})

it('remembers the active model and thinking level together when starting a chat in another project', async () => {
  resumedSession()
  const otherProject = { cwd: '/test/other', name: 'Other' }
  vi.mocked(api.projects).mockResolvedValue({ projects: [project, otherProject] })
  const models = [
    { provider: 'first', id: 'reasoner', name: 'First reasoner', thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' },
    { provider: 'second', id: 'reasoner', name: 'Second reasoner', thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' },
  ]
  vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models, defaultModel: models[0], extensionProvidersSupported: false, limitations: [] })
  const value = snapshot('host-1', models); value.state.model = models[0]; value.state.thinkingLevel = 'low'; value.thinkingLevels = models[0]!.thinkingLevels
  snapshots.set('host-1', value)
  vi.mocked(api.command).mockImplementation(async (_id, command) => {
    if (command.type === 'set_model') value.state.model = models.find(model => model.provider === command.provider && model.id === command.modelId)
    if (command.type === 'set_thinking_level') value.state.thinkingLevel = String(command.level)
    act(() => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: value }) })) })
  })
  const { user, input } = await launch()
  await screen.findByRole('button', { name: 'Thinking Level' })
  await user.type(input, '/model second/reasoner{Enter}')
  await user.type(input, '/thinking high{Enter}')
  await waitFor(() => expect(api.savePreferences).toHaveBeenCalledWith({ lastModel: { provider: 'second', id: 'reasoner', name: 'Second reasoner', thinkingLevel: 'high' } }))
  await user.click(screen.getByRole('button', { name: 'New chat in Other' }))
  expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('Second reasoner')
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('High')
  const next = snapshot('host-2', models); next.state.model = models[0]; next.state.thinkingLevel = 'low'; next.thinkingLevels = models[0]!.thinkingLevels
  snapshots.set('host-2', next)
  vi.mocked(api.open).mockResolvedValue({ id: 'host-2' })
  vi.mocked(api.command).mockImplementation(async (_id, command) => {
    if (command.type === 'set_model') next.state.model = models[1]
    if (command.type === 'set_thinking_level') next.state.thinkingLevel = String(command.level)
  })
  vi.mocked(api.command).mockClear()
  await user.type(input, 'Continue here{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-2', { type: 'prompt', message: 'Continue here' }))
  expect(api.open).toHaveBeenLastCalledWith(otherProject.cwd, undefined)
  expect(vi.mocked(api.command).mock.calls.map(([, command]) => command)).toEqual([
    { type: 'set_model', provider: 'second', modelId: 'reasoner' }, { type: 'set_thinking_level', level: 'high' }, { type: 'prompt', message: 'Continue here' },
  ])
})

it('restores the last model after restart and waits for both choices before subscribing or sending', async () => {
  existingProject()
  const remembered = { provider: 'test', id: 'reasoner', name: 'Remembered reasoner', thinkingLevel: 'high' }
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', cwd: project.cwd, lastModel: remembered })
  const model = { ...remembered, thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' }
  vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models: [model], defaultModel: model, extensionProvidersSupported: false, limitations: [] })
  const value = snapshot('host-1', [model]); value.state.model = model; value.state.thinkingLevel = 'low'; value.thinkingLevels = model.thinkingLevels
  snapshots.set('host-1', value)
  const applying = deferred<void>(); finishRequests.push(() => applying.resolve())
  vi.mocked(api.command).mockImplementation(async (_id, command) => {
    if (command.type === 'set_thinking_level') { await applying.promise; value.state.thinkingLevel = 'high' }
  })
  const { user, input } = await launch()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('High'))
  expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain(remembered.name)
  expect(api.open).not.toHaveBeenCalled()
  await user.type(input, 'Use remembered choices{Enter}')
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'set_thinking_level', level: 'high' }))
  expect(streams).toHaveLength(0)
  expect(vi.mocked(api.command).mock.calls.some(([, command]) => command.type === 'prompt')).toBe(false)
  expect(vi.mocked(api.savePreferences).mock.calls.some(([patch]) => patch.lastModel !== undefined)).toBe(false)
  await act(async () => { applying.resolve(); await applying.promise })
  await waitFor(() => expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Use remembered choices' }))
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('High')
})

it('retains an unavailable remembered model and the draft when Pi rejects it instead of sending with another model', async () => {
  existingProject()
  const remembered = { provider: 'removed', id: 'reasoner', name: 'Unavailable reasoner', thinkingLevel: 'high' }
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', cwd: project.cwd, lastModel: remembered })
  vi.mocked(api.command).mockRejectedValue(new Error('Model not found: removed/reasoner'))
  const { user, input } = await launch()
  await user.type(input, 'Keep my model{Enter}')
  await screen.findByText('Model not found: removed/reasoner')
  expect(input.value).toBe('Keep my model')
  expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain(remembered.name)
  expect(vi.mocked(api.command).mock.calls.map(([, command]) => command.type)).toEqual(['set_model'])
  expect(vi.mocked(api.savePreferences).mock.calls.some(([patch]) => patch.lastModel !== undefined)).toBe(false)
})

it('updates draft thinking choices with the selected model without starting Pi', async () => {
  existingProject()
  const models = [
    { provider: 'test', id: 'reasoner', name: 'Reasoner', thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' },
    { provider: 'test', id: 'plain', name: 'Plain', thinkingLevels: ['off'], thinkingLevel: 'off' },
    { provider: 'test', id: 'advanced', name: 'Advanced', thinkingLevels: ['high', 'max'], thinkingLevel: 'max' },
  ]
  vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models, defaultModel: models[0], extensionProvidersSupported: false, limitations: [] })
  const { user, input } = await launch()
  await screen.findByRole('button', { name: 'Thinking Level' })
  await user.type(input, '/thinking high{Enter}')
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('High')
  await user.type(input, '/model test/plain{Enter}')
  expect(screen.queryByRole('button', { name: 'Thinking Level' })).toBeNull()
  await user.type(input, '/model test/advanced{Enter}')
  expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('Max')
  await user.click(screen.getByRole('button', { name: 'Thinking Level' }))
  expect(screen.queryByRole('menuitem', { name: 'Low' })).toBeNull()
  expect(screen.getByRole('menuitem', { name: 'Max' })).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(api.open).not.toHaveBeenCalled()
  expect(api.command).not.toHaveBeenCalled()
})


it('does not apply a draft thinking choice when reopening an existing chat', async () => {
  resumedSession()
  const model = { provider: 'test', id: 'reasoner', name: 'Reasoner', thinkingLevels: ['off', 'low', 'high'], thinkingLevel: 'low' }
  vi.mocked(api.providers).mockResolvedValue({ agentDir: '/test/agent', sdkVersion: '0.99.1', providers: [], models: [model], defaultModel: model, extensionProvidersSupported: false, limitations: [] })
  const value = snapshot('host-1', [model]); value.state.model = model; value.state.thinkingLevel = 'low'; value.thinkingLevels = model.thinkingLevels
  snapshots.set('host-1', value)
  const { user } = await launch()
  await screen.findByRole('button', { name: 'Thinking Level' })
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  await user.click(screen.getByRole('button', { name: 'Thinking Level' }))
  await user.click(screen.getByRole('menuitem', { name: 'High' }))
  await user.click(screen.getByRole('button', { name: 'Chat' }))
  await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thinking Level' }).textContent).toBe('Low'))
  expect(api.command).not.toHaveBeenCalled()
})


it.each(['header', 'project', 'keyboard', 'command'] as const)('opens a blank composer through %s and adds history only after the first message', async entry => {
  existingProject()
  window.piDesktop = { platform: 'win32', pickDirectory: async () => null, openExternal: async () => {} }
  vi.mocked(api.command).mockImplementation(async (_id, command) => {
    if (command.type !== 'prompt') return
    const value = snapshot(); value.state.isStreaming = true; value.messages = [{ role: 'user', content: 'Opening message' }]
    snapshots.set('host-1', value)
    vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ id: 'native-pi', path: '/test/session.jsonl', cwd: project.cwd, name: 'Opening message', modified: '2026-10-03T00:00:00Z', messageCount: 1 }] })
  })
  const { user, input } = await launch()
  await user.type(input, entry === 'command' ? '/new ' : 'Unsent text')
  if (entry === 'header') await user.click(screen.getByRole('button', { name: 'New chat' }))
  else if (entry === 'project') await user.click(screen.getByRole('button', { name: 'New chat in Project' }))
  else if (entry === 'keyboard') await user.keyboard('{Control>}n{/Control}')
  else await user.keyboard('{Enter}')
  expect(input.value).toBe('')
  expect(screen.getByRole('heading', { name: 'What are we working on?' })).toBeTruthy()
  const history = screen.getByLabelText('Chat history')
  expect(within(history).queryByRole('button', { name: 'New chat draft' })).toBeNull()
  expect(within(history).queryByRole('button', { name: 'Opening message' })).toBeNull()
  expect(api.open).not.toHaveBeenCalled()
  await user.type(input, 'Opening message')
  expect(within(history).queryByRole('button', { name: 'Opening message' })).toBeNull()
  await user.keyboard('{Enter}')
  expect(await within(history).findByRole('button', { name: 'Opening message' })).toBeTruthy()
  expect(api.open).toHaveBeenCalledTimes(1)
  expect(api.command).toHaveBeenCalledWith('host-1', { type: 'prompt', message: 'Opening message' })
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
})


it('keeps project-free New chat blank and asks for a project only on first Send', async () => {
  const { user, input } = await launch()
  await user.type(input, 'An unsent project-free draft')
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(input.value).toBe('')
  expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull()
  expect(api.open).not.toHaveBeenCalled()
  await user.type(input, 'Choose a project when sending{Enter}')
  expect(await screen.findByRole('dialog', { name: 'Add project' })).toBeTruthy()
  expect(input.value).toBe('Choose a project when sending')
  expect(api.open).not.toHaveBeenCalled()
})

it('preserves an unsent draft while clearing, searching and choosing a project', async () => {
  existingProject()
  vi.mocked(api.projects).mockResolvedValue({ projects: [project, { cwd: '/test/other', name: 'Other' }] })
  const { user, input } = await launch()
  await screen.findByRole('button', { name: 'Clear project selection' })
  await user.type(input, 'Keep this draft')
  await user.click(screen.getByRole('button', { name: 'Clear project selection' }))
  expect(input.value).toBe('Keep this draft')
  await waitFor(() => { expect(api.savePreferences).toHaveBeenCalledWith({ cwd: '', sessionId: '', sessionFile: '' }) })
  await user.click(screen.getByRole('button', { name: 'Choose a project' }))
  await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'other')
  await user.click(screen.getByRole('menuitem', { name: /Other/ }))
  expect(input.value).toBe('Keep this draft')
  await waitFor(() => { expect(api.savePreferences).toHaveBeenCalledWith({ cwd: '/test/other', sessionId: '', sessionFile: '' }) })
  expect(api.open).not.toHaveBeenCalled()
  expect(screen.queryByText('Read, edit, and run code in your project')).toBeNull()
})

it('restores a cleared project selection even when registered projects remain', async () => {
  vi.mocked(api.preferences).mockResolvedValue({ locale: 'en', cwd: '', sessionId: '', sessionFile: '' })
  vi.mocked(api.projects).mockResolvedValue({ projects: [project] })
  await launch()
  await screen.findByRole('group', { name: 'Project and branch' })
  expect(screen.queryByRole('button', { name: 'Clear project selection' })).toBeNull()
  expect(api.projectGit).not.toHaveBeenCalled()
  expect(api.open).not.toHaveBeenCalled()
})

it('shows branch safety failures in the create form and preserves the draft through a successful switch', async () => {
  existingProject()
  const repository = { kind: 'repository' as const, root: project.cwd, branch: 'main', head: 'a'.repeat(40), revision: 'main-a', branches: [{ name: 'main', current: true, worktree: project.cwd }, { name: 'topic', current: false, worktree: null }], changedFiles: 1, conflicts: false, operation: null }
  vi.mocked(api.projectGit).mockResolvedValue(repository)
  const change = vi.spyOn(api, 'changeGitBranch').mockResolvedValueOnce({ ok: false, issue: 'invalid-name' }).mockResolvedValueOnce({ ok: true, state: { ...repository, branch: 'codex/test', revision: 'test-a' } })
  const { user, input } = await launch()
  await user.type(input, 'Still here')
  await user.click(await screen.findByRole('button', { name: 'Switch Git branch' }))
  await user.click(screen.getByRole('menuitem', { name: 'Create branch…' }))
  const dialog = screen.getByRole('dialog', { name: 'Create and switch branch' })
  await user.type(within(dialog).getByRole('textbox', { name: 'Branch name' }), 'bad name')
  await user.click(within(dialog).getByRole('button', { name: 'Create and switch' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Enter a valid Git branch name.')
  await user.clear(within(dialog).getByRole('textbox', { name: 'Branch name' }))
  await user.type(within(dialog).getByRole('textbox', { name: 'Branch name' }), 'codex/test')
  await user.click(within(dialog).getByRole('button', { name: 'Create and switch' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(change).toHaveBeenLastCalledWith(project.cwd, 'create', 'codex/test', 'main-a')
  expect(screen.getByRole('button', { name: 'Switch Git branch' }).textContent).toContain('codex/test')
  expect(input.value).toBe('Still here')
})


it('replaces the first-message sidebar title only after Pi publishes the generated native name', async () => {
  existingProject()
  const first = '请生成项目报告并读回确认内容正确'
  const native = snapshot()
  native.state.isStreaming = true
  native.messages = [{ role: 'user', content: first }]
  snapshots.set('host-1', native)
  const { user, input } = await launch()
  await user.type(input, first + '{Enter}')
  const group = screen.getByRole('region', { name: 'Project' })
  await waitFor(() => expect(within(group).getByText(first)).toBeTruthy())
  const entry = { id: 'native-pi', cwd: project.cwd, path: '/test/session.jsonl', name: first, modified: '2026-10-04T00:00:00Z', messageCount: 2 }
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [entry] })
  const finished = { ...native, state: { ...native.state, isStreaming: false }, messages: [...native.messages, { role: 'assistant', content: '报告已完成', stopReason: 'stop' }] }
  await act(async () => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: finished }) })) })
  await within(group).findByRole('button', { name: first })
  vi.mocked(api.sessions).mockResolvedValue({ sessions: [{ ...entry, name: '项目报告生成与核验' }] })
  await act(async () => { streams.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', snapshot: { ...finished, state: { ...finished.state, sessionName: '项目报告生成与核验' } } }) })) })
  expect(await within(group).findByRole('button', { name: '项目报告生成与核验' })).toBeTruthy()
  expect(within(group).queryByText(first)).toBeNull()
  expect(within(screen.getByRole('log', { name: 'Conversation' })).getByText(first)).toBeTruthy()
})
