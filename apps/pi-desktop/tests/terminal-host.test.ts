/** The terminal HTTP carrier obeys project/origin validation and joins shutdown with open streams. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { mkdir, copyFile } from 'node:fs/promises'
import { startHost } from '../server.ts'
import { isJsonObject } from '../bridge/types.ts'
import { createPiFixture } from './pi-fixture.ts'

test('Host validates terminal requests and closes an attached PTY on shutdown', { timeout: 20_000 }, async () => {
  const fixture = await createPiFixture()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  const stream = new AbortController()
  try {
    await mkdir(join(dirname(fixture.cwd), 'runtime'))
    await copyFile(fixture.runtimeConfig, join(dirname(fixture.cwd), 'runtime', 'selected.json'))
    host = await startHost({ port: 0, home: join(dirname(fixture.cwd), 'gui'), appRoot: dirname(fixture.cwd), terminalShell: process.platform === 'win32' ? { file: process.env.COMSPEC || 'cmd.exe', args: [] } : { file: '/bin/sh', args: ['-i'] } })
    const post = (path: string, body: object, origin?: string) => fetch(host!.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
    assert.equal((await post('/api/terminals', { cwd: fixture.cwd })).status, 400)
    assert.equal((await post('/api/projects', { cwd: fixture.cwd })).status, 200)
    assert.equal((await post('/api/terminals', { cwd: fixture.cwd }, 'https://untrusted.example')).status, 403)
    assert.equal((await post('/api/terminals', { cwd: fixture.cwd, path: '..' })).status, 400)
    const opened: unknown = await (await post('/api/terminals', { cwd: fixture.cwd })).json()
    assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    assert.equal(host.hasActiveTasks(), true)
    const base = '/api/terminals/' + opened.id
    assert.equal((await post(base + '/resize', { cols: 0, rows: 20 })).status, 400)
    assert.equal((await post(base + '/write', { data: 'x'.repeat(65537) })).status, 400)
    assert.equal((await post(base + '/resize', { cols: 90, rows: 30 })).status, 200)
    const response = await fetch(host.url + base + '/events', { signal: stream.signal })
    assert.match(response.headers.get('content-type') ?? '', /event-stream/)
    const reader = response.body!.getReader()
    const first = await reader.read()
    assert.match(new TextDecoder().decode(first.value), /"type":"screen"/)
    await host.close(); host = undefined
    while (!(await reader.read()).done) { /* Drain the final exit frame to verify the SSE response ends. */ }
  } finally { stream.abort(); await host?.close(); await fixture.dispose() }
})
