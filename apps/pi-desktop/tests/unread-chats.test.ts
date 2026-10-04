import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { UnreadChats } from '../unread-chats.ts'

test('unread chats deduplicate sessions, survive restart and reject stale read receipts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-unread-chats-')))
  const path = join(root, 'unread.json')
  const store = await UnreadChats.open(path)
  const first = { nativeSessionId: 'one', cwd: root, sessionFile: join(root, 'one.jsonl'), entryId: 'reply-1' }
  const second = { nativeSessionId: 'two', cwd: root, sessionFile: join(root, 'two.jsonl'), entryId: 'reply-2' }
  const counts: number[] = []
  store.subscribe(() => { counts.push(store.snapshot().length) })
  let restored: UnreadChats | undefined
  try {
    await Promise.all([writeFile(first.sessionFile, 'native history'), writeFile(second.sessionFile, 'native history')])
    await store.mark(first); await store.mark(first); await store.mark(second)
    const latest = { ...first, entryId: 'reply-3' }
    const alias = join(root, 'alias')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await Promise.all([store.mark({ ...latest, sessionFile: join(alias, 'one.jsonl') }), store.read(first)])
    assert.deepEqual(store.snapshot(), [latest, second])
    assert.deepEqual(counts, [1, 2, 2])
    await store.close()
    restored = await UnreadChats.open(path)
    assert.deepEqual(restored.snapshot(), [latest, second])
    await restored.read(latest)
    assert.deepEqual(restored.snapshot(), [second])
  } finally { await store.close(); await restored?.close(); await rm(root, { recursive: true, force: true }) }
})

test('failed writes retain the previous unread state and closing joins accepted writes without publications', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-unread-write-')))
  const path = join(root, 'unread.json')
  const store = await UnreadChats.open(path)
  const item = { nativeSessionId: 'one', cwd: root, sessionFile: join(root, 'one.jsonl'), entryId: 'reply-1' }
  let published = false
  store.subscribe(() => { published = true })
  try {
    await writeFile(item.sessionFile, 'native history')
    await mkdir(path)
    await assert.rejects(store.mark(item))
    assert.deepEqual(store.snapshot(), [])
    await rm(path, { recursive: true })
    const marking = store.mark(item)
    await store.close()
    await marking
    assert.equal(published, false)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, items: [item] })
    await assert.rejects(store.mark(item), /closed/)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})
