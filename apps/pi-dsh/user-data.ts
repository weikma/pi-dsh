/** Import GUI settings into the current product directories without changing Pi-owned data. */
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isJsonObject } from './bridge/types.ts'

/** Publish complete bytes once; concurrent starts and existing destination settings win safely. */
async function copyIfMissing(source: string, destination: string): Promise<void> {
  try { await stat(destination); return }
  catch (error) { if (!isJsonObject(error) || error.code !== 'ENOENT') throw error }
  let data: Buffer
  try { data = await readFile(source) }
  catch (error) { if (isJsonObject(error) && error.code === 'ENOENT') return; throw error }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(destination), '.import-' + randomUUID())
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
    try { await link(temporary, destination) }
    catch (error) { if (!isJsonObject(error) || error.code !== 'EEXIST') throw error }
  } finally { await rm(temporary, { force: true }) }
}

/** Import preferences only for the default GUI home; callers bypass this for explicit homes. */
export async function importGuiPreferences(userHome: string, destination: string): Promise<void> {
  const previous = join(userHome, '.pi-desktop')
  for (const name of ['preferences.json', 'editor.json', 'unread-chats.json']) await copyIfMissing(join(previous, name), join(destination, name))
}

/** Packaged defaults retain the exact selected command; runtime installations stay at their original paths. */
export async function importRuntimeSelection(appData: string, destination: string): Promise<void> {
  await copyIfMissing(join(appData, '@deepseek-ai', 'pi-desktop', 'runtime.json'), destination)
}
