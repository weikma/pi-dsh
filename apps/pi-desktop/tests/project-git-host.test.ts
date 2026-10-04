/** Git routes share project/origin isolation and prevent checkout while Pi is executing. */
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { startHost } from '../server.ts'
import { GitCommands } from '../git-command.ts'
import { isJsonObject } from '../bridge/types.ts'
import { createPiFixture } from './pi-fixture.ts'

test('Host confines Git to registered projects and preserves active Pi work', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture(), git = new GitCommands()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const events = new AbortController()
  try {
    const run = async (...args: string[]) => { const result = await git.run(fixture.cwd, args); assert.equal(result.code, 0, result.stderr) }
    await run('init', '-b', 'main'); await run('config', 'user.name', 'Pi fixture'); await run('config', 'user.email', 'fixture@example.invalid'); await run('config', 'commit.gpgsign', 'false')
    await writeFile(join(fixture.cwd, 'README.md'), 'Project'); await run('add', '.'); await run('commit', '-m', 'Initial project')
    const root = dirname(fixture.cwd); await mkdir(join(root, 'runtime')); await writeFile(join(root, 'runtime', 'selected.json'), await readFile(fixture.runtimeConfig))
    host = await startHost({ port: 0, home: join(root, 'gui'), appRoot: root })
    const post = (path: string, body: unknown) => fetch(host!.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const endpoint = '/api/project-git?' + new URLSearchParams({ cwd: fixture.cwd })
    assert.equal((await fetch(host.url + endpoint)).status, 400)
    await post('/api/projects', { cwd: fixture.cwd })
    const alias = join(root, 'project-alias'); await symlink(await realpath(fixture.cwd), alias, process.platform === 'win32' ? 'junction' : 'dir')
    const registered: unknown = await (await post('/api/projects', { cwd: alias })).json()
    assert.ok(isJsonObject(registered)); assert.equal(registered.cwd, fixture.cwd); assert.equal(Array.isArray(registered.projects) && registered.projects.length, 1)
    assert.equal((await fetch(host.url + endpoint, { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await post(endpoint, { action: 'force', branch: 'main', revision: '' })).status, 400)
    assert.equal((await fetch(host.url + '/api/project-git/graph?' + new URLSearchParams({ cwd: fixture.cwd, skip: '-1' }))).status, 400)
    const state: unknown = await (await fetch(host.url + endpoint)).json(); assert.ok(isJsonObject(state) && typeof state.revision === 'string')
    const opened: unknown = await (await post('/api/sessions', { cwd: fixture.cwd })).json(); assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    const id = opened.id
    const stream = await fetch(host.url + `/api/sessions/${id}/events`, { signal: AbortSignal.any([events.signal, AbortSignal.timeout(20_000)]) }); assert.ok(stream.body); reader = stream.body.getReader()
    let buffer = ''; const decoder = new TextDecoder()
    const until = async (predicate: (value: unknown) => boolean) => {
      for (;;) {
        while (!buffer.includes('\n\n')) { const item = await reader!.read(); if (item.done) throw new Error('Pi stream ended'); buffer += decoder.decode(item.value, { stream: true }) }
        const end = buffer.indexOf('\n\n'), frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        if (frame.startsWith('data: ') && predicate(JSON.parse(frame.slice(6)))) return
      }
    }
    const running = until(value => isJsonObject(value) && isJsonObject(value.snapshot) && isJsonObject(value.snapshot.state) && value.snapshot.state.isStreaming === true)
    await post(`/api/sessions/${id}/command`, { type: 'prompt', message: 'Create and check report.md.' }); await running
    await until(value => isJsonObject(value) && isJsonObject(value.snapshot) && isJsonObject(value.snapshot.state) && value.snapshot.state.isStreaming === false)
    await post(`/api/sessions/${id}/command`, { type: 'prompt', message: 'Wait for cancellation.' })
    await until(value => isJsonObject(value) && isJsonObject(value.snapshot) && isJsonObject(value.snapshot.state) && value.snapshot.state.isStreaming === true)
    const denied: unknown = await (await post(endpoint, { action: 'create', branch: 'codex/busy', revision: state.revision })).json()
    assert.deepEqual(denied, { ok: false, issue: 'busy' })
    await post(`/api/sessions/${id}/command`, { type: 'abort' })
    await until(value => isJsonObject(value) && isJsonObject(value.snapshot) && isJsonObject(value.snapshot.state) && value.snapshot.state.isStreaming === false)
    const changed: unknown = await (await post(endpoint, { action: 'create', branch: 'codex/ready', revision: state.revision })).json()
    assert.ok(isJsonObject(changed) && changed.ok === true)
  } finally { await reader?.cancel(); events.abort(); await host?.close(); await git.close(); await fixture.dispose() }
})
