/** Offline runtime installation preserves executable relocation and external selection. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { bundledPi, installBundledRuntime, nativeRuntimeTarget, readBundledRuntime } from '../runtime/bundled.ts'
import { loadRuntime } from '../runtime/config.ts'

test('offline payload installs atomically, relocates executables, and yields to an independently selected Pi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-offline-install-'))
  try {
    const source = join(root, 'source payload')
    const home = join(root, 'user home')
    const app = join(root, 'app')
    const manifest = { format: 'pi-desktop-runtime-v1', target: nativeRuntimeTarget(),
      node: { version: '24.21.0', executable: 'node/bin/node' }, pi: { version: '0.99.1', cli: 'pi/cli.js', defaultArgs: [] },
      pnpm: { version: '11.7.0', cli: 'pnpm/cli.js' }, auxiliary: { python: { version: '3.12.14', executable: 'python/bin/python3', packagesDirectory: 'python/packages' }, extension: 'pi/resources.ts' } }
    for (const file of ['node/bin/node', 'pi/cli.js', 'pnpm/cli.js', 'python/bin/python3', 'pi/resources.ts', 'python/packages/library.py']) {
      await mkdir(dirname(join(source, file)), { recursive: true })
      await writeFile(join(source, file), file)
    }
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
    if (process.platform !== 'win32') {
      await mkdir(join(source, 'bin'))
      await symlink('../node/bin/node', join(source, 'bin/node'))
    }
    const [first, concurrent] = await Promise.all([installBundledRuntime(source, home), installBundledRuntime(source, home)])
    assert.equal(first.root, concurrent.root)
    assert.equal(first.node.executable, join(first.root, 'node/bin/node'))
    assert.equal(await readFile(first.pi.cli, 'utf8'), 'pi/cli.js')
    if (process.platform !== 'win32') assert.equal(await readlink(join(first.root, 'bin/node')), '../node/bin/node')
    assert.deepEqual(await installBundledRuntime(source, home), first)
    const selected = await loadRuntime(app, { bundledRoot: source, installationHome: home })
    assert.equal(selected.command, first.node.executable)
    assert.deepEqual(selected.args, bundledPi(first).args)
    assert.ok(selected.env?.PATH?.startsWith(join(first.root, 'bin')))
    await mkdir(join(app, 'runtime'), { recursive: true })
    await writeFile(join(app, 'runtime/selected.json'), JSON.stringify({ command: 'user-selected-node', args: ['pi-0.100.0/cli.js'], version: '0.100.0', env: { CUSTOM: 'preserved' } }))
    assert.deepEqual(await loadRuntime(app, { bundledRoot: source, installationHome: home }), { command: 'user-selected-node', args: ['pi-0.100.0/cli.js'], version: '0.100.0', env: { CUSTOM: 'preserved' } })
    await writeFile(join(app, 'runtime/selected.json'), JSON.stringify({ mode: 'bundled', agentDir: 'user-native-pi-profile' }))
    const restored = await loadRuntime(app, { bundledRoot: source, installationHome: home })
    assert.equal(restored.command, first.node.executable)
    assert.equal(restored.agentDir, 'user-native-pi-profile')
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, pi: { ...manifest.pi, version: '0.99.2' } }))
    const successor = await installBundledRuntime(source, home)
    assert.notEqual(successor.root, first.root)
    assert.equal((await readBundledRuntime(first.root)).pi.version, '0.99.1')
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, node: { ...manifest.node, executable: '../outside' } }))
    await assert.rejects(readBundledRuntime(source), /escapes/)
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, target: 'incompatible-target' }))
    await assert.rejects(readBundledRuntime(source), /does not match/)
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, auxiliary: { ...manifest.auxiliary, extension: 'missing.ts' } }))
    await assert.rejects(installBundledRuntime(source, home), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
