/** Native actions operate on Host-resolved project files and user-selected applications. */
import { execFile, spawn } from 'node:child_process'
import { access, readFile, stat, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isJsonObject } from './bridge/types.ts'

/** A specific native action; executable paths never come from model output. */
export interface NativeFileRequest { cwd: string; path: string; action: 'editor' | 'chooseEditor' | 'system' | 'reveal' }

/** Validate the native wire request before resolving it on the loopback Host. */
export function nativeFileRequest(value: unknown): NativeFileRequest {
  if (!isJsonObject(value) || typeof value.cwd !== 'string' || !isAbsolute(value.cwd) || typeof value.path !== 'string' || !value.path) throw new Error('A project file is required')
  const action = value.action
  if (action !== 'editor' && action !== 'chooseEditor' && action !== 'system' && action !== 'reveal') throw new Error('Unsupported file action')
  return { cwd: value.cwd, path: value.path, action }
}

/** Shell-free arguments keep filenames and application paths as literal values. */
export function editorLaunch(platform: string, editor: string, file: string): { command: string; args: string[] } {
  if (!isAbsolute(editor) || !isAbsolute(file) || editor.includes('\0') || file.includes('\0')) throw new Error('Absolute application and file paths are required')
  return platform === 'darwin' ? { command: '/usr/bin/open', args: ['-a', editor, '--', file] } : { command: editor, args: [file] }
}

/** GUI-owned editor preference, validated against its native resource before each launch. */
export class FileEditor {
  constructor(private readonly preferencesPath: string, private readonly platform = process.platform) {}
  async selected(): Promise<string | undefined> {
    try {
      const data: unknown = JSON.parse(await readFile(this.preferencesPath, 'utf8'))
      if (!isJsonObject(data) || typeof data.path !== 'string') throw new Error('Invalid editor preferences')
      await this.validate(data.path)
      return data.path
    } catch (error) {
      if (isJsonObject(error) && error.code === 'ENOENT') return undefined
      throw error
    }
  }
  async choose(path: string): Promise<void> {
    await this.validate(path)
    await mkdir(dirname(this.preferencesPath), { recursive: true })
    const temporary = join(dirname(this.preferencesPath), '.editor-' + randomUUID() + '.json')
    try {
      await writeFile(temporary, JSON.stringify({ path }) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.preferencesPath)
    } finally { await rm(temporary, { force: true }) }
  }
  private async validate(path: string): Promise<void> {
    if (!isAbsolute(path)) throw new Error('Select an application with an absolute path')
    const info = await stat(path)
    if (this.platform === 'darwin' ? !info.isDirectory() || extname(path).toLowerCase() !== '.app' : !info.isFile()) throw new Error('Select an editor application')
    if (this.platform === 'win32' && extname(path).toLowerCase() !== '.exe') throw new Error('Select an executable editor')
    if (this.platform !== 'darwin' && this.platform !== 'win32') await access(path, constants.X_OK)
  }
  /** The chosen GUI app is user-owned after spawn; Desktop does not await or terminate it. */
  async open(editor: string, file: string): Promise<void> {
    await this.validate(editor)
    const launch = editorLaunch(this.platform, editor, file)
    if (this.platform === 'darwin') { await promisify(execFile)(launch.command, launch.args, { timeout: 15_000 }); return }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, { stdio: 'ignore', windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
  }
}
