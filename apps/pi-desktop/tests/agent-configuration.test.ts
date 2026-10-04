/** Real selected Pi owns settings persistence and resource resolution; tests use private profiles. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentConfiguration } from '../runtime/agent-configuration.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'
import { resolveProviderRuntime } from '../bridge/provider-runtime.ts'
import { PiProcess } from '../bridge/process.ts'
import { isJsonObject } from '../bridge/types.ts'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
test('native settings, skills, prompts, instructions and MCP edits preserve Pi data and reach its CLI', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(appRoot, process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the selected native Pi runtime'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-agent-configuration-'))
  const agentDir = join(root, 'agent'), cwd = join(root, 'project')
  await mkdir(agentDir); await mkdir(cwd)
  const selected = await resolveProviderRuntime({ ...bundledPi(bundled), agentDir })
  const loaded: unknown = await import(selected.sdkEntry)
  const config = new AgentConfiguration(loaded, cwd, agentDir)
  const original = { extra: { retained: 1 }, compaction: { reserveTokens: 5678, enabled: true }, retry: { maxRetries: 5 }, images: { extra: 'keep' } }
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify(original))
  await writeFile(join(agentDir, 'mcp.json'), JSON.stringify({ extra: 'keep', mcpServers: { existing: { url: 'https://example.test/mcp?secret=private', headers: { Authorization: 'private-mcp-header' }, enabled: false } } }))
  try {
    const initial = await config.view()
    assert.equal(initial.preferences.compaction, true)
    assert.ok(!JSON.stringify(initial).includes('private'))
    await assert.rejects(config.update({ action: 'preferences', values: { compaction: false, thinking: 'invalid' } }), /thinking/)
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')), original)
    await config.update({ action: 'preferences', values: { compaction: false, retry: false, thinking: 'high', steering: 'all', autoResize: false } })
    const persisted = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))
    assert.equal(persisted.compaction.reserveTokens, 5678)
    assert.equal(persisted.compaction.enabled, false)
    assert.equal(persisted.retry.maxRetries, 5)
    assert.equal(persisted.retry.enabled, false)
    assert.deepEqual(persisted.extra, { retained: 1 })
    assert.equal(persisted.images.extra, 'keep')
    await config.update({ action: 'create', kind: 'prompts', scope: 'user', name: 'desktop-review', description: 'Review focused changes', content: 'Review $ARGUMENTS.' })
    await config.update({ action: 'create', kind: 'skills', scope: 'project', name: 'desktop-skill', description: 'Test a native skill', content: 'Follow the project convention.' })
    assert.equal((await config.view()).projectTrusted, false)
    await config.update({ action: 'trust', scope: 'project', trusted: true })
    const created = await config.view()
    const prompt = created.resources.find(item => item.kind === 'prompts' && item.name === 'desktop-review')
    const skill = created.resources.find(item => item.kind === 'skills' && item.name === 'desktop-skill')
    assert.ok(prompt); assert.ok(skill)
    const document = await config.read(prompt.id)
    await config.update({ action: 'write', resourceId: prompt.id, revision: document.revision, content: document.content.replace('Review $ARGUMENTS.', 'Inspect $ARGUMENTS.') })
    await assert.rejects(config.update({ action: 'write', resourceId: prompt.id, revision: document.revision, content: 'stale' }), /changed on disk/)
    await config.update({ action: 'toggle', resourceId: skill.id, enabled: false })
    assert.equal((await config.view()).resources.find(item => item.id === skill.id)?.enabled, false)
    await config.update({ action: 'toggle', resourceId: skill.id, enabled: true })
    assert.equal((await config.view()).resources.find(item => item.id === skill.id)?.enabled, true)
    const instructions = created.resources.find(item => item.kind === 'instructions' && item.path === join(cwd, 'AGENTS.md'))
    assert.ok(instructions)
    const instructionDoc = await config.read(instructions.id)
    await config.update({ action: 'write', resourceId: instructions.id, revision: instructionDoc.revision, content: 'Use precise names.\n' })
    assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), 'Use precise names.\n')
    await config.update({ action: 'mcp', scope: 'user', name: 'existing', exposure: 'direct', enabled: false })
    const mcp = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf8'))
    assert.equal(mcp.mcpServers.existing.headers.Authorization, 'private-mcp-header')
    assert.equal(mcp.mcpServers.existing.url, 'https://example.test/mcp?secret=private')
    assert.equal(mcp.extra, 'keep')
    assert.ok(!JSON.stringify(await config.view()).includes('private'))
    await assert.rejects(config.update({ action: 'create', kind: 'prompts', scope: 'user', name: '../escape', description: 'x', content: 'x' }), /lowercase/)
    let connected!: () => void
    const connectedToMcp = new Promise<void>(resolve => { connected = resolve })
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405).end(); return }
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part))
      const input: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (!isJsonObject(input)) { response.writeHead(400).end(); return }
      if (input.id === undefined) { response.writeHead(202).end(); return }
      let result: unknown = {}
      if (input.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'settings-fixture', version: '1.0.0' } }
      if (input.method === 'tools/list') { result = { tools: [{ name: 'echo', description: 'Test echo', inputSchema: {type:'object',properties:{}} }] }; connected() }
      response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}))
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
    const address = server.address(); assert.ok(address !== null && typeof address !== 'string')
    await config.update({action:'mcp',scope:'project',name:'settings-fixture',url:`http://127.0.0.1:${address.port}/mcp`,enabled:true,exposure:'direct'})
    const runtime = { ...bundledPi(bundled), agentDir, cwd }
    const pi = new PiProcess(runtime)
    try {
      await pi.start()
      const commands = await pi.request({ type: 'get_commands' })
      assert.ok(isJsonObject(commands) && Array.isArray(commands.commands))
      assert.ok(commands.commands.some(item => isJsonObject(item) && item.name === 'desktop-review'))
      const state = await pi.request({ type: 'get_state' })
      assert.ok(isJsonObject(state))
      assert.equal(persisted.defaultThinkingLevel, 'high')
      assert.equal(state.autoCompactionEnabled, false)
      assert.equal(state.steeringMode, 'all')
      await connectedToMcp
    } finally { await pi.dispose() }
  } finally { await rm(root, { recursive: true, force: true }) }
})

// The extension writes a marker only when Pi loads it, separating discovery from execution.
test('native package lifecycle preserves scopes and discovers resources without executing extensions', { timeout: 60_000 }, async context => {
  const bundled = await availableBundledRuntime(appRoot, process.env.PI_DESKTOP_TEST_RUNTIME)
  if (!bundled) { context.skip('Prepare the selected native Pi runtime'); return }
  const root = await mkdtemp(join(tmpdir(), 'pi-package-configuration-'))
  context.after(async () => { await rm(root, { recursive: true, force: true }) })
  const agentDir = join(root, 'agent'), cwd = join(root, 'project'), packageRoot = join(root, 'package')
  await Promise.all([mkdir(agentDir), mkdir(cwd), mkdir(packageRoot)])
  const marker = join(root, 'loaded.txt')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'desktop-fixture-extension', version: '1.0.0', description: 'Native package fixture', pi: { extensions: ['./index.ts'], skills: ['./skills'] } }))
  await mkdir(join(packageRoot, 'skills', 'skill-folder'), { recursive: true })
  await writeFile(join(packageRoot, 'skills', 'skill-folder', 'SKILL.md'), '---\nname: package-skill\ndescription: A packaged skill\n---\n\nUse the package workflow.\n')
  await writeFile(join(packageRoot, 'index.ts'), `import {writeFileSync} from 'node:fs'; export default function(pi) { writeFileSync(${JSON.stringify(marker)}, 'loaded'); pi.registerCommand('package-fixture', {description:'Fixture command', handler:async()=>{}}) }`)
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ extra: 'keep' }))
  const selected = await resolveProviderRuntime({ ...bundledPi(bundled), agentDir })
  const config = new AgentConfiguration(await import(selected.sdkEntry), cwd, agentDir)
  await assert.rejects(config.update({ action: 'package', operation: 'install', source: packageRoot, scope: 'project' }), /Trust/)
  await assert.rejects(config.update({ action: 'package', operation: 'install', source: 'https://token@github.com/a/b', scope: 'user' }), /credential-free/)
  await config.update({ action: 'package', operation: 'install', source: packageRoot, scope: 'user' })
  const view = await config.view(), item = view.packages[0]
  assert.ok(item); assert.equal(item.name, 'desktop-fixture-extension'); assert.equal(item.version, '1.0.0'); assert.equal(item.installed, true)
  const resource = view.resources.find(value => value.packageId === item.id && value.kind === 'extensions')
  assert.ok(resource); assert.equal(resource.enabled, true)
  const skill = view.resources.find(value => value.packageId === item.id && value.kind === 'skills')
  assert.ok(skill && skill.enabled && !skill.editable)
  assert.equal(skill.name, 'package-skill')
  assert.match((await config.read(skill.id)).content, /Use the package workflow/)
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
  const pi = new PiProcess({ ...bundledPi(bundled), agentDir, cwd })
  try {
    await pi.start()
    assert.equal(await readFile(marker, 'utf8'), 'loaded')
    const commands = await pi.request({ type: 'get_commands' })
    assert.ok(isJsonObject(commands) && Array.isArray(commands.commands) && commands.commands.some(value => isJsonObject(value) && value.name === 'package-fixture'))
    assert.ok(commands.commands.some(value => isJsonObject(value) && value.name === 'skill:package-skill'))
  } finally { await pi.dispose() }
  await config.update({ action: 'toggle', resourceId: resource.id, enabled: false })
  await config.update({ action: 'toggle', resourceId: skill.id, enabled: false })
  assert.equal((await config.view()).resources.find(value => value.id === resource.id)?.enabled, false)
  await config.update({ action: 'package', operation: 'update', packageId: item.id })
  assert.equal((await config.view()).resources.find(value => value.id === resource.id)?.enabled, false)
  assert.equal((await config.view()).resources.find(value => value.id === skill.id)?.enabled, false)
  await config.update({ action: 'toggle', resourceId: skill.id, enabled: true })
  assert.equal((await config.view()).resources.find(value => value.id === resource.id)?.enabled, false)
  await config.update({ action: 'package', operation: 'remove', packageId: item.id })
  assert.equal((await config.view()).packages.length, 0)
  assert.ok(await readFile(join(packageRoot, 'index.ts'), 'utf8'))
  assert.equal(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')).extra, 'keep')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'pi-web-search', version: '1.5.0', pi: { extensions: ['./index.ts'] } }))
  await config.update({ action: 'package', operation: 'install', source: packageRoot, scope: 'user' })
  const otherRoot = join(root, 'other-package')
  await mkdir(otherRoot)
  await writeFile(join(otherRoot, 'package.json'), JSON.stringify({ name: 'pi-web-access', version: '0.35.0', pi: { extensions: ['./index.ts'] } }))
  await writeFile(join(otherRoot, 'index.ts'), "export default function(pi) { pi.registerCommand('coexisting-fixture', {description:'Different native registration', handler:async()=>{}}) }")
  await config.update({ action: 'package', operation: 'install', source: otherRoot, scope: 'user' })
  const pair = await config.view()
  const otherPackage = pair.packages.find(value => value.name === 'pi-web-access')
  const otherResource = pair.resources.find(value => value.packageId === otherPackage?.id)
  assert.ok(otherResource)
  await config.update({ action: 'toggle', resourceId: otherResource.id, enabled: false })
  await config.update({ action: 'toggle', resourceId: otherResource.id, enabled: true })
  const coexistingPi = new PiProcess({ ...bundledPi(bundled), agentDir, cwd })
  try {
    await coexistingPi.start()
    const commands = await coexistingPi.request({ type: 'get_commands' })
    assert.match(JSON.stringify(commands), /package-fixture/)
    assert.match(JSON.stringify(commands), /coexisting-fixture/)
  } finally { await coexistingPi.dispose() }
})
