/** The official Pi calls the public resource extension and executes its returned interpreters. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { PiBridge, type PiSessionHandle } from '../bridge/manager.ts'
import { isJsonObject, type JsonObject, type PiSnapshot } from '../bridge/types.ts'
import { bundledPi, nativeRuntimeTarget, readBundledRuntime } from '../runtime/bundled.ts'

function waitComplete(session: PiSessionHandle, signal: AbortSignal): Promise<PiSnapshot> {
  return new Promise((complete, reject) => {
    const clear = () => { clearTimeout(deadline); unsubscribe(); signal.removeEventListener('abort', aborted) }
    const aborted = () => { clear(); reject(new Error('Auxiliary flow wait stopped')) }
    const deadline = setTimeout(() => { clear(); reject(new Error('Pi auxiliary flow did not complete')) }, 60_000)
    const unsubscribe = session.subscribe(snapshot => {
      if (snapshot.error) { clear(); reject(new Error(snapshot.error)); return }
      if (snapshot.state.isStreaming || !snapshot.messages.some(message => message.role === 'assistant' && Array.isArray(message.content)
        && message.content.some(block => block.type === 'text' && block.text === 'Bundled resource flow verified.'))) return
      clear()
      complete(snapshot)
    })
    signal.addEventListener('abort', aborted, { once: true })
  })
}

test('real Pi records bundled resource paths and creates an Office file using those paths', { timeout: 90_000 }, async context => {
  const selectedPayload = process.env.PI_DSH_TEST_RUNTIME
  const payload = resolve(selectedPayload ?? fileURLToPath(new URL(`../.pi-dsh-build/runtime/${nativeRuntimeTarget()}`, import.meta.url)))
  let source: string
  try { source = await readFile(join(payload, 'manifest.json'), 'utf8') }
  catch (error) {
    if (!selectedPayload && isJsonObject(error) && error.code === 'ENOENT') {
      context.skip(`No native payload at ${payload}; run pnpm runtime:prepare or set PI_DSH_TEST_RUNTIME`)
      return
    }
    throw error
  }
  const manifest: unknown = JSON.parse(source)
  if (!isJsonObject(manifest) || !isJsonObject(manifest.node) || typeof manifest.node.executable !== 'string' || typeof manifest.node.version !== 'string'
    || !isJsonObject(manifest.pi) || typeof manifest.pi.cli !== 'string'
    || !isJsonObject(manifest.pnpm) || typeof manifest.pnpm.version !== 'string'
    || !isJsonObject(manifest.auxiliary) || typeof manifest.auxiliary.extension !== 'string') throw new Error('Prepared runtime has no auxiliary extension')
  const nodeVersion = manifest.node.version
  const pnpmVersion = manifest.pnpm.version
  const root = await mkdtemp(join(tmpdir(), 'pi-auxiliary-real-flow-'))
  const agentDir = join(root, 'agent')
  const cwd = join(root, 'workspace')
  await Promise.all([mkdir(agentDir), mkdir(cwd)])
  const requests: JsonObject[] = []
  let returnedPaths: JsonObject | undefined
  let providerError: Error | undefined
  const quote = (value: string) => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`
  const invoke = (executable: string, args: string[]) => `${process.platform === 'win32' ? '& ' : ''}${[executable, ...args].map(quote).join(' ')}`
  const server = createServer((request, response) => {
    void (async () => {
      let source = ''
      for await (const chunk of request) source += String(chunk)
      const body: unknown = JSON.parse(source)
      if (!isJsonObject(body)) throw new Error('Expected fixture provider request')
      requests.push(body)
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const delta = (data: JsonObject, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `auxiliary-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'auxiliary', choices: [{ index: 0, delta: data, finish_reason: finish }] })}\n\n`)
      const call = (name: string, args: JsonObject) => delta({ tool_calls: [{ index: 0, id: `auxiliary-tool-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
      const finish = (reason: string) => { delta({}, reason); response.end('data: [DONE]\n\n') }
      delta({ role: 'assistant' })
      if (requests.length === 1) {
        assert.ok(JSON.stringify(body.tools).includes('load_workspace_dependencies'))
        call('load_workspace_dependencies', {})
        finish('tool_calls')
      } else if (requests.length === 2) {
        const messages = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : []
        const result = messages.find(message => message.role === 'tool' && message.tool_call_id === 'auxiliary-tool-1')
        assert.ok(result && typeof result.content === 'string')
        const parsed: unknown = JSON.parse(result.content)
        assert.ok(isJsonObject(parsed) && typeof parsed.node === 'string' && typeof parsed.python === 'string' && typeof parsed.pnpm === 'string')
        returnedPaths = parsed
        const script = `import json; from openpyxl import Workbook,load_workbook; from pathlib import Path; w=Workbook(); w.active.append(['Pi auxiliary runtime',42]); w.save('auxiliary-proof.xlsx'); assert load_workbook('auxiliary-proof.xlsx').active['B1'].value==42; Path('auxiliary-proof.json').write_text(json.dumps({'cell':42,'tool':'load_workspace_dependencies'})); print('Office round trip verified')`
        const command = [invoke(parsed.node, ['-p', 'process.versions.node']), invoke(parsed.node, [parsed.pnpm, '--version']), invoke(parsed.python, ['-I', '-B', '-c', script])].join('; ')
        call(process.platform === 'win32' ? 'powershell' : 'bash', { command })
        finish('tool_calls')
      } else if (requests.length === 3) {
        const messages = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : []
        const result = messages.find(message => message.role === 'tool' && message.tool_call_id === 'auxiliary-tool-2')
        assert.ok(result && typeof result.content === 'string')
        const lines = result.content.split('\n').map(line => line.trim())
        assert.ok(lines.includes('Office round trip verified'))
        assert.ok(lines.includes(nodeVersion))
        assert.ok(lines.includes(pnpmVersion))
        call('read', { path: 'auxiliary-proof.json' })
        finish('tool_calls')
      } else {
        delta({ content: 'Bundled resource flow verified.' })
        finish('stop')
      }
    })().catch((error: unknown) => { providerError = error instanceof Error ? error : new Error(String(error)); response.destroy(providerError) })
  })
  let listening = false
  let bridge: PiBridge | undefined
  const stopping = new AbortController()
  let completed: Promise<PiSnapshot> | undefined
  try {
    await new Promise<void>((complete, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { listening = true; complete() }) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Auxiliary fixture did not bind a TCP port')
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'fixture-only', models: [{ id: 'auxiliary', name: 'Auxiliary fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'auxiliary', defaultThinkingLevel: 'off', compaction: { enabled: false }, ...(process.platform === 'win32' ? { defaultTools: ['read', 'write', 'edit', 'powershell'] } : {}) }))
    const selected = bundledPi(await readBundledRuntime(payload))
    bridge = new PiBridge({ ...selected, agentDir, args: [...selected.args, '--no-extensions', '--no-prompt-templates', '--no-themes'], env: { ...selected.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, 'sessions') } })
    const session = await bridge.createSession(cwd)
    await session.command({ type: 'set_session_name', name: 'Native flow fixture' })
    completed = waitComplete(session, stopping.signal)
    // Prompt admission can fail before the waiter is awaited; final cleanup joins its rejection.
    void completed.catch(() => undefined)
    await session.command({ type: 'prompt', message: 'Use bundled resources to create and check an Office file.' })
    const snapshot = await completed
    if (providerError) throw providerError
    assert.equal(requests.length, 4)
    assert.ok(returnedPaths && typeof returnedPaths.python === 'string' && returnedPaths.python.startsWith(payload))
    const expected: unknown = JSON.parse(await readFile(new URL('./fixtures/auxiliary-flow.expected.json', import.meta.url), 'utf8'))
    assert.ok(isJsonObject(expected) && isJsonObject(expected.shell) && Array.isArray(expected.toolNames))
    assert.deepEqual(JSON.parse(await readFile(join(cwd, 'auxiliary-proof.json'), 'utf8')), expected.file)
    assert.ok((await readFile(join(cwd, 'auxiliary-proof.xlsx'))).length > 100)
    assert.deepEqual(snapshot.messages.filter(message => message.role === 'toolResult').map(message => message.toolName), [expected.toolNames[0], expected.shell[process.platform === 'win32' ? 'win32' : 'posix'], expected.toolNames[1]])
    const assistant = snapshot.messages.filter(message => message.role === 'assistant').at(-1)?.content
    assert.equal(typeof assistant === 'string' ? assistant : assistant?.find(block => block.type === 'text')?.text, expected.assistant)
    assert.ok(session.snapshot().state.sessionFile)
    const nativeLog = await readFile(session.snapshot().state.sessionFile!, 'utf8')
    assert.ok(nativeLog.includes('load_workspace_dependencies'))
    if (process.env.PI_DSH_AUXILIARY_RECORD) await writeFile(process.env.PI_DSH_AUXILIARY_RECORD, nativeLog, { flag: 'wx', mode: 0o600 })
    const commands = await session.command({ type: 'get_commands' })
    assert.ok(JSON.stringify(commands).includes('office-xlsx'))
  } finally {
    stopping.abort()
    await completed?.catch(() => undefined)
    await bridge?.dispose()
    if (listening) { server.closeAllConnections(); await new Promise<void>((complete, reject) => server.close(error => error ? reject(error) : complete())) }
    await rm(root, { recursive: true, force: true })
  }
})
