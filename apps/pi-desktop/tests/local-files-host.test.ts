/** Local GUI routes operate without a model call and retain the Host's origin and project boundaries. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { startHost } from '../server.ts'
import { LocalApplications, type ApplicationLaunch } from '../local-applications.ts'
import { isJsonObject } from '../bridge/types.ts'

test('Web browses and creates directories, then opens only resolved project paths in known applications', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-local-files-host-'))
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  const calls: ApplicationLaunch[] = []
  const app = join(root, 'Editor.app'), project = join(root, 'project'), outside = join(root, 'outside')
  const actions = new LocalApplications(join(root, 'editor.json'), { platform: 'darwin', env: {},
    discover: async () => [{ id: 'textedit', name: 'TextEdit', kind: 'editor', executable: app }],
    launch: async value => { calls.push(value) } })
  try {
    for (const path of [app, project, outside, join(root, 'runtime')]) await mkdir(path)
    await writeFile(join(root, 'runtime/selected.json'), JSON.stringify({ command: process.execPath, args: ['--version'] }))
    await writeFile(join(project, 'report $(literal).txt'), 'report')
    await writeFile(join(outside, 'private.txt'), 'outside')
    await symlink(outside, join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    host = await startHost({ port: 0, home: join(root, 'gui'), appRoot: root, localApplications: actions })
    const post = (path: string, body: unknown, origin?: string) => fetch(host!.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
    const listing: unknown = await (await fetch(host.url + '/api/directories?' + new URLSearchParams({ path: root }))).json()
    assert.ok(isJsonObject(listing) && Array.isArray(listing.entries))
    assert.ok(listing.entries.some(entry => isJsonObject(entry) && entry.name === 'project'))
    assert.equal((await post('/api/directories', { path: root, name: 'Created project' })).status, 200)
    assert.equal((await post('/api/directories', { path: root, name: '../escaped' })).status, 400)
    assert.equal((await post('/api/directories', { path: root, name: 'Denied' }, 'https://unrelated.example')).status, 403)
    assert.equal((await fetch(host.url + '/api/directories', { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await fetch(host.url + '/api/applications', { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await post('/api/projects', { cwd: project })).status, 200)
    const action = { cwd: project, path: 'report $(literal).txt', action: 'application', applicationId: 'textedit' }
    assert.equal((await post('/api/file-actions', action, 'https://unrelated.example')).status, 403)
    assert.equal((await fetch(host.url + '/api/file-actions', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(action) })).status, 400)
    assert.equal((await post('/api/file-actions', { ...action, path: '../outside/private.txt' })).status, 400)
    assert.equal((await post('/api/file-actions', { ...action, path: 'escape/private.txt' })).status, 400)
    assert.equal((await post('/api/file-actions', { ...action, cwd: outside, path: 'private.txt' })).status, 400)
    assert.equal((await post('/api/file-actions', { ...action, applicationId: '/bin/sh', args: ['anything'] })).status, 400)
    assert.equal(calls.length, 0)
    assert.deepEqual(await (await post('/api/file-actions', action)).json(), { status: 'opened' })
    assert.equal(calls.length, 1)
    assert.equal(await readFile(calls[0]!.args.at(-1)!, 'utf8'), 'report')
    const apps: unknown = await (await fetch(host.url + '/api/applications')).json()
    assert.ok(isJsonObject(apps) && apps.editorName === 'TextEdit')
    assert.equal(JSON.stringify(apps).includes(app), false)
    assert.equal((await post('/api/file-actions', { cwd: project, path: '.', action: 'reveal' })).status, 200)
    const url = host.url
    await host.close(); host = undefined
    await assert.rejects(fetch(url + '/api/applications'))
    await assert.rejects(actions.list(), /stopped/)
  } finally { await host?.close(); await actions.close(); await rm(root, { recursive: true, force: true }) }
})
