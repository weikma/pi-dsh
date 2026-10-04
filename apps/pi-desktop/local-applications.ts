/** Verified local application choices and file actions shared by Desktop and Web. */
import { execFile, spawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { FileEditor, editorLaunch } from './file-actions.ts'
import type { FileActionRequest, FileActionResult, LocalApplication, LocalApplicationId, LocalApplicationsView } from './local-files-types.ts'
import { isJsonObject } from './bridge/types.ts'

/** Native dialogs and shell actions stay in Electron; every caller still uses Host path validation. */
export interface NativeApplications {
  chooseEditor(): Promise<string | null>
  open(path: string): Promise<void>
  reveal(path: string): Promise<void>
}

export interface ApplicationLaunch { command: string; args: string[]; wait: boolean; target?: string }
export interface ResolvedApplication extends LocalApplication { executable: string }
interface ApplicationDefinition extends LocalApplication {
  mac?: string
  windows?: string
  linux?: string
}

const APPLICATIONS: readonly ApplicationDefinition[] = [
  { id: 'vscode', name: 'Visual Studio Code', kind: 'editor', mac: 'Visual Studio Code.app', windows: 'Microsoft VS Code/Code.exe', linux: 'code' },
  { id: 'cursor', name: 'Cursor', kind: 'editor', mac: 'Cursor.app', windows: 'cursor/Cursor.exe', linux: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', mac: 'Windsurf.app', windows: 'Windsurf/Windsurf.exe', linux: 'windsurf' },
  { id: 'zed', name: 'Zed', kind: 'editor', mac: 'Zed.app', windows: 'Zed/zed.exe', linux: 'zed' },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', mac: 'Sublime Text.app', windows: 'Sublime Text/sublime_text.exe', linux: 'subl' },
  { id: 'textedit', name: 'TextEdit', kind: 'editor', mac: '/System/Applications/TextEdit.app' },
  { id: 'notepad', name: 'Notepad', kind: 'editor', windows: 'system:notepad.exe' },
  { id: 'iterm', name: 'iTerm', kind: 'terminal', mac: 'iTerm.app' },
  { id: 'warp', name: 'Warp', kind: 'terminal', mac: 'Warp.app' },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', mac: 'Ghostty.app', linux: 'ghostty' },
  { id: 'terminal', name: 'Terminal', kind: 'terminal', mac: '/System/Applications/Utilities/Terminal.app' },
  { id: 'windows-terminal', name: 'Windows Terminal', kind: 'terminal', windows: 'path:wt.exe' },
  { id: 'gnome-terminal', name: 'GNOME Terminal', kind: 'terminal', linux: 'gnome-terminal' },
  { id: 'konsole', name: 'Konsole', kind: 'terminal', linux: 'konsole' },
  { id: 'kitty', name: 'kitty', kind: 'terminal', mac: 'kitty.app', linux: 'kitty' },
]

const environmentValue = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

/** A forwarded browser must not open windows on an unattended SSH or headless Host. */
export function localDesktopAvailable(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION?.trim() || env.SSH_TTY?.trim()) return false
  return platform === 'darwin' || platform === 'win32' || platform === 'linux' && Boolean(env.DISPLAY?.trim() || env.WAYLAND_DISPLAY?.trim())
}

async function usable(path: string, bundle: boolean, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await stat(path)
    if (bundle ? !info.isDirectory() : !info.isFile()) return false
    if (!bundle && platform !== 'win32') await access(path, constants.X_OK)
    return true
  } catch (error) {
    if (isJsonObject(error) && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))) return false
    throw error
  }
}

/** Discover only known launchers; neither a request nor a model supplies these executable paths. */
export async function discoverApplications(platform = process.platform, env = process.env, home = homedir()): Promise<ResolvedApplication[]> {
  if (!localDesktopAvailable(platform, env)) return []
  const pathDirectories = (environmentValue(env, 'PATH') ?? '').split(platform === 'win32' ? ';' : delimiter).filter(path => path && isAbsolute(path))
  const applications: ResolvedApplication[] = []
  for (const definition of APPLICATIONS) {
    let candidates: string[] = []
    if (platform === 'darwin' && definition.mac) {
      candidates = isAbsolute(definition.mac) ? [definition.mac] : [join('/Applications', definition.mac), join(home, 'Applications', definition.mac)]
    } else if (platform === 'linux' && definition.linux) {
      const command = definition.linux
      candidates = pathDirectories.map(path => join(path, command))
    } else if (platform === 'win32' && definition.windows) {
      const target = definition.windows
      if (target.startsWith('path:')) candidates = pathDirectories.map(path => join(path, target.slice(5)))
      else if (target.startsWith('system:')) {
        const system = environmentValue(env, 'SystemRoot')
        if (system) candidates = [join(system, 'System32', target.slice(7))]
      } else {
        const local = environmentValue(env, 'LOCALAPPDATA')
        const roots = [local && join(local, 'Programs'), environmentValue(env, 'ProgramFiles'), environmentValue(env, 'ProgramFiles(x86)')]
        candidates = roots.flatMap(root => root ? [join(root, target)] : [])
      }
    }
    for (const executable of candidates) {
      if (!await usable(executable, platform === 'darwin', platform)) continue
      applications.push({ id: definition.id, name: definition.name, kind: definition.kind, executable })
      break
    }
  }
  return applications
}

/** Application-specific directory switches stay in literal argv, including paths with shell syntax. */
export function applicationLaunch(platform: NodeJS.Platform, application: ResolvedApplication, path: string): ApplicationLaunch {
  if (platform === 'darwin') return { ...editorLaunch(platform, application.executable, path), wait: true }
  const directoryArguments: Partial<Record<LocalApplicationId, (path: string) => string[]>> = {
    'windows-terminal': path => ['-d', path],
    'gnome-terminal': path => ['--working-directory=' + path],
    ghostty: path => ['--working-directory=' + path],
    konsole: path => ['--workdir', path],
    kitty: path => ['--directory', path],
  }
  return { command: application.executable, args: directoryArguments[application.id]?.(path) ?? [path], wait: false }
}

/** Only the operating system's fixed dispatcher receives a target path; no shell parses that path. */
export function systemFileLaunch(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, path: string, reveal: boolean, directory: boolean): ApplicationLaunch {
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [...(reveal && !directory ? ['-R'] : []), '--', path], wait: true }
  if (platform === 'win32') {
    const system = environmentValue(env, 'SystemRoot')
    if (!system) throw new Error('Windows application opening is unavailable')
    const script = '$start = New-Object System.Diagnostics.ProcessStartInfo; $start.FileName = $env:PI_DSH_OPEN_TARGET; $start.UseShellExecute = $true; [System.Diagnostics.Process]::Start($start) | Out-Null'
    return { command: join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], wait: true, target: reveal && !directory ? dirname(path) : path }
  }
  if (platform === 'linux') return { command: 'xdg-open', args: [reveal && !directory ? dirname(path) : path], wait: true }
  throw new Error('Local application opening is unavailable')
}

/** GUI applications inherit the desktop environment without model/provider credentials. */
function launchEnvironment(env: NodeJS.ProcessEnv, target?: string): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !/api.?key|token|secret|password|credential/i.test(key))), ...(target === undefined ? {} : { PI_DSH_OPEN_TARGET: target }) }
}

/** Join short OS dispatchers on failure/cancellation; detached application processes become user-owned. */
export async function runApplicationLauncher(launch: ApplicationLaunch, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const environment = launchEnvironment(env, launch.target)
  if (launch.wait) {
    await new Promise<void>((resolve, reject) => {
      let failure: Error | undefined
      const child = execFile(launch.command, launch.args, { env: environment, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, windowsHide: true }, error => { if (error && !failure) failure = error })
      // Node's AbortSignal path may send SIGTERM independently of execFile's timeout signal.
      const cancel = () => { failure = signal.reason instanceof Error ? signal.reason : new Error('Application opening cancelled'); child.kill('SIGKILL') }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      child.once('error', error => { failure = error })
      child.once('close', () => { signal.removeEventListener('abort', cancel); if (failure) reject(failure); else resolve() })
    })
    return
  }
  // A successfully spawned editor or terminal belongs to the user, not to Host teardown.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { env: environment, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

interface LocalApplicationsOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  native?: NativeApplications
  discover?: () => Promise<ResolvedApplication[]>
  launch?: (launch: ApplicationLaunch, signal: AbortSignal) => Promise<void>
}

/** Own short launcher processes and pending dialogs; closing prevents late preference writes. */
export class LocalApplications {
  private readonly stopped = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly editor: FileEditor
  constructor(preferencesPath: string, private readonly options: LocalApplicationsOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = options.env ?? process.env
    this.editor = new FileEditor(preferencesPath, this.platform)
  }
  private operation<T>(run: () => Promise<T>): Promise<T> {
    const operation = Promise.resolve().then(async () => { this.stopped.signal.throwIfAborted(); return run() })
    this.pending.add(operation)
    void operation.then(() => { this.pending.delete(operation) }, () => { this.pending.delete(operation) })
    return operation
  }
  private catalog(): Promise<ResolvedApplication[]> {
    return this.options.discover?.() ?? discoverApplications(this.platform, this.environment)
  }
  list(): Promise<LocalApplicationsView> {
    return this.operation(async () => {
      if (!localDesktopAvailable(this.platform, this.environment)) return { available: false, applications: [], canChooseEditor: false }
      const applications = await this.catalog()
      const selected = await this.editor.selected()
      return { available: true, applications: applications.map(({ id, name, kind }) => ({ id, name, kind })),
        ...(selected === undefined ? {} : { editorName: applications.find(app => app.executable === selected)?.name ?? basename(selected).replace(/\.(app|exe)$/i, '') }),
        canChooseEditor: this.options.native !== undefined }
    })
  }
  private chooseEditor(): Promise<string | null> {
    const native = this.options.native
    if (!native) throw new Error('Choose an editor from the available applications')
    const signal = this.stopped.signal
    return new Promise((resolve, reject) => {
      const cancel = () => { reject(signal.reason) }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) { signal.removeEventListener('abort', cancel); reject(signal.reason); return }
      void native.chooseEditor().then(resolve, reject).finally(() => { signal.removeEventListener('abort', cancel) })
    })
  }
  private launch(value: ApplicationLaunch): Promise<void> {
    this.stopped.signal.throwIfAborted()
    return this.options.launch?.(value, this.stopped.signal) ?? runApplicationLauncher(value, this.environment, this.stopped.signal)
  }
  /** Targets must already be canonical files/directories inside a registered project. */
  open(request: FileActionRequest, target: { path: string; directory: boolean }): Promise<FileActionResult> {
    return this.operation(async () => {
      if (!localDesktopAvailable(this.platform, this.environment)) throw new Error('Local applications are unavailable in this environment')
      switch (request.action) {
        case 'application': {
          const application = (await this.catalog()).find(app => app.id === request.applicationId)
          if (!application) throw new Error('This application is no longer available')
          if (application.kind === 'terminal' && !target.directory) throw new Error('Choose a project directory to open in a terminal')
          this.stopped.signal.throwIfAborted()
          if (application.kind === 'editor') await this.editor.choose(application.executable, this.stopped.signal)
          await this.launch(applicationLaunch(this.platform, application, target.path))
          return { status: 'opened' }
        }
        case 'editor':
        case 'chooseEditor': {
          let editor = request.action === 'editor' ? await this.editor.selected() : undefined
          if (editor === undefined) {
            const choice = await this.chooseEditor()
            this.stopped.signal.throwIfAborted()
            if (choice === null) return { status: 'cancelled' }
            await this.editor.choose(choice, this.stopped.signal)
            editor = choice
          }
          await this.launch({ ...editorLaunch(this.platform, editor, target.path), wait: this.platform === 'darwin' })
          return { status: 'opened' }
        }
        case 'system':
        case 'reveal':
          this.stopped.signal.throwIfAborted()
          if (this.options.native) {
            if (request.action === 'reveal' && !target.directory) await this.options.native.reveal(target.path)
            else await this.options.native.open(target.path)
          } else await this.launch(systemFileLaunch(this.platform, this.environment, target.path, request.action === 'reveal', target.directory))
          return { status: 'opened' }
      }
    })
  }
  async close(): Promise<void> {
    this.stopped.abort(new Error('Local application actions stopped'))
    await Promise.allSettled([...this.pending])
  }
}
