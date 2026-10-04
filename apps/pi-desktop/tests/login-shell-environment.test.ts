/** Login-shell reads release inherited stdout and their owned probe processes. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { isJsonObject } from '../bridge/types.ts'

async function refusesConnection(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(5000)
    socket.once('connect', () => { socket.destroy(); reject(new Error('Probe background listener survived')) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Probe listener teardown was not observable')) })
    socket.once('error', error => {
      if ('code' in error && error.code === 'ECONNREFUSED') resolve()
      else reject(error)
    })
  })
}

async function stopFixtureGroup(groupFile: string): Promise<void> {
  let group: number
  try { group = Number(await readFile(groupFile, 'utf8')) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  assert.ok(Number.isSafeInteger(group) && group > 1, 'Fixture process group must be a positive child PID')
  try { process.kill(-group, 'SIGKILL') } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

for (const mode of ['success', 'abort'] as const) {
  test(`login-shell ${mode} exits naturally and terminates the owned stdout-retaining listener`, { timeout: 30_000 }, async context => {
    if (process.platform === 'win32') { context.skip('POSIX detached probe groups and /bin/sh are unavailable on Windows'); return }
    const root = await mkdtemp(join(tmpdir(), 'pi-shell-environment-'))
    const shell = join(root, 'shell.sh')
    const groupFile = join(root, 'group.pid')
    const readyFile = join(root, 'listener.json')
    const background = join(root, 'listener.mjs')
    const runner = join(root, 'read.mjs')
    let teardownVerified = false
    try {
      await writeFile(background, `import {createServer} from 'node:net';
import {writeFileSync} from 'node:fs';
const server=createServer();
server.listen(0,'127.0.0.1',()=>{writeFileSync(process.env.PROBE_READY_FILE,JSON.stringify({port:server.address().port}));});
`)
      await writeFile(shell, `#!/bin/sh
printf '%s\\n' "$$" > "$PROBE_GROUP_FILE"
"$PROBE_NODE" "$PROBE_BACKGROUND" &
while [ ! -s "$PROBE_READY_FILE" ]; do :; done
${mode === 'success' ? "printf '\\0_PI_DESKTOP_SHELL_ENV_DELIMITER_\\0CHECK=done\\0_PI_DESKTOP_HOME=from-shell\\0_PI_DESKTOP_SHELL_ENV_DELIMITER_\\0'\nexit 0" : 'wait'}
`, { mode: 0o700 })
      const owner = new URL('../login-shell-environment.ts', import.meta.url).href
      await writeFile(runner, `import {existsSync,watch} from 'node:fs';
import {readDesktopLoginShellEnvironment} from ${JSON.stringify(owner)};
const controller=new AbortController();
const pending=readDesktopLoginShellEnvironment({PATH:'/usr/bin:/bin',PROBE_NODE:process.execPath,PROBE_BACKGROUND:${JSON.stringify(background)},PROBE_GROUP_FILE:${JSON.stringify(groupFile)},PROBE_READY_FILE:${JSON.stringify(readyFile)},PI_DESKTOP_HOME:'launcher'}, {timeoutMs:10000}, {platform:'darwin',shells:[${JSON.stringify(shell)}],signal:controller.signal});
${mode === 'abort' ? `await new Promise(resolve=>{const observer=watch(${JSON.stringify(root)},()=>{if(existsSync(${JSON.stringify(readyFile)})){observer.close();resolve();}});if(existsSync(${JSON.stringify(readyFile)})){observer.close();resolve();}});
controller.abort();` : ''}
const result=await pending;
console.log(JSON.stringify({check:result.environment.CHECK,home:result.environment.PI_DESKTOP_HOME,failures:result.failures.map(failure=>failure.reason)}));
`)
      const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', runner], {
        cwd: new URL('../../..', import.meta.url), env: { PATH: process.env.PATH }, timeout: 20_000, killSignal: 'SIGKILL',
      })
      const output: unknown = JSON.parse(result.stdout.trim())
      assert.ok(isJsonObject(output))
      assert.equal(output.home, 'launcher')
      assert.deepEqual(output.failures, mode === 'success' ? [] : ['aborted'])
      assert.equal(output.check, mode === 'success' ? 'done' : undefined)
      const ready: unknown = JSON.parse(await readFile(readyFile, 'utf8'))
      assert.ok(isJsonObject(ready) && typeof ready.port === 'number')
      await refusesConnection(ready.port)
      teardownVerified = true
    } finally {
      // The runner exited and its listener is gone; the released group ID must not be signalled again.
      if (!teardownVerified) await stopFixtureGroup(groupFile)
      await rm(root, { recursive: true, force: true })
    }
  })
}
