import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isJsonObject } from './bridge/types.ts'
import { isUnreadChat, type UnreadChat, type UnreadReceipt } from './unread-types.ts'

/** Durable GUI read state; native session files are never changed. Writes and receipts serialize. */
export class UnreadChats {
  private items = new Map<string, UnreadChat>()
  private pending = Promise.resolve()
  private listeners = new Set<() => void>()
  private closed = false

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<UnreadChats> {
    const store = new UnreadChats(path)
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!isJsonObject(value) || value.version !== 1 || !Array.isArray(value.items) || !value.items.every(isUnreadChat)) throw new Error('Invalid unread chat metadata')
      store.items = new Map(value.items.map(item => [item.nativeSessionId, { nativeSessionId: item.nativeSessionId, cwd: item.cwd, sessionFile: item.sessionFile, entryId: item.entryId }]))
    } catch (error) {
      if (!(isJsonObject(error) && error.code === 'ENOENT')) console.error('Pi DSH could not restore unread chats:', error instanceof Error ? error.message : String(error))
    }
    return store
  }

  snapshot(): UnreadChat[] { return [...this.items.values()].map(item => ({ ...item })) }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  mark(item: UnreadChat): Promise<void> {
    return this.update(async items => {
      if (items.get(item.nativeSessionId)?.entryId === item.entryId) return false
      const sessionFile = await realpath(item.sessionFile)
      items.set(item.nativeSessionId, { ...item, sessionFile }); return true
    })
  }

  /** An older visible reply cannot acknowledge a newer completion in the same chat. */
  read(receipt: UnreadReceipt): Promise<void> {
    return this.update(items => items.get(receipt.nativeSessionId)?.entryId === receipt.entryId && items.delete(receipt.nativeSessionId))
  }

  private update(change: (items: Map<string, UnreadChat>) => boolean | Promise<boolean>): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Unread chat storage is closed'))
    const operation = this.pending.then(async () => {
      const next = new Map(this.items)
      if (!await change(next)) return
      const temporary = this.path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, items: [...next.values()] }) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.path)
        this.items = next
        if (!this.closed) for (const listener of this.listeners) listener()
      } finally { await rm(temporary, { force: true }) }
    })
    this.pending = operation.catch(error => { void error /* The caller reports this write failure; subsequent writes may retry. */ })
    return operation
  }

  /** Stop publications and join accepted writes before the Host finishes closing. */
  async close(): Promise<void> { this.closed = true; this.listeners.clear(); await this.pending }
}
