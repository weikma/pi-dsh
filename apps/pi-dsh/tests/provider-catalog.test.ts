/** Catalog precedence uses actual extension registrations from the selected official Pi. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'
import { ProviderGateway } from '../bridge/providers.ts'
import { providerCatalog } from '../bridge/provider-catalog.ts'
import { PiBridge } from '../bridge/manager.ts'
import { isJsonObject } from '../bridge/types.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'
import { createPiFixture } from './pi-fixture.ts'

test('active Pi extensions supply the catalog without changing authentication or static configuration', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(resolve('apps/pi-dsh'), process.env.PI_DSH_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the official native Pi runtime'); return }
  const selected = bundledPi(bundled)
  const scrubbed = Object.fromEntries(Object.keys(process.env).filter(key => /key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key)).map(key => [key, '']))
  const fixture = await createPiFixture({ ...selected, env: { ...selected.env, ...scrubbed } })
  context.after(() => fixture.dispose())
  const source = await readFile(join(fixture.agentDir, 'models.json'), 'utf8')
  const config: unknown = JSON.parse(source)
  assert.ok(isJsonObject(config) && isJsonObject(config.providers) && isJsonObject(config.providers.fixture))
  const extension = join(fixture.cwd, 'catalog.ts')
  const models = ['alpha', 'beta'].map(id => ({ id, name: `Discovered ${id}`, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }))
  await writeFile(extension, `export default function(pi) { for(const id of ['fixture','extension-only']) pi.registerProvider(id, ${JSON.stringify({ baseUrl: config.providers.fixture.baseUrl, api: 'openai-completions', apiKey: 'fixture-only', models })}) }`)
  const bridge = new PiBridge({ ...selected, agentDir: fixture.agentDir, args: [...selected.args, '--no-extensions', '-e', extension], env: { ...selected.env, ...scrubbed, PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: join(fixture.agentDir, 'sessions') } })
  try {
    const session = await bridge.createSession(fixture.cwd)
    const sessionModels = session.snapshot().models.map(model => ({ provider: model.provider, id: model.id, name: model.name ?? model.id }))
    assert.ok(sessionModels.some(model => model.provider === 'fixture' && model.id === 'alpha'))
    assert.ok(sessionModels.some(model => model.provider === 'extension-only' && model.id === 'beta'))
    const staticModel = { provider: 'fixture', id: 'scripted', name: 'Static model' }
    const inventory = { agentDir: fixture.agentDir, sdkVersion: bundled.pi.version, providers: [{ id: 'fixture', name: 'Fixture', authTypes: [], authStatus: { configured: true }, modelCount: 1, models: [staticModel] }], models: [staticModel], extensionProvidersSupported: false as const, limitations: [] }
    const catalog = providerCatalog(inventory, sessionModels)
    assert.equal(catalog.providers.find(provider => provider.id === 'fixture')?.modelSource, 'session')
    assert.deepEqual(catalog.providers.find(provider => provider.id === 'fixture')?.models, sessionModels.filter(model => model.provider === 'fixture'))
    assert.deepEqual(catalog.providers.find(provider => provider.id === 'extension-only')?.authStatus, { configured: false })
    assert.deepEqual(catalog.available, sessionModels)
    assert.deepEqual(providerCatalog(inventory).available, [staticModel])
    assert.deepEqual(providerCatalog(inventory, []).available, [])
    assert.equal(providerCatalog(inventory).providers.length, 1)
    await session.command({ type: 'set_model', provider: 'fixture', modelId: 'alpha' })
    assert.equal(session.snapshot().state.model?.id, 'alpha')
    assert.equal(await readFile(join(fixture.agentDir, 'models.json'), 'utf8'), source)
    assert.equal(fixture.requests.length, 0)
  } finally { await bridge.dispose() }
})


test('draft thinking metadata agrees with the selected Pi RPC across model capabilities and native defaults', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(resolve('apps/pi-dsh'), process.env.PI_DSH_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the official native Pi runtime'); return }
  const selected = bundledPi(bundled)
  const fixture = await createPiFixture(selected)
  context.after(() => fixture.dispose())
  const path = join(fixture.agentDir, 'models.json')
  const config: unknown = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(isJsonObject(config) && isJsonObject(config.providers) && isJsonObject(config.providers.fixture))
  config.providers.fixture.models = [
    { id: 'plain', reasoning: false },
    { id: 'reasoner', reasoning: true },
    { id: 'advanced', reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, xhigh: 'xhigh', max: 'max' } },
  ].map(model => ({ ...model, name: model.id, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }))
  const models = JSON.stringify(config)
  const settings = JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'reasoner', defaultThinkingLevel: 'low', modelThinkingLevels: { 'fixture/advanced': 'max' } })
  await writeFile(path, models)
  await writeFile(join(fixture.agentDir, 'settings.json'), settings)
  const runtime = { ...selected, agentDir: fixture.agentDir, args: [...selected.args, '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes'], env: { ...selected.env, PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: join(fixture.agentDir, 'sessions') } }
  const bridge = new PiBridge(runtime)
  const worker = join(fixture.agentDir, 'provider-worker.mjs')
  await build({ entryPoints: [resolve('apps/pi-dsh/runtime/provider-worker.ts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
  let gateway: ProviderGateway | undefined
  try {
    gateway = await ProviderGateway.create(runtime, worker, fixture.cwd, bundled.node.executable)
    const inventory = await gateway.inventory()
    assert.equal(inventory.defaultModel?.thinkingLevel, 'low')
    assert.equal(await readFile(join(fixture.agentDir, 'settings.json'), 'utf8'), settings)
    const session = await bridge.createSession(fixture.cwd)
    for (const model of inventory.models.filter(model => model.provider === 'fixture')) {
      await session.command({ type: 'set_model', provider: model.provider, modelId: model.id })
      assert.deepEqual(model.thinkingLevels, session.snapshot().thinkingLevels, model.id)
      assert.equal(model.thinkingLevel, session.snapshot().state.thinkingLevel, model.id)
    }
    assert.equal(fixture.requests.length, 0)
    assert.equal(await readFile(path, 'utf8'), models)
  } finally { await gateway?.dispose(); await bridge.dispose() }
})
