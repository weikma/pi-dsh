/** The selected official Pi SDK owns private credentials; the worker exposes only login interaction. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PiProcess } from '../bridge/process.ts'
import { resolveProviderRuntime } from '../bridge/provider-runtime.ts'
import { isJsonObject, type PiEvent } from '../bridge/types.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceWorker = fileURLToPath(new URL('../runtime/provider-worker.ts', import.meta.url))
const tsx = createRequire(import.meta.url).resolve('tsx/esm')

test('the official SDK stores API keys privately, cancels pending login, preserves symlinked models and joins on EOF', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(sourceRoot, process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the native official Pi runtime to test its public authentication worker'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-provider-native-'))
  const physicalAgentDir = join(root, 'agent'), workspace = join(root, 'workspace'), configDirectory = join(root, 'configuration')
  const agentDir = process.platform === 'win32' ? join(root, 'agent-junction') : physicalAgentDir
  await mkdir(physicalAgentDir); await mkdir(workspace); await mkdir(configDirectory)
  if (process.platform === 'win32') await symlink(physicalAgentDir, agentDir, 'junction')
  const selected = await resolveProviderRuntime({ ...bundledPi(bundled), agentDir })
  const env = Object.fromEntries(Object.entries(selected.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => [key, /key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key) ? '' : value]))
  env.PI_CODING_AGENT_DIR = agentDir
  const worker = new PiProcess({ command: selected.command, args: ['--import', tsx, sourceWorker], cwd: workspace, env })
  const events: PiEvent[] = []
  worker.subscribe(event => events.push(event))
  const nextPrompt = (operationId: string): Promise<PiEvent> => {
    const existing = events.find(event => event.type === 'provider_auth' && event.operationId === operationId && event.event === 'prompt')
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error('Pi did not request its login input')) }, 20_000)
      const stop = worker.subscribe(event => {
        if (event.type === 'provider_auth' && event.operationId === operationId && event.event === 'prompt') { clearTimeout(timer); stop(); resolve(event) }
      })
    })
  }
  try {
    await worker.start()
    const inventory = await worker.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: selected.cliArgs, cwd: workspace, agentDir })
    assert.ok(isJsonObject(inventory) && inventory.sdkVersion === '0.99.1' && Array.isArray(inventory.providers))
    const deepseek = inventory.providers.find(value => isJsonObject(value) && value.id === 'deepseek')
    assert.ok(isJsonObject(deepseek) && Array.isArray(deepseek.authTypes) && deepseek.authTypes.includes('api_key'))
    assert.deepEqual(deepseek.authStatus, { configured: false })
    assert.ok(Array.isArray(deepseek.models) && deepseek.models.length > 0)
    assert.equal(deepseek.modelCount, deepseek.models.length)
    assert.ok(deepseek.models.every(item => isJsonObject(item) && item.provider === 'deepseek' && typeof item.name === 'string' && Object.keys(item).sort().join(',') === 'id,name,provider,thinkingLevel,thinkingLevels'))
    assert.ok(Array.isArray(inventory.models) && !inventory.models.some(item => isJsonObject(item) && item.provider === 'deepseek'))
    assert.equal(inventory.extensionProvidersSupported, false)
    const overridden = new PiProcess({ command: selected.command, args: ['--import', tsx, sourceWorker], cwd: workspace, env })
    try {
      await overridden.start()
      const privateOverride = 'private-runtime-argument-key'
      const selectedInventory = await overridden.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: ['--provider', 'deepseek', '--model', 'deepseek-chat', '--api-key', privateOverride], cwd: workspace, agentDir })
      assert.ok(isJsonObject(selectedInventory) && Array.isArray(selectedInventory.providers) && Array.isArray(selectedInventory.models))
      const runtimeProvider = selectedInventory.providers.find(item => isJsonObject(item) && item.id === 'deepseek')
      assert.ok(isJsonObject(runtimeProvider) && isJsonObject(runtimeProvider.authStatus) && runtimeProvider.authStatus.source === 'runtime')
      assert.ok(selectedInventory.models.some(item => isJsonObject(item) && item.provider === 'deepseek'))
      assert.ok(Array.isArray(selectedInventory.limitationCodes) && selectedInventory.limitationCodes.includes('api_key_override'))
      assert.ok(!JSON.stringify(selectedInventory).includes(privateOverride))
      const persisted: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
      assert.ok(isJsonObject(persisted) && persisted.deepseek === undefined)
    } finally { await overridden.dispose() }
    const secret = 'private-provider-worker-key\u2028second\u2029part'
    const loggingIn = worker.request({ type: 'login', operationId: 'login-private', providerId: 'deepseek', authType: 'api_key' })
    const promptEvent = await nextPrompt('login-private')
    assert.ok(isJsonObject(promptEvent.prompt) && promptEvent.prompt.type === 'secret' && typeof promptEvent.prompt.id === 'string')
    await worker.request({ type: 'reply', operationId: 'login-private', promptId: promptEvent.prompt.id, value: secret })
    await loggingIn
    const stored: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(stored) && isJsonObject(stored.deepseek) && stored.deepseek.key === secret)
    const afterLogin = await worker.request({ type: 'inventory' })
    assert.ok(!JSON.stringify(afterLogin).includes(secret) && !JSON.stringify(events).includes(secret))
    assert.ok(isJsonObject(afterLogin) && Array.isArray(afterLogin.models))
    const deepseekModels = afterLogin.models.filter(item => isJsonObject(item) && item.provider === 'deepseek')
    const preferred = deepseekModels.at(-1)
    assert.ok(isJsonObject(preferred) && typeof preferred.id === 'string')
    const settings = { defaultProvider: 'deepseek', defaultModel: preferred.id }
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify(settings))
    const missingModel = new PiProcess({ command: selected.command, args: ['--import', tsx, sourceWorker], cwd: workspace, env })
    try {
      await missingModel.start()
      await assert.rejects(missingModel.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: ['--provider', 'deepseek', '--api-key', 'private-unscoped-key'], cwd: workspace, agentDir }), /requires --model or a resolvable model scope/)
    } finally { await missingModel.dispose() }
    const scoped = new PiProcess({ command: selected.command, args: ['--import', tsx, sourceWorker], cwd: workspace, env })
    try {
      await scoped.start()
      const scopedInventory = await scoped.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: ['--models', 'deepseek/*', '--api-key', 'private-scoped-argument-key'], cwd: workspace, agentDir })
      assert.ok(isJsonObject(scopedInventory) && isJsonObject(scopedInventory.defaultModel) && Array.isArray(scopedInventory.providers))
      assert.equal(scopedInventory.defaultModel.id, preferred.id)
      assert.equal(scopedInventory.defaultModel.provider, 'deepseek')
      const selectedProvider = scopedInventory.providers.find(item => isJsonObject(item) && item.id === 'deepseek')
      assert.ok(isJsonObject(selectedProvider) && isJsonObject(selectedProvider.authStatus) && selectedProvider.authStatus.source === 'runtime')
      assert.ok(!JSON.stringify(scopedInventory).includes('private-scoped-argument-key'))
      const unchanged: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
      assert.ok(isJsonObject(unchanged) && isJsonObject(unchanged.deepseek) && unchanged.deepseek.key === secret)
    } finally { await scoped.dispose() }
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ ...settings, enabledModels: ['deepseek/*'] }))
    const enabled = new PiProcess({ command: selected.command, args: ['--import', tsx, sourceWorker], cwd: workspace, env })
    try {
      await enabled.start()
      const enabledInventory = await enabled.request({ type: 'init', sdkEntry: selected.sdkEntry, cliArgs: [], cwd: workspace, agentDir })
      assert.ok(isJsonObject(enabledInventory) && isJsonObject(enabledInventory.defaultModel))
      assert.equal(enabledInventory.defaultModel.id, preferred.id)
    } finally { await enabled.dispose() }
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify(settings))
    const loggingOut = await worker.request({ type: 'logout', providerId: 'deepseek' })
    assert.ok(!JSON.stringify(loggingOut).includes(secret))
    const afterLogout: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(afterLogout) && afterLogout.deepseek === undefined)
    const cancelling = worker.request({ type: 'login', operationId: 'cancel-private', providerId: 'deepseek', authType: 'api_key' })
    const cancelledLogin = assert.rejects(cancelling, /cancelled/)
    await nextPrompt('cancel-private')
    await worker.request({ type: 'cancel', operationId: 'cancel-private' })
    await cancelledLogin
    assert.ok(events.some(event => event.type === 'provider_auth' && event.operationId === 'cancel-private' && event.event === 'prompt_cancelled'))
    const target = process.platform === 'win32' ? join(physicalAgentDir, 'models.json') : join(configDirectory, 'models.json')
    await writeFile(target, JSON.stringify({ metadata: { preserve: true }, providers: { local: { baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions', unknownOption: 'preserve', models: [{ id: 'old', unknownModelOption: true }, { id: 'same', unknownModelOption: 'retained' }] } } }))
    const logical = join(agentDir, 'models.json')
    if (process.platform !== 'win32') await symlink(target, logical)
    const configured = await worker.request({ type: 'add_custom_provider', providerId: 'local', baseUrl: 'http://127.0.0.1:4321/v1', models: [{ id: 'same', name: 'Updated' }, { id: 'new' }] })
    assert.ok(isJsonObject(configured) && Array.isArray(configured.providers) && configured.providers.some(item => isJsonObject(item) && item.id === 'local'))
    const local = configured.providers.find(item => isJsonObject(item) && item.id === 'local')
    assert.ok(isJsonObject(local) && Array.isArray(local.models))
    assert.equal(local.modelCount, 3)
    assert.deepEqual(local.models.map(item => isJsonObject(item) ? item.id : undefined).sort(), ['new', 'old', 'same'])
    assert.equal((await lstat(process.platform === 'win32' ? agentDir : logical)).isSymbolicLink(), true)
    const preserved: unknown = JSON.parse(await readFile(target, 'utf8'))
    assert.ok(isJsonObject(preserved) && isJsonObject(preserved.metadata) && preserved.metadata.preserve === true && isJsonObject(preserved.providers) && isJsonObject(preserved.providers.local))
    assert.equal(preserved.providers.local.unknownOption, 'preserve')
    assert.ok(Array.isArray(preserved.providers.local.models) && preserved.providers.local.models.some(item => isJsonObject(item) && item.id === 'old' && item.unknownModelOption === true))
    assert.ok(preserved.providers.local.models.some(item => isJsonObject(item) && item.id === 'same' && item.unknownModelOption === 'retained'))
    const beforeInvalid = await readFile(target, 'utf8')
    await assert.rejects(worker.request({ type: 'add_custom_provider', providerId: 'constructor', baseUrl: 'http://localhost/v1', models: [{ id: 'bad' }] }), /reserved/)
    await assert.rejects(worker.request({ type: 'add_custom_provider', providerId: 'invalid', baseUrl: 'http://localhost/v1', models: [{ id: 'bad', maxTokens: -1 }] }), /positive/)
    assert.equal(await readFile(target, 'utf8'), beforeInvalid)
    assert.equal((await readdir(configDirectory)).filter(name => name.endsWith('.tmp')).length, 0)
    const invalidConfiguration = JSON.stringify({ providers: { local: { api: 'openai-completions', baseUrl: 'http://localhost/v1', headers: { Authorization: 123 }, models: [{ id: 'invalid' }] } } })
    await writeFile(target, invalidConfiguration)
    await assert.rejects(worker.request({ type: 'add_custom_provider', providerId: 'sdk-validation', baseUrl: 'http://localhost/v1', models: [{ id: 'checked' }] }), /Pi rejected this compatible provider/)
    assert.equal(await readFile(target, 'utf8'), invalidConfiguration)
    await writeFile(target, '{"apiKey":"private-json-fragment", invalid')
    const invalid = worker.request({ type: 'add_custom_provider', providerId: 'bad-json', baseUrl: 'http://localhost/v1', models: [{ id: 'bad' }] })
    await assert.rejects(invalid, error => error instanceof Error && error.message.includes('invalid JSON') && !error.message.includes('private-json-fragment'))
    await writeFile(target, beforeInvalid)
    const eofLogin = worker.request({ type: 'login', operationId: 'eof-private', providerId: 'deepseek', authType: 'api_key' })
    const eofRejected = assert.rejects(eofLogin)
    await nextPrompt('eof-private')
    await worker.dispose()
    await eofRejected
    await assert.rejects(worker.request({ type: 'get_state' }), /closed/)
  } finally { await worker.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a symbolic-link worker entry reaches readiness instead of exiting without running', { skip: process.platform === 'win32' ? 'This regression exercises POSIX file symlinks without requiring Windows file-link privileges' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-provider-entry-'))
  const entry = join(root, 'worker-entry.ts')
  await symlink(sourceWorker, entry)
  const worker = new PiProcess({ command: process.execPath, args: ['--import', tsx, entry], cwd: root })
  try { await worker.start(); assert.deepEqual(await worker.request({ type: 'get_state' }), { ready: true }) }
  finally { await worker.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('an unsupported SDK exposes no bundled fallback or parser fragment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-provider-unsupported-'))
  const entry = join(root, 'unsupported.mjs')
  await writeFile(entry, "export const VERSION='unavailable';\n")
  const worker = new PiProcess({ command: process.execPath, args: ['--import', tsx, sourceWorker], cwd: root })
  try {
    await worker.start()
    await assert.rejects(worker.request({ type: 'init', sdkEntry: pathToFileURL(entry).href, cliArgs: [], cwd: root }), /does not expose.*native Pi setup/)
    await assert.rejects(worker.request({ type: 'inventory' }), /Initialize the selected Pi/)
  } finally { await worker.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('official ModelRuntime OAuth callbacks cancel their manual prompt and EOF closes the owned callback server naturally', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(sourceRoot, process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the native official Pi runtime to test public SDK OAuth callbacks'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-provider-oauth-'))
  const agentDir = join(root, 'agent'), workspace = join(root, 'workspace')
  await mkdir(agentDir); await mkdir(workspace)
  const selected = await resolveProviderRuntime({ ...bundledPi(bundled), agentDir })
  const env: NodeJS.ProcessEnv = { ...selected.env, PI_PROVIDER_TEST_SDK_ENTRY: selected.sdkEntry, PI_CODING_AGENT_DIR: agentDir }
  for (const key of Object.keys(env)) if (/key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key)) env[key] = ''
  const child = spawn(selected.command, ['--import', tsx, sourceWorker, '--mode', 'rpc'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let sequence = 0, buffer = '', output = '', diagnostic = ''
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  const events: PiEvent[] = []
  const listeners = new Set<(event: PiEvent) => void>()
  const request = (input: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const id = 'oauth-test-' + ++sequence
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ ...input, id }) + '\n', error => { if (error) { pending.delete(id); reject(error) } })
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk; output += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const record: unknown = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      assert.ok(isJsonObject(record) && typeof record.type === 'string')
      if (record.type === 'response' && typeof record.id === 'string') {
        const completion = pending.get(record.id)
        pending.delete(record.id)
        if (record.success === true) completion?.resolve(record.data)
        else completion?.reject(new Error(typeof record.error === 'string' ? record.error : 'OAuth fixture request failed'))
      } else {
        const event: PiEvent = { ...record, type: record.type }
        events.push(event); for (const listener of listeners) listener(event)
      }
      newline = buffer.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { diagnostic += chunk })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      for (const completion of pending.values()) completion.reject(new Error('OAuth fixture worker exited'))
      pending.clear(); resolve({ code, signal })
    })
  })
  const event = (match: (event: PiEvent) => boolean): Promise<PiEvent> => {
    const existing = events.find(match)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('OAuth fixture did not reach the expected callback')) }, 20_000)
      const listener = (value: PiEvent): void => { if (match(value)) { clearTimeout(timer); listeners.delete(listener); resolve(value) } }
      listeners.add(listener)
    })
  }
  const prompt = (operationId: string, type: string) => event(value => value.type === 'provider_auth' && value.operationId === operationId && value.event === 'prompt' && isJsonObject(value.prompt) && value.prompt.type === type)
  const reply = async (operationId: string, type: string, value: string) => {
    const input = await prompt(operationId, type)
    assert.ok(isJsonObject(input.prompt) && typeof input.prompt.id === 'string')
    await request({ type: 'reply', operationId, promptId: input.prompt.id, value })
  }
  const callback = async (operationId: string): Promise<string> => {
    const value = await event(value => value.type === 'provider_auth' && value.operationId === operationId && value.event === 'notify' && isJsonObject(value.notification) && value.notification.type === 'auth_url')
    assert.ok(isJsonObject(value.notification) && typeof value.notification.url === 'string')
    return value.notification.url
  }
  try {
    assert.deepEqual(await request({ type: 'get_state' }), { ready: true })
    const entry = pathToFileURL(fileURLToPath(new URL('./provider-oauth-fixture.mjs', import.meta.url))).href
    await request({ type: 'init', sdkEntry: entry, cliArgs: [], cwd: workspace, agentDir })
    const loggingIn = request({ type: 'login', operationId: 'oauth-success', providerId: 'fixture-oauth', authType: 'oauth' })
    await reply('oauth-success', 'select', 'device')
    await reply('oauth-success', 'text', 'scripted-user')
    await prompt('oauth-success', 'manual_code')
    const authorization = await callback('oauth-success')
    assert.equal(await (await fetch(authorization)).text(), 'authorized')
    await loggingIn
    assert.ok(events.some(value => value.operationId === 'oauth-success' && value.event === 'prompt_cancelled'))
    assert.ok(events.some(value => value.operationId === 'oauth-success' && isJsonObject(value.notification) && value.notification.type === 'device_code'))
    assert.ok(!output.includes('private-scripted-access-token') && !output.includes('private-scripted-refresh-token'))
    const stored: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(stored) && isJsonObject(stored['fixture-oauth']) && stored['fixture-oauth'].type === 'oauth')
    await request({ type: 'logout', providerId: 'fixture-oauth' })
    const cancelling = request({ type: 'login', operationId: 'oauth-cancel', providerId: 'fixture-oauth', authType: 'oauth' })
    const cancellation = assert.rejects(cancelling, /cancelled/)
    await reply('oauth-cancel', 'select', 'browser'); await reply('oauth-cancel', 'text', 'scripted-user')
    await prompt('oauth-cancel', 'manual_code')
    const cancelledCallback = await callback('oauth-cancel')
    await request({ type: 'cancel', operationId: 'oauth-cancel' }); await cancellation
    await assert.rejects(fetch(cancelledCallback))
    const eof = request({ type: 'login', operationId: 'oauth-eof', providerId: 'fixture-oauth', authType: 'oauth' })
    const eofFailure = assert.rejects(eof, /cancelled/)
    await reply('oauth-eof', 'select', 'browser'); await reply('oauth-eof', 'text', 'scripted-user')
    await prompt('oauth-eof', 'manual_code')
    const eofCallback = await callback('oauth-eof')
    child.stdin.end()
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, 15_000)
    let stopped: Awaited<typeof exited>
    try { stopped = await exited } finally { clearTimeout(deadline) }
    await eofFailure
    assert.deepEqual(stopped, { code: 0, signal: null })
    assert.equal(child.killed, false)
    assert.equal(diagnostic, '')
    await assert.rejects(fetch(eofCallback))
    const removed: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(removed) && removed['fixture-oauth'] === undefined)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await rm(root, { recursive: true, force: true })
  }
})
