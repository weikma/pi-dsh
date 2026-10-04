/** Selected-package SDK resolution uses private fake installations without executing their binaries. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolveProviderRuntime, ProviderRuntimeUnsupportedError } from '../bridge/provider-runtime.ts'

async function fixture(name = '@earendil-works/pi-coding-agent') {
  const root = await mkdtemp(join(tmpdir(), 'pi-provider-runtime-'))
  const pkg = join(root, 'selected-package')
  const bin = join(root, 'bin')
  await mkdir(join(pkg, 'dist'), { recursive: true }); await mkdir(bin)
  const cli = join(pkg, 'dist', 'cli.js')
  const sdk = join(pkg, 'public-entry.mjs')
  const node = join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
  await writeFile(cli, '#!/usr/bin/env node\nexport {}\n', { mode: 0o700 })
  await writeFile(sdk, 'export const selected = true\n')
  await writeFile(node, 'fixture interpreter, never executed\n', { mode: 0o700 })
  const metadata = { name, type: 'module', bin: { pi: './dist/cli.js' }, exports: { '.': { types: './types.d.ts', import: './public-entry.mjs' } } }
  const update = (value: object | string) => writeFile(join(pkg, 'package.json'), typeof value === 'string' ? value : JSON.stringify(value))
  await update(metadata)
  return { root, pkg, cli, sdk, node, bin, metadata, update, dispose: () => rm(root, { recursive: true, force: true }) }
}

test('selected Node resolves its public import and preserves secret arguments and effective environment only as data', async () => {
  const owned = await fixture()
  try {
    const args = [owned.cli, '--provider', 'fixture', '--api-key', 'private-key-never-in-error', '--mode', 'rpc']
    const runtime = { command: owned.node, args, env: { PATH: '', PI_CODING_AGENT_DIR: 'lower-priority', PRIVATE_CONFIG: 'private-env' }, agentDir: join(owned.root, 'agent') }
    const resolved = await resolveProviderRuntime(runtime)
    assert.equal(resolved.command, await realpath(owned.node))
    assert.equal(resolved.sdkEntry, pathToFileURL(await realpath(owned.sdk)).href)
    assert.deepEqual(resolved.cliArgs, args.slice(1))
    assert.notEqual(resolved.cliArgs, args)
    assert.equal(resolved.env.PRIVATE_CONFIG, 'private-env')
    assert.equal(resolved.env.PI_CODING_AGENT_DIR, runtime.agentDir)
    assert.equal(resolved.agentDir, runtime.agentDir)
    assert.equal(runtime.env.PI_CODING_AGENT_DIR, 'lower-priority')
    assert.equal(args[0], owned.cli)
  } finally { await owned.dispose() }
})

test('PATH global Pi follows its symlink to the selected package and uses that PATH Node', async context => {
  if (process.platform === 'win32') { context.skip('POSIX executable symlinks and env-node shebang are not Windows npm cmd shims'); return }
  const owned = await fixture()
  try {
    await symlink(owned.cli, join(owned.bin, 'pi'))
    const result = await resolveProviderRuntime({ command: 'pi', args: ['--api-key', 'private-fixture-key'], env: { PATH: owned.bin } })
    assert.equal(result.command, await realpath(owned.node))
    assert.equal(result.sdkEntry, pathToFileURL(await realpath(owned.sdk)).href)
    assert.deepEqual(result.cliArgs, ['--api-key', 'private-fixture-key'])
  } finally { await owned.dispose() }
})

test('Bun selections may borrow a bundled Node but never its SDK, including a historical official main entry', async () => {
  const selected = await fixture('@mariozechner/pi-coding-agent')
  const bundled = await fixture()
  try {
    await selected.update({ name: '@mariozechner/pi-coding-agent', bin: { pi: './dist/cli.js' }, main: './public-entry.mjs' })
    const bun = join(selected.bin, process.platform === 'win32' ? 'bun.exe' : 'bun')
    await writeFile(bun, 'fixture bun, never executed\n', { mode: 0o700 })
    const result = await resolveProviderRuntime({ command: bun, args: [selected.cli, '--model', 'fixture'], env: { PATH: '' } }, bundled.node)
    assert.equal(result.command, await realpath(bundled.node))
    assert.equal(result.sdkEntry, pathToFileURL(await realpath(selected.sdk)).href)
    assert.notEqual(result.sdkEntry, pathToFileURL(await realpath(bundled.sdk)).href)
    assert.deepEqual(result.cliArgs, ['--model', 'fixture'])
  } finally { await selected.dispose(); await bundled.dispose() }
})

test('invalid metadata, private exports, foreign packages and interpreter flags refuse rather than switching SDKs', async () => {
  const owned = await fixture()
  const bundled = await fixture()
  const secret = 'private-argument-never-in-diagnostic'
  try {
    const runtime = { command: owned.node, args: [owned.cli, '--api-key', secret], env: { PATH: '' } }
    const refused = async () => assert.rejects(resolveProviderRuntime(runtime, bundled.node), error => {
      assert.ok(error instanceof ProviderRuntimeUnsupportedError)
      assert.equal(error.code, 'provider-runtime/unsupported')
      assert.equal(error.message.includes(secret), false)
      return true
    })
    for (const metadata of [
      '{ malformed',
      { ...owned.metadata, name: 'unrelated-wrapper' },
      { ...owned.metadata, bin: { pi: './public-entry.mjs' } },
      { ...owned.metadata, main: './public-entry.mjs', exports: { '.': { require: './public-entry.mjs' } } },
      { ...owned.metadata, exports: { '.': { import: './missing.mjs' } } },
      { ...owned.metadata, exports: { '.': { import: '../outside.mjs' } } },
    ]) { await owned.update(metadata); await refused() }
    await owned.update(owned.metadata)
    await assert.rejects(resolveProviderRuntime({ ...runtime, args: ['--inspect', owned.cli, '--api-key', secret] }), ProviderRuntimeUnsupportedError)
    const wrapper = join(owned.bin, 'pi-wrapper')
    await writeFile(wrapper, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await assert.rejects(resolveProviderRuntime({ ...runtime, command: wrapper, args: [] }), ProviderRuntimeUnsupportedError)
    const binary = join(owned.bin, 'compiled-pi')
    await writeFile(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), { mode: 0o700 })
    await assert.rejects(resolveProviderRuntime({ ...runtime, command: binary, args: [] }, bundled.node), ProviderRuntimeUnsupportedError)
  } finally { await owned.dispose(); await bundled.dispose() }
})

test('public SDK and package metadata symlinks cannot escape the selected package', async context => {
  if (process.platform === 'win32') { context.skip('File symlink creation requires Windows privileges; ordinary metadata/export validation is covered separately'); return }
  const owned = await fixture()
  try {
    const outside = join(owned.root, 'outside.mjs')
    await writeFile(outside, 'export {}\n')
    await symlink(outside, join(owned.pkg, 'escaped.mjs'))
    await owned.update({ ...owned.metadata, exports: { '.': { import: './escaped.mjs' } } })
    const runtime = { command: owned.node, args: [owned.cli], env: { PATH: '' } }
    await assert.rejects(resolveProviderRuntime(runtime), ProviderRuntimeUnsupportedError)
    await rm(join(owned.pkg, 'package.json'))
    const outsideMetadata = join(owned.root, 'outside-package.json')
    await writeFile(outsideMetadata, JSON.stringify(owned.metadata))
    await symlink(outsideMetadata, join(owned.pkg, 'package.json'))
    await assert.rejects(resolveProviderRuntime(runtime), ProviderRuntimeUnsupportedError)
  } finally { await owned.dispose() }
})

test('Electron cannot supply its host executable as the management Node fallback', async () => {
  const owned = await fixture()
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron')
  try {
    const bun = join(owned.bin, process.platform === 'win32' ? 'bun.exe' : 'bun')
    await writeFile(bun, 'fixture bun, never executed\n', { mode: 0o700 })
    Object.defineProperty(process.versions, 'electron', { value: 'fixture', configurable: true })
    const runtime = { command: bun, args: [owned.cli], env: { PATH: '' } }
    await assert.rejects(resolveProviderRuntime(runtime), ProviderRuntimeUnsupportedError)
    await assert.rejects(resolveProviderRuntime(runtime, process.execPath), ProviderRuntimeUnsupportedError)
    const independent = await resolveProviderRuntime(runtime, owned.node)
    assert.equal(independent.command, await realpath(owned.node))
  } finally {
    if (descriptor) Object.defineProperty(process.versions, 'electron', descriptor)
    else Reflect.deleteProperty(process.versions, 'electron')
    await owned.dispose()
  }
})
