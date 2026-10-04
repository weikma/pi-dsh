import assert from 'node:assert/strict'
import { watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { fileActionRequest } from '../file-actions.ts'
import { LocalApplications, applicationLaunch, localDesktopAvailable, runApplicationLauncher, systemFileLaunch, type ApplicationLaunch, type ResolvedApplication } from '../local-applications.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('application requests select catalog IDs and keep paths out of shell code', () => {
  const path = join(tmpdir(), 'report $(not-a-command); [draft].txt')
  const application: ResolvedApplication = { id: 'vscode', name: 'VS Code', kind: 'editor', executable: join(tmpdir(), 'Code App.app') }
  assert.deepEqual(applicationLaunch('darwin', application, path), { command: '/usr/bin/open', args: ['-a', application.executable, '--', path], wait: true })
  assert.deepEqual(applicationLaunch('linux', application, path).args, [path])
  const windows = systemFileLaunch('win32', { SystemRoot: 'C:\\Windows' }, path, false, false)
  assert.equal(windows.target, path)
  const script = Buffer.from(windows.args.at(-1) ?? '', 'base64').toString('utf16le')
  assert.equal(script.includes(path), false)
  assert.match(script, /env:PI_DSH_OPEN_TARGET/)
  assert.throws(() => fileActionRequest({ cwd: tmpdir(), path, action: 'application', applicationId: '/arbitrary/executable' }), /available application/)
  assert.throws(() => fileActionRequest({ cwd: tmpdir(), path, action: 'execute', command: '/bin/sh' }), /Unsupported/)
  assert.equal(localDesktopAvailable('darwin', { SSH_CONNECTION: 'forwarded' }), false)
  assert.equal(localDesktopAvailable('linux', {}), false)
  assert.equal(localDesktopAvailable('linux', { WAYLAND_DISPLAY: 'wayland-0' }), true)
})

test('shared application opening preserves the selected editor and exposes no executable paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-local-applications-'))
  const launches: ApplicationLaunch[] = []
  const application: ResolvedApplication = { id: 'textedit', name: 'TextEdit', kind: 'editor', executable: join(root, 'Text Edit.app') }
  const preferences = join(root, 'editor.json')
  const owner = new LocalApplications(preferences, { platform: 'darwin', env: {}, discover: async () => [application], launch: async value => { launches.push(value) } })
  try {
    await mkdir(application.executable)
    const view = await owner.list()
    assert.deepEqual(view.applications, [{ id: 'textedit', name: 'TextEdit', kind: 'editor' }])
    assert.equal(JSON.stringify(view).includes(application.executable), false)
    const path = join(root, 'Project report.txt')
    assert.deepEqual(await owner.open({ cwd: root, path, action: 'application', applicationId: 'textedit' }, { path, directory: false }), { status: 'opened' })
    assert.equal((await owner.list()).editorName, 'TextEdit')
    await owner.open({ cwd: root, path, action: 'editor' }, { path, directory: false })
    assert.equal(launches.length, 2)
    assert.deepEqual(launches[1]?.args, ['-a', application.executable, '--', path])
    assert.deepEqual(JSON.parse(await readFile(preferences, 'utf8')), { path: application.executable })
    await rm(application.executable, { recursive: true })
    await assert.rejects(owner.open({ cwd: root, path, action: 'application', applicationId: 'textedit' }, { path, directory: false }), /ENOENT/)
    assert.equal(launches.length, 2)
  } finally { await owner.close(); await rm(root, { recursive: true, force: true }) }
})

test('Host close cancels a pending native chooser without applying a late selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-application-choice-'))
  const chosen = deferred<string | null>()
  const started = deferred<void>()
  const preferences = join(root, 'editor.json')
  const owner = new LocalApplications(preferences, { platform: 'darwin', env: {}, discover: async () => [],
    native: { chooseEditor: () => { started.resolve(); return chosen.promise }, open: async () => {}, reveal: async () => {} } })
  try {
    const application = join(root, 'Chosen.app')
    await mkdir(application)
    const pending = owner.open({ cwd: root, path: root, action: 'chooseEditor' }, { path: root, directory: true })
    const rejected = assert.rejects(pending, /stopped/)
    await started.promise
    await owner.close()
    await rejected
    chosen.resolve(application)
    await chosen.promise
    await assert.rejects(stat(preferences), /ENOENT/)
    await assert.rejects(owner.list(), /stopped/)
  } finally { chosen.resolve(null); await owner.close(); await rm(root, { recursive: true, force: true }) }
})

test('cancelling an owned launcher joins its process and releases its listener', { timeout: 30_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-application-launcher-'))
  const ready = join(root, 'ready.json')
  const started = deferred<void>()
  const watcher = watch(root, (_event, name) => { if (name === 'ready.json') started.resolve() })
  watcher.once('error', started.reject)
  const controller = new AbortController()
  const stop = () => { controller.abort() }
  context.signal.addEventListener('abort', stop, { once: true })
  const script = "const fs=require('node:fs'),net=require('node:net');process.on('SIGTERM',()=>{});const server=net.createServer();server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(process.argv[1]+'.tmp',JSON.stringify(server.address()));fs.renameSync(process.argv[1]+'.tmp',process.argv[1]);});"
  const pending = runApplicationLauncher({ command: process.execPath, args: ['-e', script, ready], wait: true }, process.env, controller.signal)
  const settled = pending.then(() => ({ ok: true }), error => ({ ok: false, error }))
  try {
    await Promise.race([started.promise, pending.then(() => { throw new Error('Launcher exited before readiness') })])
    const address: unknown = JSON.parse(await readFile(ready, 'utf8'))
    assert.ok(typeof address === 'object' && address !== null && 'port' in address && typeof address.port === 'number')
    controller.abort()
    assert.equal((await settled).ok, false)
    await assert.rejects(fetch('http://127.0.0.1:' + address.port))
  } finally {
    controller.abort()
    await settled
    watcher.close()
    context.signal.removeEventListener('abort', stop)
    await rm(root, { recursive: true, force: true })
  }
})
