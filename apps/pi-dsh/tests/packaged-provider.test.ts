/** Validate the real shipped worker and public SDK; no source-built worker substitutes for Resources. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProviderGateway } from '../bridge/providers.ts'
import type { ProviderAuthAttempt } from '../bridge/provider-job.ts'
import { isJsonObject } from '../bridge/types.ts'
import { bundledPi, readBundledRuntime } from '../runtime/bundled.ts'

async function waiting(gateway: ProviderGateway, id: string): Promise<ProviderAuthAttempt> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('Shipped Pi worker did not publish its credential prompt')) }, 20_000)
    const observe = (attempt: ProviderAuthAttempt): void => {
      if (attempt.id !== id) return
      if (attempt.status === 'waiting' || attempt.status === 'error') {
        clearTimeout(timer); stop()
        if (attempt.status === 'error') reject(new Error(attempt.error ?? 'Shipped Pi authentication failed'))
        else resolve(attempt)
      }
    }
    const stop = gateway.subscribe(observe)
    const current = gateway.attempt(id)
    if (current) observe(current)
  })
}

test('shipped Resources worker reads native configuration and cancels or joins pending SDK login without a project', { timeout: 60_000 }, async context => {
  const worker = process.env.PI_DSH_TEST_PACKAGED_PROVIDER_WORKER
  if (!worker) { context.skip('Set the actual Resources/provider-worker.mjs and PI_DSH_TEST_RUNTIME to verify the shipped provider path'); return }
  const runtimeRoot = process.env.PI_DSH_TEST_RUNTIME
  assert.ok(runtimeRoot, 'A shipped-worker check requires its explicit Resources/runtime payload; no source default is allowed')
  assert.equal((await stat(worker)).isFile(), true)
  const runtime = await readBundledRuntime(runtimeRoot)
  const root = await mkdtemp(join(tmpdir(), 'pi-packaged-provider-'))
  const agentDir = join(root, 'agent'), cwd = join(root, 'configuration-context')
  let gateway: ProviderGateway | undefined
  try {
    await mkdir(agentDir); await mkdir(cwd)
    const staticKey = 'packaged-private-configuration-key'
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { existing: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: staticKey,
      models: [{ id: 'native-existing', name: 'Existing native configuration', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'existing', defaultModel: 'native-existing' }))
    const selected = bundledPi(runtime)
    const scrubbed = Object.fromEntries(Object.keys(process.env).filter(key => /key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key)).map(key => [key, '']))
    gateway = await ProviderGateway.create({ ...selected, agentDir, env: { ...selected.env, ...scrubbed, PI_CODING_AGENT_DIR: agentDir } }, worker, cwd, runtime.node.executable)
    const inventory = await gateway.inventory()
    assert.equal(inventory.sdkVersion, runtime.pi.version)
    assert.equal(inventory.agentDir, agentDir)
    assert.equal(inventory.defaultModel?.id, 'native-existing')
    assert.ok(inventory.models.some(model => model.provider === 'existing' && model.id === 'native-existing'))
    assert.deepEqual(inventory.providers.find(provider => provider.id === 'existing')?.models, [{ provider: 'existing', id: 'native-existing', name: 'Existing native configuration', thinkingLevels: ['off'], thinkingLevel: 'off' }])
    assert.equal(JSON.stringify(inventory).includes(staticKey), false)
    const settingsView = await gateway.agentConfiguration()
    assert.ok(isJsonObject(settingsView) && isJsonObject(settingsView.preferences))
    assert.equal(settingsView.preferences.defaultModel, 'native-existing')
    assert.equal(JSON.stringify(settingsView).includes(staticKey), false)
    const edited = await gateway.agentConfiguration({action:'preferences',values:{retry:false}})
    assert.ok(isJsonObject(edited) && isJsonObject(edited.preferences) && edited.preferences.retry === false)
    const packageRoot = join(root, 'local-package')
    await mkdir(packageRoot)
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({name:'packaged-extension-fixture',version:'1.0.0',pi:{extensions:['./extension.js']}}))
    await writeFile(join(packageRoot, 'extension.js'), 'export default function () {}')
    const installed = await gateway.agentConfiguration({action:'package',operation:'install',scope:'user',source:packageRoot})
    assert.ok(isJsonObject(installed) && Array.isArray(installed.packages))
    const installedPackage = installed.packages.find(item => isJsonObject(item) && item.name === 'packaged-extension-fixture')
    assert.ok(isJsonObject(installedPackage) && typeof installedPackage.id === 'string')
    await gateway.agentConfiguration({action:'package',operation:'remove',packageId:installedPackage.id})
    const cancelled = gateway.startLogin('deepseek', 'api_key')
    const prompt = await waiting(gateway, cancelled.id)
    assert.equal(prompt.prompt?.type, 'secret')
    await gateway.cancel(cancelled.id)
    assert.equal(gateway.attempt(cancelled.id)?.status, 'cancelled')
    const eof = gateway.startLogin('deepseek', 'api_key')
    await waiting(gateway, eof.id)
    await gateway.dispose()
    assert.equal(gateway.attempt(eof.id)?.status, 'cancelled')
    await assert.rejects(gateway.inventory(), /closed/)
    const stored: unknown = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))
    assert.ok(isJsonObject(stored) && stored.deepseek === undefined)
    gateway = undefined
  } finally { await gateway?.dispose(); await rm(root, { recursive: true, force: true }) }
})
