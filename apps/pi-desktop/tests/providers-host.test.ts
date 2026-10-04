/** Provider HTTP/SSE uses the selected real public SDK and test-owned native configuration. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startHost } from '../server.ts'
import { isJsonObject, type JsonObject } from '../bridge/types.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function events(url: string) {
  const controller = new AbortController()
  const deadline = setTimeout(() => { controller.abort(new Error('Provider event deadline expired')) }, 20_000)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
    assert.equal(response.status, 200); assert.ok(response.body)
  } catch (error) { clearTimeout(deadline); controller.abort(); throw error }
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const seen: JsonObject[] = []
  let buffer = ''
  let disposal: Promise<void> | undefined
  async function next(): Promise<JsonObject | undefined> {
    for (;;) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary !== -1) {
        const record = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
        if (!record.startsWith('data: ')) continue
        const payload: unknown = JSON.parse(record.slice(6))
        assert.ok(isJsonObject(payload) && isJsonObject(payload.attempt))
        seen.push(payload)
        return payload.attempt
      }
      const chunk = await reader.read()
      if (chunk.done) return undefined
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
  return { seen,
    async until(status: string) {
      for (;;) {
        const attempt = await next()
        assert.ok(attempt, 'Provider stream ended before expected state')
        if (attempt.status === status) return attempt
        assert.notEqual(attempt.status, 'error', typeof attempt.error === 'string' ? attempt.error : 'Provider login failed')
      }
    },
    async ended() { while (await next() !== undefined) { /* Retain every safe terminal record before EOF. */ } },
    dispose(): Promise<void> {
      disposal ??= (async () => {
        clearTimeout(deadline)
        try { await reader.cancel() } finally { reader.releaseLock(); controller.abort() }
      })()
      return disposal
    },
  }
}

async function childPids(directory: string): Promise<number[]> {
  const files = await readdir(directory)
  return Promise.all(files.map(async file => Number(await readFile(join(directory, file), 'utf8'))))
}
function assertExited(pids: number[]): void {
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), error => error instanceof Error && 'code' in error && error.code === 'ESRCH')
}

test('provider Host reads native configuration without projects, drives safe login and joins workers on runtime change and close', { timeout: 90_000 }, async context => {
  const bundled = await availableBundledRuntime(sourceRoot, process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the native official Pi runtime for provider HTTP/SSE integration'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-providers-host-'))
  const agentDir = join(root, 'agent'), nextAgent = join(root, 'next-agent'), workspace = join(root, 'configuration-context')
  const pidDirectory = join(root, 'worker-pids'), runtimeDirectory = join(root, 'runtime')
  const runtimePath = join(runtimeDirectory, 'selected.json')
  const previousSelection = process.env.PI_DESKTOP_RUNTIME_CONFIG
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  const streams: Awaited<ReturnType<typeof events>>[] = []
  try {
    await Promise.all([mkdir(agentDir), mkdir(nextAgent), mkdir(workspace), mkdir(pidDirectory), mkdir(runtimeDirectory)])
    const worker = join(root, 'provider-worker.mjs')
    await build({ entryPoints: [join(sourceRoot, 'runtime', 'provider-worker.ts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22',
      banner: { js: `import {writeFileSync as recordTestWorkerPid} from 'node:fs'; recordTestWorkerPid(${JSON.stringify(pidDirectory)}+'/'+process.pid+'.pid', String(process.pid), {flag:'wx',mode:0o600});` } })
    const nativeConfig = { metadata: { preserve: true }, providers: { existing: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'static-private-configuration-key', unknownOption: 'preserve', models: [{ id: 'original', name: 'Existing native model', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }
    await writeFile(join(agentDir, 'models.json'), JSON.stringify(nativeConfig))
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'existing', defaultModel: 'original' }))
    const selected = bundledPi(bundled)
    const scrubbed = Object.fromEntries(Object.keys(process.env).filter(key => /key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key)).map(key => [key, '']))
    const startupSecret = 'private-startup-api-key'
    const runtime = { ...selected, args: [...selected.args, '--provider', 'existing', '--model', 'original', '--api-key', startupSecret], agentDir,
      env: { ...selected.env, ...scrubbed, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') } }
    await writeFile(runtimePath, JSON.stringify(runtime))
    process.env.PI_DESKTOP_RUNTIME_CONFIG = runtimePath
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), providerWorker: worker })
    const url = host.url, query = '?' + new URLSearchParams({ cwd: workspace })
    const post = (path: string, body: unknown, origin?: string) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
    async function json(response: Response): Promise<JsonObject> {
      const value: unknown = await response.json(); assert.ok(isJsonObject(value))
      assert.equal(response.status, 200, typeof value.error === 'string' ? value.error : 'Provider request failed')
      return value
    }
    const inventory = await json(await fetch(url + '/api/providers' + query))
    assert.equal(inventory.agentDir, agentDir)
    assert.equal(inventory.sdkVersion, bundled.pi.version)
    assert.ok(Array.isArray(inventory.models) && inventory.models.some(model => isJsonObject(model) && model.provider === 'existing' && model.id === 'original'))
    assert.ok(isJsonObject(inventory.defaultModel) && inventory.defaultModel.id === 'original')
    assert.equal(JSON.stringify(inventory).includes('static-private-configuration-key'), false)
    assert.equal(JSON.stringify(inventory).includes(startupSecret), false)
    assert.ok(Array.isArray(inventory.limitations) && inventory.limitations.some(value => typeof value === 'string' && value.includes('--api-key')))
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), { projects: [] })
    assert.notEqual((await fetch(url + '/api/agent-configuration' + query)).status, 200)
    assert.notEqual((await post('/api/agent-configuration', {action:'trust',scope:'project',trusted:true})).status, 200)
    const settingsView = await json(await fetch(url + '/api/agent-configuration'))
    assert.ok(isJsonObject(settingsView.preferences))
    assert.equal(settingsView.preferences.defaultModel, 'original')
    const created = await json(await post('/api/agent-configuration', {action:'create',kind:'prompts',scope:'user',name:'worker-review',description:'Review from GUI',content:'Review $ARGUMENTS.'}))
    assert.ok(Array.isArray(created.resources))
    const resource = created.resources.find(item => isJsonObject(item) && item.name === 'worker-review')
    assert.ok(isJsonObject(resource) && typeof resource.id === 'string')
    const document = await json(await post('/api/agent-configuration', {action:'read',resourceId:resource.id}))
    assert.equal(document.id, resource.id)
    assert.ok(typeof document.content === 'string' && document.content.includes('Review $ARGUMENTS.'))
    await json(await post('/api/agent-configuration', {action:'write',resourceId:resource.id,revision:document.revision,content:'Review carefully.'}))
    assert.equal(await readFile(join(agentDir,'prompts','worker-review.md'),'utf8'),'Review carefully.')
    assert.notEqual((await post('/api/agent-configuration',{action:'write',resourceId:resource.id,revision:document.revision,content:'stale'})).status, 200)
    assert.equal(JSON.stringify(settingsView).includes(startupSecret), false)
    const emptyAuth: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(emptyAuth) && Object.keys(emptyAuth).length === 0)
    assert.equal((await fetch(url + '/api/providers' + query, { headers: { origin: 'https://unrelated.example' } })).status, 403)
    assert.equal((await post('/api/providers/login', { providerId: 'deepseek', authType: 'api_key', cwd: workspace }, 'https://unrelated.example')).status, 403)
    const publicRuntime = await json(await fetch(url + '/api/runtime'))
    assert.equal(JSON.stringify(publicRuntime).includes(startupSecret), false)
    const editedRuntime = await json(await post('/api/runtime', { command: publicRuntime.command, args: publicRuntime.args, agentDir }))
    assert.equal(JSON.stringify(editedRuntime).includes(startupSecret), false)
    const preservedRuntime: unknown = JSON.parse(await readFile(runtimePath, 'utf8'))
    assert.ok(isJsonObject(preservedRuntime) && Array.isArray(preservedRuntime.args) && preservedRuntime.args.includes(startupSecret))
    const invalidReply = await fetch(url + '/api/providers/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"apiKey":"private-invalid-body-fragment", incomplete' })
    assert.equal(invalidReply.status, 400)
    assert.equal((await invalidReply.text()).includes('private-invalid-body-fragment'), false)

    async function login(providerId: string) {
      const attempt = await json(await post('/api/providers/login', { providerId, authType: 'api_key', cwd: workspace }))
      assert.equal(typeof attempt.id, 'string')
      const stream = await events(url + `/api/providers/auth/${attempt.id}/events`); streams.push(stream)
      const waiting = await stream.until('waiting')
      assert.ok(isJsonObject(waiting.prompt) && waiting.prompt.type === 'secret' && typeof waiting.prompt.id === 'string')
      assert.equal(host?.hasActiveTasks(), true)
      return { id: String(attempt.id), promptId: waiting.prompt.id, stream }
    }
    const first = await login('deepseek'), secret = 'private-http-provider-key'
    assert.equal((await post(`/api/providers/auth/${first.id}/reply`, { promptId: first.promptId, value: secret }, 'https://unrelated.example')).status, 403)
    await json(await post(`/api/providers/auth/${first.id}/reply`, { promptId: first.promptId, value: secret }))
    await first.stream.until('complete')
    assert.equal(host.hasActiveTasks(), false)
    const stored: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(stored) && isJsonObject(stored.deepseek) && stored.deepseek.key === secret)
    const state = await json(await fetch(url + `/api/providers/auth/${first.id}`))
    assert.equal(state.status, 'complete')
    assert.equal(JSON.stringify([state, first.stream.seen]).includes(secret), false)
    const configured = await json(await fetch(url + '/api/providers' + query))
    assert.equal(JSON.stringify(configured).includes(secret), false)
    assert.ok(Array.isArray(configured.providers) && configured.providers.some(provider => isJsonObject(provider) && provider.id === 'deepseek' && isJsonObject(provider.authStatus) && provider.authStatus.configured === true))
    await first.stream.dispose()

    await json(await post('/api/providers/custom', { cwd: workspace, providerId: 'custom-local', name: 'Local compatible', baseUrl: 'http://127.0.0.1:1/custom', api: 'openai-completions', models: [{ id: 'custom-model', name: 'Custom model' }] }))
    const changed: unknown = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'))
    assert.ok(isJsonObject(changed) && isJsonObject(changed.providers))
    assert.deepEqual(changed.metadata, nativeConfig.metadata)
    assert.deepEqual(changed.providers.existing, nativeConfig.providers.existing)
    const custom = await login('custom-local'), customSecret = 'private-custom-http-key'
    await json(await post(`/api/providers/auth/${custom.id}/reply`, { promptId: custom.promptId, value: customSecret }))
    await custom.stream.until('complete')
    assert.equal(JSON.stringify(custom.stream.seen).includes(customSecret), false)
    await custom.stream.dispose()
    const customAuth: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(customAuth) && isJsonObject(customAuth['custom-local']) && customAuth['custom-local'].key === customSecret)
    await json(await post('/api/providers/logout', { providerId: 'custom-local', cwd: workspace }))

    const cancelled = await login('deepseek')
    await json(await post(`/api/providers/auth/${cancelled.id}/cancel`, {}))
    await cancelled.stream.until('cancelled')
    assert.equal(host.hasActiveTasks(), false)
    await cancelled.stream.dispose()
    const switching = await login('deepseek'), oldPids = await childPids(pidDirectory)
    const switchedEnd = switching.stream.ended()
    await json(await post('/api/runtime', { command: selected.command, args: selected.args, agentDir: nextAgent }))
    await switchedEnd
    assertExited(oldPids)
    assert.equal((await fetch(url + `/api/providers/auth/${switching.id}`)).status, 404)
    assert.equal((await post(`/api/providers/auth/${switching.id}/reply`, { promptId: switching.promptId, value: 'stale-input' })).status, 404)
    const fresh = await json(await fetch(url + '/api/providers' + query))
    assert.equal(fresh.agentDir, nextAgent)
    assert.ok(Array.isArray(fresh.models) && !fresh.models.some(model => isJsonObject(model) && model.provider === 'existing'))
    const last = await login('deepseek'), allPids = await childPids(pidDirectory)
    assert.ok(allPids.length > oldPids.length)
    const lastEnd = last.stream.ended()
    await host.close(); host = undefined
    await lastEnd
    assertExited(allPids)
    await assert.rejects(fetch(url + '/api/providers' + query))
    const invalidAgent = join(root, 'invalid-agent')
    await mkdir(invalidAgent)
    const invalidSecret = 'private-invalid-native-auth-fragment'
    await writeFile(join(invalidAgent, 'auth.json'), '{"deepseek":{"type":"api_key","key":"' + invalidSecret + '"}, malformed')
    await writeFile(runtimePath, JSON.stringify({ ...runtime, args: selected.args, agentDir: invalidAgent }))
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), providerWorker: worker })
    const invalidConfiguration = await fetch(host.url + '/api/providers' + query)
    assert.equal(invalidConfiguration.status, 400)
    assert.equal((await invalidConfiguration.text()).includes(invalidSecret), false)
    await host.close(); host = undefined
    assertExited(await childPids(pidDirectory))
  } finally {
    const outcomes = await Promise.allSettled(streams.map(stream => stream.dispose()))
    const closed = await Promise.allSettled([host?.close()])
    if (previousSelection === undefined) delete process.env.PI_DESKTOP_RUNTIME_CONFIG
    else process.env.PI_DESKTOP_RUNTIME_CONFIG = previousSelection
    await rm(root, { recursive: true, force: true })
    assert.ok([...outcomes, ...closed].every(outcome => outcome.status === 'fulfilled'), 'Provider fixture cleanup failed')
  }
})
