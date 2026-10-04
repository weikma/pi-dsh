import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { startHost } from '../server.ts'
import { isJsonObject } from '../bridge/types.ts'
import { isUnreadChat } from '../unread-types.ts'
import { createPiFixture } from './pi-fixture.ts'

test('Host observes real Pi completions without a chat subscriber and preserves read state across restart', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  const root = dirname(fixture.cwd)
  const home = join(root, 'gui')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const controller = new AbortController()
  try {
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime', 'selected.json'), await readFile(fixture.runtimeConfig))
    host = await startHost({ port: 0, appRoot: root, home })
    const url = host.url
    const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await post('/api/projects', { cwd: fixture.cwd })
    assert.equal((await fetch(url + '/api/unread', { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await post('/api/unread', { entryId: 1 })).status, 400)
    const source = await fetch(url + '/api/unread/events', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
    assert.ok(source.body)
    reader = source.body.getReader()
    let buffer = ''
    const decoder = new TextDecoder()
    const nextFrame = async (): Promise<unknown> => {
      while (!buffer.includes('\n\n')) {
        const next = await reader!.read()
        if (next.done) throw new Error('Unread stream ended before the expected frame')
        buffer += decoder.decode(next.value, { stream: true })
      }
      const end = buffer.indexOf('\n\n')
      const data = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      return JSON.parse(data.slice('data: '.length))
    }
    assert.deepEqual(await nextFrame(), { type: 'unread', items: [] })
    const opened: unknown = await (await post('/api/sessions', { cwd: fixture.cwd })).json()
    assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    await post(`/api/sessions/${opened.id}/command`, { type: 'prompt', message: 'Create a report and verify it.' })
    const frame = await nextFrame()
    assert.ok(isJsonObject(frame) && Array.isArray(frame.items) && isUnreadChat(frame.items[0]))
    assert.equal(frame.items.length, 1)
    const item = frame.items[0]
    const transcript = await readFile(item.sessionFile, 'utf8')
    const records = transcript.trim().split('\n').map(line => JSON.parse(line)).filter(isJsonObject)
    assert.ok(records.some(record => record.id === item.entryId && isJsonObject(record.message) && record.message.role === 'assistant' && record.message.stopReason === 'stop'))
    const stale = await post('/api/unread', { nativeSessionId: item.nativeSessionId, entryId: 'older-reply' })
    assert.deepEqual(await stale.json(), { items: [item] })
    await post('/api/preferences', { archivedSessions: [item.sessionFile] })
    assert.deepEqual(await nextFrame(), { type: 'unread', items: [] })
    await post('/api/preferences', { archivedSessions: [] })
    assert.deepEqual(await nextFrame(), { type: 'unread', items: [item] })
    await reader.cancel(); reader = undefined
    await host.close()
    host = await startHost({ port: 0, appRoot: root, home })
    assert.deepEqual(await (await fetch(host.url + '/api/unread')).json(), { items: [item] })
    const acknowledged = await fetch(host.url + '/api/unread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nativeSessionId: item.nativeSessionId, entryId: item.entryId }) })
    assert.deepEqual(await acknowledged.json(), { items: [] })
    assert.equal(await readFile(item.sessionFile, 'utf8'), transcript)
  } finally {
    if (reader) await reader.cancel()
    controller.abort()
    await host?.close()
    await fixture.dispose()
  }
})
