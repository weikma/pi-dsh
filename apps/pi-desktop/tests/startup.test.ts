/** Desktop's first window must not wait for shell/environment or offline runtime preparation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { startHost } from '../server.ts'
import { isJsonObject } from '../bridge/types.ts'
import { createPiFixture } from './pi-fixture.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((complete, fail) => { resolve = complete; reject = fail })
  return { promise, resolve, reject }
}

test('Desktop serves the GUI and project files before preparation, then opens the actual selected Pi', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  const environment = deferred()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const root = dirname(fixture.cwd)
    await mkdir(join(root, 'dist/client'), { recursive: true })
    await writeFile(join(root, 'dist/client/index.html'), '<!doctype html><title>Startup fixture</title>')
    await writeFile(join(fixture.cwd, 'readable.txt'), 'Files are available before Pi starts')
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), environmentReady: environment.promise })
    assert.match(await (await fetch(host.url)).text(), /Startup fixture/)
    const post = (path: string, body: unknown) => fetch(host!.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post('/api/projects', { cwd: fixture.cwd })).status, 200)
    const preview: unknown = await (await fetch(host.url + '/api/files?' + new URLSearchParams({ cwd: fixture.cwd, path: 'readable.txt' }))).json()
    assert.ok(isJsonObject(preview) && preview.content === 'Files are available before Pi starts')
    assert.equal(host.hasActiveTasks(), false)
    // The selected launch configuration does not exist until the environment is ready.
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime/selected.json'), await readFile(fixture.runtimeConfig))
    environment.resolve()
    const opened: unknown = await (await post('/api/sessions', { cwd: fixture.cwd })).json()
    assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    const snapshot: unknown = await (await fetch(host.url + '/api/sessions/' + opened.id + '/snapshot')).json()
    assert.ok(isJsonObject(snapshot) && isJsonObject(snapshot.state) && typeof snapshot.state.sessionId === 'string')
    assert.equal(fixture.requests.length, 0)
  } finally {
    environment.resolve()
    await host?.close()
    await fixture.dispose()
  }
})

test('Desktop shutdown joins pending preparation and closes its Host without starting Pi', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  const environment = deferred()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const root = dirname(fixture.cwd)
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime/selected.json'), await readFile(fixture.runtimeConfig))
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), environmentReady: environment.promise })
    const url = host.url
    let exited = false
    const closed = host.close().then(() => { exited = true })
    assert.equal((await fetch(url + '/api/projects')).status, 503)
    assert.equal(exited, false)
    environment.resolve()
    await closed
    assert.equal(fixture.requests.length, 0)
    await assert.rejects(fetch(url + '/api/projects'))
    host = undefined
  } finally {
    environment.resolve()
    await host?.close()
    await fixture.dispose()
  }
})

test('a failed deferred preparation reports its error while the GUI still serves preferences', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  const environment = deferred()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const root = dirname(fixture.cwd)
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), environmentReady: environment.promise })
    environment.reject(new Error('Fixture environment failed'))
    const response = await fetch(host.url + '/api/runtime')
    assert.equal(response.status, 400)
    const error: unknown = await response.json()
    assert.ok(isJsonObject(error) && error.error === 'Fixture environment failed')
    assert.equal((await fetch(host.url + '/api/preferences')).status, 200)
  } finally {
    environment.resolve()
    await host?.close()
    await fixture.dispose()
  }
})
