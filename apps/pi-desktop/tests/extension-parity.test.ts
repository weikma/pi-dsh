/** The same published packages and native configuration must behave alike in CLI and Desktop RPC. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { PiProcess } from '../bridge/process.ts'
import { PiBridge } from '../bridge/manager.ts'
import { isJsonObject, type PiRuntime } from '../bridge/types.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'

test('native duplicate-tool failures and configured coexistence match CLI and Desktop RPC', { timeout: 90_000 }, async context => {
  const packages = process.env.PI_DESKTOP_TEST_EXTENSION_ROOT
  const search = process.env.PI_DESKTOP_TEST_SEARCH_EXTENSION
  if (!packages || !search) { context.skip('Set the published extension directory and pi-web-search package path'); return }
  const bundled = await availableBundledRuntime(resolve('apps/pi-desktop'), process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the selected Pi runtime'); return }
  const cli = process.env.PI_DESKTOP_TEST_PI_CLI
  const base: PiRuntime = cli ? { command: process.execPath, args: [cli] } : bundledPi(bundled)
  assert.equal(JSON.parse(await readFile(join(search, 'package.json'), 'utf8')).version, '1.5.0')
  const access = join(packages, 'pi-web-access')
  assert.equal(JSON.parse(await readFile(join(access, 'package.json'), 'utf8')).version, '0.35.0')
  const root = await mkdtemp(join(tmpdir(), 'pi-extension-parity-')), agentDir = join(root, 'agent')
  context.after(async () => { await rm(root, { recursive: true, force: true }) })
  await mkdir(agentDir)
  const requestedTools: string[][] = []
  const searchDescriptions: string[] = []
  let providerError: unknown
  const provider = createServer((request, response) => { void (async () => {
    let input = ''; for await (const part of request) input += String(part)
    const body: unknown = JSON.parse(input)
    assert.ok(isJsonObject(body) && Array.isArray(body.tools))
    requestedTools.push(body.tools.filter(isJsonObject).flatMap(tool => isJsonObject(tool.function) && typeof tool.function.name === 'string' ? [tool.function.name] : []))
    searchDescriptions.push(body.tools.filter(isJsonObject).flatMap(tool => isJsonObject(tool.function) && tool.function.name === 'web_search' && typeof tool.function.description === 'string' ? [tool.function.description] : []).join(''))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'PAIR_CONVERSATION_OK' }, null], [{}, 'stop']]) {
      response.write('data: ' + JSON.stringify({ id: 'parity', object: 'chat.completion.chunk', created: 1, model: 'scripted', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
    }
    response.end('data: [DONE]\n\n')
  })().catch(error => { providerError = error; response.destroy(error) }) })
  await new Promise<void>((done, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', done) })
  context.after(async () => { provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())) })
  const address = provider.address(); assert.ok(address && typeof address !== 'string')
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'scripted', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'scripted', packages: [search, access], compaction: { enabled: false } }))
  const runtime = { ...base, args: [...base.args, '--no-skills', '--no-prompt-templates', '--no-themes', '--no-session'], agentDir, cwd: root }
  const runCli = async () => {
    const child = spawn(runtime.command, [...runtime.args, '--print', 'Check the configured extension pair.'], { cwd: root, env: { ...process.env, ...runtime.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', part => { stdout += String(part) }); child.stderr.on('data', part => { stderr += String(part) })
    child.stdin.end()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 30_000)
    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
        child.once('error', reject); child.once('close', (code, signal) => { done({ code, signal }) })
      })
      assert.equal(timedOut, false); assert.equal(result.signal, null)
      return { ...result, stdout, stderr }
    } finally { clearTimeout(timeout) }
  }
  const failure = await runCli()
  assert.equal(failure.code, 1); assert.match(failure.stderr, /Tool "web_search" conflicts with/)
  const failedRpc = new PiProcess(runtime)
  try { await assert.rejects(failedRpc.start(), /Tool "web_search" conflicts with/) } finally { await failedRpc.dispose() }
  assert.equal(requestedTools.length, 0)
  // This is the package's documented native option, with no Desktop-specific rewrite or filtering.
  await writeFile(join(agentDir, 'web-search.json'), JSON.stringify({ toolNames: { webSearch: 'web_access_search' }, toolActivation: 'eager' }))
  const success = await runCli()
  assert.equal(success.code, 0, success.stderr); assert.match(success.stdout, /PAIR_CONVERSATION_OK/)
  const rpc = new PiProcess(runtime)
  try {
    await rpc.start()
    let settle!: () => void, fail!: (error: Error) => void
    const done = new Promise<void>((complete, reject) => { settle = complete; fail = reject })
    const unsubscribe = rpc.subscribe(event => {
      if (event.type === 'agent_settled') settle()
      if (event.type === 'bridge_error') fail(new Error(String(event.error)))
    })
    try {
      await rpc.request({ type: 'prompt', message: 'Check the configured extension pair.' }); await done
      assert.match(JSON.stringify(await rpc.request({ type: 'get_messages' })), /PAIR_CONVERSATION_OK/)
    } finally { unsubscribe() }
  } finally { await rpc.dispose() }
  assert.equal(providerError, undefined); assert.equal(requestedTools.length, 2)
  for (const names of requestedTools) for (const expected of ['web_search', 'web_access_search', 'fetch_content']) assert.ok(names.includes(expected), expected)
  await rm(join(agentDir, 'web-search.json'))
  const settings = { defaultProvider: 'fixture', defaultModel: 'scripted', packages: [search], compaction: { enabled: false } }
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify(settings))
  const bridge = new PiBridge(runtime)
  try {
    const session = await bridge.createSession(root)
    const id = session.snapshot().state.sessionId
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ ...settings, packages: [search, access] }))
    await session.reloadResources()
    assert.equal(session.snapshot().state.sessionId, id)
    let complete!: () => void
    const done = new Promise<void>(resolve => { complete = resolve })
    const unsubscribe = session.subscribe(value => { if (!value.state.isStreaming && JSON.stringify(value.messages).includes('PAIR_CONVERSATION_OK')) complete() })
    try { await session.command({ type: 'prompt', message: 'Check both conflicting packages after native reload.' }); await done } finally { unsubscribe() }
    assert.equal(requestedTools.length, 3)
    assert.ok(requestedTools[2]?.includes('web_search')); assert.ok(requestedTools[2]?.includes('fetch_content'))
    assert.match(searchDescriptions[2] ?? '', /current supported provider/)
    assert.equal(providerError, undefined)
  } finally { await bridge.dispose() }
})
