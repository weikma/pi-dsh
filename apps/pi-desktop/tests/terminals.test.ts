/** Actual PTYs validate input, screen recovery, resize, interrupts, and descendant cleanup. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Terminals } from '../terminals.ts'
import type { TerminalEvent } from '../terminal-types.ts'

test('interactive terminals retain bounded screens and stop foreground/background processes', { timeout: 20_000, skip: process.platform === 'win32' }, async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'pi-terminal-test-')))
  const terminals = new Terminals({ file: '/bin/sh', args: ['-i'] })
  let dispose: (() => void) | undefined
  try {
    const info = terminals.create(cwd), terminal = terminals.get(info.id)
    let output = ''
    const waiters = new Set<() => void>()
    const accept = (event: TerminalEvent): void => {
      if (event.type === 'output' || event.type === 'screen') output += event.data
      for (const waiter of waiters) waiter()
    }
    const until = (predicate: () => boolean): Promise<void> => new Promise((done, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Terminal output condition timed out: ' + JSON.stringify(output.slice(-1200)))) }, 5000)
      const check = (): void => { if (predicate()) { clearTimeout(timer); waiters.delete(check); done() } }
      waiters.add(check); check()
    })
    dispose = await terminal.subscribe(accept)
    terminal.write("printf 'saved' > created.txt; pwd; printf '%s%s\\n' 'PTY_' 'READY'\r")
    await until(() => output.includes('PTY_READY') && output.includes(cwd))
    assert.equal(await readFile(join(cwd, 'created.txt'), 'utf8'), 'saved')
    await terminal.resize(101, 31)
    output = ''; terminal.write('stty size\r')
    await until(() => /31\s+101/.test(output))
    dispose(); output = ''
    dispose = await terminal.subscribe(accept)
    assert.match(output, /PTY_READY/)
    assert.match(output, /31\s+101/)
    terminal.write("sh -c 'printf \"BACKGROUND:%s\\n\" $$; sleep 60' & wait\r")
    await until(() => /BACKGROUND:(\d+)/.test(output))
    const pid = Number(/BACKGROUND:(\d+)/.exec(output)?.[1])
    assert.ok(pid > 1)
    process.kill(pid, 0)
    output = ''; terminal.write('\x03')
    await until(() => /[#$] $/.test(output))
    terminal.write("printf '%s%s\\n' 'AFTER_' 'INTERRUPT'\r")
    await until(() => output.includes('AFTER_INTERRUPT'))
    await terminals.remove(info.id)
    assert.equal(terminals.size, 0)
    await assert.rejects(async () => terminals.get(info.id))
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try { process.kill(pid, 0) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') break; throw error }
      await delay(10)
    }
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    const second = terminals.create(cwd)
    dispose = await terminals.get(second.id).subscribe(() => {})
    await terminals.close()
    assert.equal(terminals.size, 0)
    assert.throws(() => terminals.create(cwd), /stopping/)
  } finally { dispose?.(); await terminals.close(); await rm(cwd, { recursive: true, force: true }) }
})
