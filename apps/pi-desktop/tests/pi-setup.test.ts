/** Terminal configuration keeps private environment values out of GUI command text. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { createPiSetupLauncher, piSetup, piTerminalScript } from '../pi-setup.ts'
import { startHost } from '../server.ts'
import { isJsonObject } from '../bridge/types.ts'

async function runSetupCommand(commandLine: string, extra: NodeJS.ProcessEnv = {}): Promise<void> {
  const command = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', commandLine] : ['-c', commandLine]
  await promisify(execFile)(command, args, { env: { ...process.env, ...extra }, timeout: 10_000 })
}

test('Pi setup commands redact API-key flags, use the selected agent directory, and keep shell input literal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-terminal-command-'))
  try {
    const setup = await piSetup({ command: '/node with space', args: ['pi.js', '--mode', 'rpc', '--api-key', 'private-key', '--api-key=another-private-key'], agentDir: '/private agent', env: { SOME_KEY: 'not-for-the-GUI' } }, root)
    assert.ok(setup.commandLine.includes("PI_CODING_AGENT_DIR='/private agent'"))
    assert.ok(!setup.commandLine.includes('private-key') && !setup.commandLine.includes('not-for-the-GUI') && !setup.commandLine.includes('rpc'))
    const windows = await piSetup({ command: 'C:\\Node path\\node.exe', args: ["pi's.js"], agentDir: 'C:\\agent' }, root, 'win32')
    assert.ok(windows.commandLine.includes("'pi''s.js'"))
    assert.ok(windows.commandLine.includes('$env:PI_CODING_AGENT_DIR'))
    await assert.rejects(piSetup({ command: 'pi', args: [] }, join(root, 'missing')), /ENOENT/)
    if (process.platform === 'win32') return
    const launcher = join(root, 'launch.command')
    const output = join(root, 'result.json')
    const probe = join(root, 'probe.mjs')
    await writeFile(probe, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3),value:process.env.PI_SETUP_TEST}));\n")
    const literal = "a' $(touch unintended-file) `not-a-command`\nlast line"
    await writeFile(launcher, piTerminalScript({ command: process.execPath, args: [probe, output, literal], env: { PI_SETUP_TEST: literal } }, root, launcher, 'darwin', { PATH: process.env.PATH }), { mode: 0o600 })
    await chmod(launcher, 0o700)
    await promisify(execFile)('/bin/sh', [launcher], { timeout: 10_000 })
    const observed: unknown = JSON.parse(await readFile(output, 'utf8'))
    assert.deepEqual(observed, { cwd: await realpath(root), args: [literal], value: literal })
    await assert.rejects(stat(launcher), /ENOENT/)
    await assert.rejects(stat(join(root, 'unintended-file')), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a reusable setup launcher preserves private configuration and excludes the terminal-only environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-terminal-private-'))
  let launcher: Awaited<ReturnType<typeof createPiSetupLauncher>> | undefined
  try {
    const probe = join(root, 'probe.mjs'), output = join(root, 'result.json')
    await writeFile(probe, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3),value:process.env.PI_SETUP_TEST,unexpectedProfile:process.env.PI_CODING_AGENT_DIR??null,unexpectedVariable:process.env.PI_SETUP_TERMINAL_ONLY??null}));\n")
    const privateValue = "private ' value $(touch unintended-file)\nend"
    const apiKey = 'private-api-key-fixture'
    const base: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? process.env.Path, SystemRoot: process.env.SystemRoot }
    launcher = await createPiSetupLauncher({ command: process.execPath, args: [probe, output, '--api-key', apiKey], env: { PI_SETUP_TEST: privateValue } }, root, root, process.platform, base)
    assert.ok(!launcher.commandLine.includes(apiKey) && !launcher.commandLine.includes(privateValue))
    assert.ok(!launcher.commandLine.includes('ExecutionPolicy'))
    const directory = join(root, 'terminal-launchers')
    const files = await readdir(directory)
    assert.equal(files.length, 1)
    if (process.platform !== 'win32') assert.equal((await stat(join(directory, files[0]!))).mode & 0o777, 0o700)
    await runSetupCommand(launcher.commandLine, { PI_CODING_AGENT_DIR: 'terminal-only-profile', PI_SETUP_TERMINAL_ONLY: 'terminal-only-value' })
    const observed: unknown = JSON.parse(await readFile(output, 'utf8'))
    assert.deepEqual(observed, { cwd: await realpath(root), args: ['--api-key', apiKey], value: privateValue, unexpectedProfile: null, unexpectedVariable: null })
    assert.deepEqual(await readdir(directory), files)
    await runSetupCommand(launcher.commandLine)
    assert.deepEqual(await readdir(directory), files)
    await assert.rejects(stat(join(root, 'unintended-file')), /ENOENT/)
    await launcher.dispose()
    assert.deepEqual(await readdir(directory), [])
  } finally { await launcher?.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('Host setup commands retain selected configuration and remove only their own files on runtime change and shutdown', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-host-terminal-'))
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const workspace = join(root, 'workspace'), home = join(root, 'gui'), runtimeDirectory = join(root, 'runtime')
    await mkdir(workspace); await mkdir(runtimeDirectory)
    const probe = join(root, 'probe.mjs'), output = join(root, 'result.json')
    await writeFile(probe, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3),value:process.env.PI_SETUP_TEST}));\n")
    const privateValue = 'private-provider-configuration', apiKey = 'private-host-api-key'
    const selected = { command: process.execPath, args: [probe, output, '--api-key', apiKey], env: { PI_SETUP_TEST: privateValue }, agentDir: join(root, 'agent') }
    await writeFile(join(runtimeDirectory, 'selected.json'), JSON.stringify(selected))
    host = await startHost({ appRoot: root, home, port: 0 })
    const url = host.url
    const setup = async (): Promise<{ commandLine: string; cwd: string }> => {
      const response = await fetch(url + '/api/pi-setup?' + new URLSearchParams({ cwd: workspace }))
      assert.equal(response.status, 200)
      const value: unknown = await response.json()
      assert.ok(isJsonObject(value) && typeof value.commandLine === 'string' && typeof value.cwd === 'string')
      assert.ok(!JSON.stringify(value).includes(privateValue) && !JSON.stringify(value).includes(apiKey))
      return { commandLine: value.commandLine, cwd: value.cwd }
    }
    const first = await setup()
    assert.equal(first.cwd, workspace)
    await runSetupCommand(first.commandLine)
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { cwd: await realpath(workspace), args: ['--api-key', apiKey], value: privateValue })
    const directory = join(home, 'terminal-launchers')
    const initial = await readdir(directory)
    assert.equal(initial.length, 1)
    const unrelated = join(directory, 'native-owned.command')
    await writeFile(unrelated, 'owned by another launcher\n', { mode: 0o600 })
    const updated = { ...selected, args: [probe, output, 'updated-arguments'] }
    const saved = await fetch(url + '/api/runtime', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(updated) })
    assert.equal(saved.status, 200)
    assert.deepEqual(await readdir(directory), ['native-owned.command'])
    const second = await setup()
    await runSetupCommand(second.commandLine)
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { cwd: await realpath(workspace), args: ['updated-arguments'], value: privateValue })
    assert.equal((await readdir(directory)).length, 2)
    await host.close(); host = undefined
    assert.deepEqual(await readdir(directory), ['native-owned.command'])
    await assert.rejects(runSetupCommand(second.commandLine))
  } finally { await host?.close(); await rm(root, { recursive: true, force: true }) }
})
