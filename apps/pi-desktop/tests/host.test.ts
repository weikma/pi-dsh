/** Exercise the shared Host over HTTP with an independently running official Pi. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request } from 'node:http'
import { mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { startHost } from '../server.ts'
import { isJsonObject } from '../bridge/types.ts'
import { createPiFixture } from './pi-fixture.ts'

test('Host isolates origins and previews, preserves runtime metadata and closes its Pi sessions', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const root = dirname(fixture.cwd)
    const selected: unknown = JSON.parse(await readFile(fixture.runtimeConfig, 'utf8'))
    assert.ok(isJsonObject(selected))
    await mkdir(join(root, 'runtime'))
    const selectedPath = join(root, 'runtime', 'selected.json')
    await writeFile(selectedPath, JSON.stringify({ ...selected, upgradeNote: 'preserve this operator-owned metadata' }))
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui') })
    const url = host.url
    const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await fetch(url + '/api/projects', { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await fetch(url + '/api/package-catalog?kind=skill', { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await fetch(url + '/api/package-catalog?kind=unknown')).status, 400)
    assert.equal((await fetch(url + '/api/package-catalog/detail?name=https://unrelated.example')).status, 400)
    const wrongHost = await new Promise<number | undefined>((complete, reject) => {
      const call = request(url + '/api/projects', { headers: { host: 'unrelated.example' } }, response => { response.resume(); response.once('end', () => complete(response.statusCode)) })
      call.once('error', reject); call.end()
    })
    assert.equal(wrongHost, 403)
    assert.equal((await post('/api/projects', { cwd: fixture.cwd })).status, 200)
    await mkdir(join(fixture.cwd, 'folder'))
    await writeFile(join(fixture.cwd, 'before-chat.txt'), 'Browse without starting Pi')
    const projectFiles: unknown = await (await fetch(url + '/api/files?' + new URLSearchParams({ cwd: fixture.cwd }))).json()
    assert.ok(isJsonObject(projectFiles) && projectFiles.kind === 'directory' && Array.isArray(projectFiles.entries))
    assert.ok(isJsonObject(projectFiles.entries[0]) && projectFiles.entries[0].kind === 'directory')
    const target: unknown = await (await post('/api/file-target', { cwd: fixture.cwd, path: 'before-chat.txt' })).json()
    assert.ok(isJsonObject(target) && target.path === await realpath(join(fixture.cwd, 'before-chat.txt')))
    assert.equal((await post('/api/file-target', { cwd: root, path: 'runtime.json' })).status, 400)
    assert.equal((await post('/api/file-target', { cwd: fixture.cwd, path: '../runtime.json' })).status, 400)
    const download = await fetch(url + '/api/file-download?' + new URLSearchParams({ cwd: fixture.cwd, path: 'before-chat.txt' }))
    assert.equal(await download.text(), 'Browse without starting Pi')
    assert.match(download.headers.get('content-disposition') ?? '', /attachment/)
    const setup: unknown = await (await fetch(url + '/api/pi-setup?' + new URLSearchParams({ cwd: fixture.cwd }))).json()
    assert.ok(isJsonObject(setup) && typeof setup.commandLine === 'string')
    assert.equal(setup.cwd, fixture.cwd)
    assert.ok(!setup.commandLine.includes('fixture-only'))
    assert.equal((await post('/api/preferences', { locale: 'en', appearance: 'light', cwd: fixture.cwd, sessionId: 'native-pi-selection', sessionFile: '/native-pi-session.jsonl' })).status, 200)
    const widths = { sidebarWidth: 364, workspaceWidth: 520 }
    const lastModel = { provider: 'test', id: 'reasoner', name: 'Reasoner', thinkingLevel: 'high' }
    assert.equal((await post('/api/preferences', { lastModel: { ...lastModel, apiKey: 'must-not-persist' } })).status, 200)
    for (const invalid of [null, {}, { ...lastModel, id: '' }, { ...lastModel, thinkingLevel: 2 }]) {
      assert.equal((await post('/api/preferences', { lastModel: invalid })).status, 400)
    }
    assert.equal((await post('/api/preferences', widths)).status, 200)
    for (const invalid of [{ sidebarWidth: 263 }, { workspaceWidth: 239 }, { sidebarWidth: 300.5 }, { workspaceWidth: '420' }, { sidebarWidth: 10001 }]) {
      assert.equal((await post('/api/preferences', invalid)).status, 400)
    }
    const typography = { uiFontSize: 18, codeFontSize: 16, lightCodeTheme: 'github-light', darkCodeTheme: 'nord', codeLineNumbers: false, codeWrapLines: true }
    assert.equal((await post('/api/preferences', { appearance: 'dark', ...typography })).status, 200)
    for (const invalid of [{ uiFontSize: 21 }, { uiFontSize: 13.5 }, { codeFontSize: 9 }, { codeFontSize: '14' }, { lightCodeTheme: 'nord' }, { darkCodeTheme: 'unknown' }, { codeLineNumbers: 1 }, { codeWrapLines: 'false' }]) {
      assert.equal((await post('/api/preferences', invalid)).status, 400)
    }
    assert.equal((await post('/api/preferences', { locale: 'unsupported' })).status, 400)
    const opened: unknown = await (await post('/api/sessions', { cwd: fixture.cwd })).json()
    assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    const id = opened.id
    assert.equal(host.hasActiveTasks(), false)
    const refreshed: unknown = await (await post(`/api/sessions/${id}/reconnect`, {})).json()
    assert.ok(isJsonObject(refreshed) && typeof refreshed.id === 'string')
    assert.equal((await fetch(url + `/api/sessions/${id}/snapshot`)).status, 404)
    const refreshedId = refreshed.id
    const preview = (path: string) => fetch(url + '/api/files?' + new URLSearchParams({ sessionId: refreshedId, path }))
    await writeFile(join(fixture.cwd, 'large.txt'), 'x'.repeat(600 * 1024))
    const file: unknown = await (await preview('large.txt')).json()
    assert.ok(isJsonObject(file) && typeof file.content === 'string')
    assert.equal(file.content.length, 512 * 1024)
    assert.equal(file.truncated, true)
    await writeFile(join(fixture.cwd, 'binary.bin'), Buffer.from([0, 1, 2]))
    const binary: unknown = await (await preview('binary.bin')).json()
    assert.ok(isJsonObject(binary) && binary.kind === 'binary' && binary.content === undefined)
    assert.equal((await preview(fixture.runtimeConfig)).status, 400)
    const outside = await realpath(fixture.agentDir)
    await symlink(outside, join(fixture.cwd, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal((await preview('outside/models.json')).status, 400)
    assert.equal((await post('/api/file-target', { cwd: fixture.cwd, path: 'outside/models.json' })).status, 400)
    const runtimeResponse: unknown = await (await fetch(url + '/api/runtime')).json()
    assert.ok(isJsonObject(runtimeResponse) && runtimeResponse.env === undefined)
    assert.equal((await post('/api/runtime', { command: selected.command, args: selected.args, agentDir: fixture.agentDir })).status, 200)
    const preserved: unknown = JSON.parse(await readFile(selectedPath, 'utf8'))
    assert.ok(isJsonObject(preserved))
    assert.equal(preserved.upgradeNote, 'preserve this operator-owned metadata')
    assert.deepEqual(preserved.env, selected.env)
    assert.equal(preserved.version, selected.version)
    assert.equal((await fetch(url + `/api/sessions/${id}/snapshot`)).status, 404)
    await host.close()
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui') })
    assert.deepEqual(await (await fetch(host.url + '/api/preferences')).json(), { locale: 'en', appearance: 'dark', ...typography, ...widths, lastModel, cwd: fixture.cwd, sessionId: 'native-pi-selection', sessionFile: '/native-pi-session.jsonl' })
    const restartedUrl = host.url
    const savePreferences = () => fetch(restartedUrl + '/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appearance: 'light' }) })
    const preferencesPath = join(root, 'gui', 'preferences.json')
    await rm(preferencesPath)
    await mkdir(preferencesPath)
    assert.equal((await savePreferences()).status, 400)
    await rm(preferencesPath, { recursive: true })
    assert.equal((await savePreferences()).status, 200)
    await rm(preferencesPath)
    await mkdir(preferencesPath)
    assert.equal((await savePreferences()).status, 400)
    await host.close()
    host = undefined
    await assert.rejects(fetch(restartedUrl + '/api/projects'))
  } finally {
    await host?.close()
    await fixture.dispose()
  }
})

test('project aliases, removal and chat organization persist only in GUI preferences and failed writes retain navigation', { timeout: 30_000 }, async () => {
  const fixture = await createPiFixture()
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const root = dirname(fixture.cwd)
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime', 'selected.json'), await readFile(fixture.runtimeConfig))
    const home = join(root, 'gui')
    host = await startHost({ port: 0, appRoot: root, home })
    const url = host.url
    const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await post('/api/projects', { cwd: fixture.cwd })
    const first = await post('/api/projects', { cwd: fixture.cwd, action: 'rename', name: 'Workspace alias' })
    assert.deepEqual(await first.json(), { projects: [{ cwd: fixture.cwd, name: 'Workspace alias' }] })
    const session = join(fixture.agentDir, 'sessions', 'unchanged.jsonl')
    await mkdir(dirname(session), { recursive: true })
    await writeFile(session, 'Native conversation remains untouched\n')
    const original = await readFile(session, 'utf8')
    assert.equal((await post('/api/preferences', { collapsedProjects: [fixture.cwd], pinnedSessions: [session], archivedSessions: [session] })).status, 200)
    assert.equal((await post('/api/preferences', { pinnedSessions: [12] })).status, 400)
    const preferencesFile = join(home, 'preferences.json')
    const saved = await readFile(preferencesFile)
    await rm(preferencesFile); await mkdir(preferencesFile)
    assert.equal((await post('/api/projects', { cwd: fixture.cwd, action: 'remove' })).status, 400)
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), { projects: [{ cwd: fixture.cwd, name: 'Workspace alias' }] })
    await rm(preferencesFile, { recursive: true }); await writeFile(preferencesFile, saved)
    await host.close()
    host = await startHost({ port: 0, appRoot: root, home })
    assert.deepEqual(await (await fetch(host.url + '/api/preferences')).json(), { collapsedProjects: [fixture.cwd], pinnedSessions: [session], archivedSessions: [session] })
    const removed = await fetch(host.url + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: fixture.cwd, action: 'remove' }) })
    assert.deepEqual(await removed.json(), { projects: [] })
    assert.equal(await readFile(session, 'utf8'), original)
    assert.equal((await stat(fixture.cwd)).isDirectory(), true)
  } finally {
    await host?.close()
    await fixture.dispose()
  }
})
