/** Actual Pi owns reload precedence and recovery sessions; all provider requests and files are disposable. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PiBridge, type PiSessionHandle } from '../bridge/manager.ts'
import { PiExtensionStartupError } from '../bridge/process.ts'
import { isJsonObject, type JsonObject } from '../bridge/types.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'
import { startHost } from '../server.ts'

async function prompt(session: PiSessionHandle, message: string) {
  let complete!: () => void
  const settled = new Promise<void>(done => { complete = done })
  const stop = session.subscribe(snapshot => {
    if (!snapshot.state.isStreaming && snapshot.messages.at(-1)?.role === 'assistant' && JSON.stringify(snapshot.messages.at(-1)).includes('DONE ' + message)) complete()
  })
  try { await session.command({ type: 'prompt', message }); await settled } finally { stop() }
}

test('native reload keeps first tool registration and unique tools; explicit recovery preserves history and restores normal loading', { timeout: 90_000 }, async context => {
  const bundled = await availableBundledRuntime(resolve('apps/pi-desktop'), process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the selected Pi runtime'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-resource-recovery-')), agentDir = join(root, 'agent')
  const cleanup: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })]
  context.after(async () => {
    const errors: unknown[] = []
    for (const dispose of cleanup.reverse()) { try { await dispose() } catch (error) { errors.push(error) } }
    if (errors.length) throw new AggregateError(errors, 'Recovery fixture cleanup failed')
  })
  await mkdir(agentDir)
  const first = join(root, 'first.ts'), second = join(root, 'second.ts'), gate = join(root, 'reload-gate')
  const tool = (name: string, result: string) => `pi.registerTool({name:${JSON.stringify(name)},label:${JSON.stringify(name)},description:'Recovery fixture',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:${JSON.stringify(result)}}]}}});`
  await writeFile(first, `import {existsSync} from 'node:fs'; export default function(pi){` + tool('collision', 'FIRST') + `pi.on('session_start',async(event,ctx)=>{if(event.reason==='reload'&&existsSync(${JSON.stringify(gate)}))await ctx.ui.confirm('Reload fixture','Finish reload?')})}`)
  await writeFile(second, 'export default function(pi){' + tool('collision', 'SECOND') + tool('second_only', 'UNIQUE_SECOND') + '}')
  let providerError: unknown
  const requestTools = new Map<string, string[]>()
  const provider = createServer((request, response) => { void (async () => {
    let input = ''; for await (const part of request) input += String(part)
    const body: unknown = JSON.parse(input); assert.ok(isJsonObject(body) && Array.isArray(body.messages) && Array.isArray(body.tools))
    const messages = body.messages.filter(isJsonObject)
    const user = messages.findLast(value => value.role === 'user')
    const text = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content)
    const message = ['before', 'reload-first', 'reload-second', 'recovery', 'restored'].find(value => text.includes(value)); assert.ok(message)
    requestTools.set(message, body.tools.filter(isJsonObject).flatMap(value => isJsonObject(value.function) && typeof value.function.name === 'string' ? [value.function.name] : []))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const delta = (value: JsonObject, reason: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'recovery', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta: value, finish_reason: reason }] }) + '\n\n')
    const requested = message.startsWith('reload-') ? [{ name: 'collision', arguments: {} }, { name: 'second_only', arguments: {} }]
      : message === 'recovery' ? [{ name: 'write', arguments: { path: 'recovery.txt', content: 'Core tools still work.' } }] : []
    delta({ role: 'assistant' })
    if (requested.length && messages.at(-1)?.role !== 'tool') {
      delta({ tool_calls: requested.map((call, index) => ({ index, id: `${message}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }); delta({}, 'tool_calls')
    } else { delta({ content: 'DONE ' + message }); delta({}, 'stop') }
    response.end('data: [DONE]\n\n')
  })().catch(error => { providerError = error; response.destroy(error) }) })
  await new Promise<void>((done, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', done) })
  cleanup.push(async () => { provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())) })
  const address = provider.address(); assert.ok(address && typeof address !== 'string')
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'scripted', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
  const settings = (extensions: string[]) => writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'scripted', extensions, compaction: { enabled: false } }))
  await settings([first])
  const bridge = new PiBridge({ ...bundledPi(bundled), agentDir })
  cleanup.push(() => bridge.dispose())
  const session = await bridge.createSession(root)
  await session.command({ type: 'set_session_name', name: 'Resource recovery fixture' })
  await prompt(session, 'before')
  const nativeId = session.snapshot().state.sessionId, path = session.sessionFile
  assert.ok(path)
  await settings([first, second])
  await writeFile(gate, '')
  let dialogReady!: () => void, reloadError: unknown
  const dialog = new Promise<void>(done => { dialogReady = done })
  const observe = session.subscribe(value => { if (value.pendingUI.length) dialogReady() })
  const reloading = session.reloadResources().catch(error => { reloadError = error })
  await dialog; observe()
  assert.equal(session.snapshot().resourcesReloading, true)
  await assert.rejects(session.command({ type: 'prompt', message: 'must not run' }), /resource reload/)
  await assert.rejects(session.reloadResources(), /Finish the current task/)
  await assert.rejects(bridge.reconnect(session.id), /resource reload/)
  await session.command({ type: 'extension_ui_response', id: session.snapshot().pendingUI[0]!.id, confirmed: true })
  await reloading; await rm(gate)
  assert.equal(reloadError, undefined)
  assert.equal(session.snapshot().resourcesReloading, false)
  assert.equal(session.isClosed, false); assert.equal(session.snapshot().state.sessionId, nativeId)
  assert.equal(session.sessionFile, path); assert.match(JSON.stringify(session.snapshot().messages), /DONE before/)
  await prompt(session, 'reload-first')
  const firstResult = session.snapshot().messages.filter(value => value.role === 'toolResult')
  assert.match(JSON.stringify(firstResult.find(value => value.toolName === 'collision')), /FIRST/)
  assert.match(JSON.stringify(firstResult.find(value => value.toolName === 'second_only')), /UNIQUE_SECOND/)
  await settings([second, first])
  await session.reloadResources(); await prompt(session, 'reload-second')
  assert.match(JSON.stringify(session.snapshot().messages.filter(value => value.role === 'toolResult' && value.toolName === 'collision').at(-1)), /SECOND/)
  await session.dispose()
  const beforeRecovery = await readFile(join(agentDir, 'settings.json'), 'utf8')
  await assert.rejects(bridge.createSession(root, path), PiExtensionStartupError)
  const recovered = await bridge.createSession(root, path, true)
  assert.equal(recovered.snapshot().extensionRecovery, true)
  assert.equal(recovered.snapshot().state.sessionId, nativeId)
  await prompt(recovered, 'recovery')
  assert.equal(await readFile(join(root, 'recovery.txt'), 'utf8'), 'Core tools still work.')
  assert.ok(!requestTools.get('recovery')?.includes('collision'))
  const stillRecovered = await bridge.reconnect(recovered.id, false)
  assert.equal(stillRecovered.snapshot().extensionRecovery, true)
  assert.match(stillRecovered.snapshot().error ?? '', /conflicts with/)
  assert.match(JSON.stringify(stillRecovered.snapshot().messages), /DONE recovery/)
  assert.equal(await readFile(join(agentDir, 'settings.json'), 'utf8'), beforeRecovery)
  await settings([first])
  const restored = await bridge.reconnect(stillRecovered.id, false)
  assert.equal(restored.snapshot().extensionRecovery, undefined)
  assert.equal(restored.snapshot().state.sessionId, nativeId)
  await prompt(restored, 'restored')
  assert.ok(requestTools.get('restored')?.includes('collision'))
  assert.match(JSON.stringify(restored.snapshot().messages), /DONE before/)
  assert.equal(providerError, undefined)
  const appRoot = join(root, 'app')
  await mkdir(join(appRoot, 'runtime'), { recursive: true })
  await writeFile(join(appRoot, 'runtime', 'selected.json'), JSON.stringify({ ...bundledPi(bundled), agentDir }))
  const host = await startHost({ port: 0, appRoot, home: join(root, 'gui') })
  try {
    const post = (path: string, input: unknown) => fetch(host.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    await settings([first, second])
    const rejected = await post('/api/sessions', { cwd: root })
    assert.equal(rejected.status, 400)
    const failure: unknown = await rejected.json()
    assert.ok(isJsonObject(failure)); assert.equal(failure.code, 'extension_startup')
    const response = await post('/api/sessions', { cwd: root, extensionRecovery: true })
    const opened: unknown = await response.json(); assert.ok(isJsonObject(opened) && typeof opened.id === 'string')
    assert.equal(response.status, 200)
    assert.equal((await post('/api/sessions/' + opened.id + '/reload', {})).status, 200)
    const snapshot: unknown = await (await fetch(host.url + '/api/sessions/' + opened.id + '/snapshot')).json()
    assert.ok(isJsonObject(snapshot)); assert.equal(snapshot.extensionRecovery, true)
    assert.equal((await post('/api/sessions', { cwd: root, extensionRecovery: 'yes' })).status, 400)
  } finally { await host.close() }
})
