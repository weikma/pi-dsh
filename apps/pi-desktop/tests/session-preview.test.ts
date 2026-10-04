/** Read-only history must not wait for extension startup or change native branch records. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile, rm, access, realpath, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PiBridge } from '../bridge/manager.ts'
import { createPiFixture } from './pi-fixture.ts'
import { loadRuntime } from '../runtime/config.ts'
import { readSessionPreview } from '../bridge/session-records.ts'

async function waitForFile(path: string) {
  const deadline = Date.now() + 20_000
  for (;;) {
    try { await access(path); return }
    catch (error) { if (Date.now() > deadline) throw error; await new Promise(done => setTimeout(done, 20)) }
  }
}

test('real Pi history is readable while cold extension startup is blocked, then agrees with RPC', { timeout: 90_000 }, async () => {
  const fixture = await createPiFixture()
  let bridge: PiBridge | undefined
  const previous = process.env.PI_DESKTOP_RUNTIME_CONFIG
  process.env.PI_DESKTOP_RUNTIME_CONFIG = fixture.runtimeConfig
  try {
    const runtime = await loadRuntime()
    bridge = new PiBridge(runtime)
    const first = await bridge.createSession(fixture.cwd)
    await first.command({ type: 'set_session_name', name: 'Native preview fixture' })
    await first.command({ type: 'prompt', message: 'Create a report with the official tools.' })
    while (first.snapshot().state.isStreaming) await new Promise(done => setTimeout(done, 20))
    const path = first.sessionFile!
    const settled = first.snapshot()
    const before = await readFile(path, 'utf8')
    await bridge.dispose()
    const root = dirname(fixture.agentDir), waiting = join(root, 'waiting'), release = join(root, 'release'), extension = join(root, 'barrier.ts')
    await writeFile(extension, `import { access, writeFile } from 'node:fs/promises'; export default async function() { await writeFile(${JSON.stringify(waiting)}, 'ready'); while(true) { try { await access(${JSON.stringify(release)}); return; } catch(error) { await new Promise(done => setTimeout(done,20)); } } }`)
    bridge = new PiBridge({ ...runtime, args: [...runtime.args, '-e', extension] })
    const sessions = await bridge.listSessions([fixture.cwd])
    assert.equal(sessions.length, 1)
    const listed = sessions[0]!
    let started = false
    const opening = bridge.createSession(fixture.cwd, listed.path).then(session => { started = true; return session })
    try {
      await waitForFile(waiting)
      const preview = await bridge.previewSession(fixture.cwd, listed.path)
      assert.equal(started, false)
      assert.deepEqual(preview?.messages, settled.messages)
      assert.deepEqual(preview?.entries, settled.entries)
      assert.equal(await readFile(path, 'utf8'), before)
      await writeFile(release, 'ready')
      const live = await opening
      assert.deepEqual(preview?.messages, live.snapshot().messages)
      assert.equal(fixture.requests.length, 3)
      await assert.rejects(bridge.previewSession(fixture.cwd, join(fixture.agentDir, 'auth.json')), /not in this project's history/)
    } finally { await writeFile(release, 'ready'); await opening }
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_RUNTIME_CONFIG; else process.env.PI_DESKTOP_RUNTIME_CONFIG = previous
    await bridge?.dispose(); await fixture.dispose()
  }
})

test('v3 preview keeps the persisted branch, summaries and custom messages, rejects future formats and never writes', async () => {
  const fixture = await createPiFixture()
  try {
    const cwd = await realpath(fixture.cwd), directory = join(fixture.agentDir, 'sessions')
    await mkdir(directory)
    const path = join(directory, 'history.jsonl')
    const records = [
      { type: 'session', version: 3, id: 'native', cwd },
      { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: 'Question' } },
      { type: 'message', id: 'old', parentId: 'u', message: { role: 'assistant', content: 'Inactive branch' } },
      { type: 'message', id: 'a', parentId: 'u', message: { role: 'assistant', content: 'Active answer' } },
      { type: 'compaction', id: 'c', parentId: 'a', summary: 'Compacted' },
      { type: 'branch_summary', id: 'b', parentId: 'c', summary: 'Branched' },
      { type: 'custom_message', id: 'x', parentId: 'b', customType: 'note', content: 'Visible custom', display: true },
      { type: 'custom_message', id: 'h', parentId: 'x', content: 'Hidden custom', display: false },
    ]
    const source = records.map(value => JSON.stringify(value)).join('\n') + '\n{"partial":'
    await writeFile(path, source)
    const preview = await readSessionPreview(path, cwd)
    assert.deepEqual(preview?.messages.map(message => message.entryId), ['u', 'a', 'c', 'b', 'x'])
    assert.equal(preview?.leafId, 'h')
    assert.equal(await readFile(path, 'utf8'), source)
    await writeFile(path, source.replace('"version":3', '"version":4'))
    assert.equal(await readSessionPreview(path, cwd), null)
    await writeFile(path, source.replace('"parentId":"b"', '"parentId":"missing"'))
    assert.equal(await readSessionPreview(path, cwd), null)
    await writeFile(path, source)
    const bridge = new PiBridge({ command: process.execPath, args: [], agentDir: fixture.agentDir })
    try {
      const listed = await bridge.listSessions([cwd])
      if (process.platform !== 'win32') {
        await rm(path); await symlink(join(fixture.agentDir, 'settings.json'), path)
        await assert.rejects(bridge.previewSession(cwd, listed[0]!.path), /symbolic link/)
      }
    } finally { await bridge.dispose() }
  } finally { await fixture.dispose() }
})
