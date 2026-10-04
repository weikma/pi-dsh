/** Browse Host directories before project registration without reading their file contents. */
import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { DirectoryListing } from './local-files-types.ts'
import { isJsonObject } from './bridge/types.ts'

const MAX_DIRECTORIES = 1000

async function directory(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('An absolute directory path is required')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error('Choose an existing directory')
  return canonical
}

/** List only directories, including reachable directory symlinks; inaccessible children are omitted. */
export async function listDirectories(path: string | undefined, home = homedir()): Promise<DirectoryListing> {
  const current = await directory(path?.trim() || home)
  const children = await readdir(current, { withFileTypes: true })
  const entries: DirectoryListing['entries'] = []
  for (const entry of children) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const child = join(current, entry.name)
    if (entry.isSymbolicLink()) {
      try { if (!(await stat(child)).isDirectory()) continue }
      catch (error) {
        if (isJsonObject(error) && ['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(String(error.code))) continue
        throw error
      }
    }
    entries.push({ name: entry.name, path: child, hidden: entry.name.startsWith('.') })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const parent = dirname(current)
  return { path: current, parent: parent === current ? null : parent, home: resolve(home), entries: entries.slice(0, MAX_DIRECTORIES), truncated: entries.length > MAX_DIRECTORIES }
}

/** Create one explicitly named child; existing entries and traversal are never overwritten. */
export async function createDirectory(input: unknown): Promise<{ path: string }> {
  if (!isJsonObject(input) || typeof input.path !== 'string' || typeof input.name !== 'string') throw new Error('A parent directory and folder name are required')
  const name = input.name.trim()
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new Error('Enter one folder name without path separators')
  if (process.platform === 'win32' && (/[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) throw new Error('This folder name is not supported on Windows')
  const parent = await directory(input.path)
  const path = join(parent, name)
  await mkdir(path)
  return { path: await realpath(path) }
}
