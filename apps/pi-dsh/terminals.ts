/** GUI-owned interactive shells, independent of Pi's execution and tools. */
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import { userInfo } from 'node:os'
import { spawn, type IPty } from 'node-pty'
import headless from '@xterm/headless'
import serializer from '@xterm/addon-serialize'
import type { TerminalId, TerminalInfo, TerminalEvent } from './terminal-types.ts'

const run = promisify(execFile)
const { Terminal } = headless
const { SerializeAddon } = serializer
/** An explicit shell selection; omitted selections use the environment after startup readiness. */
export interface TerminalShell { file: string; args: string[] }

/** One PTY and a bounded screen; disconnected clients are given time to reconnect. */
class ShellTerminal {
  readonly info: TerminalInfo
  private readonly pty: IPty
  private readonly screen = new Terminal({ cols: 80, rows: 24, scrollback: 2000, allowProposedApi: true })
  private readonly serializer = new SerializeAddon()
  private readonly listeners = new Set<(event: TerminalEvent) => void>()
  private queue = Promise.resolve()
  private readonly exited: Promise<void>
  private exitCode: number | undefined
  private disconnected: ReturnType<typeof setTimeout> | undefined
  private pendingBytes = 0
  private stopping: Promise<void> | undefined

  constructor(cwd: string, private readonly abandoned: () => void, selection?: TerminalShell) {
    const shell = selection?.file ?? (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || userInfo().shell || '/bin/sh')
    this.info = { id: randomUUID() as TerminalId, cwd, shell: basename(shell) }
    this.screen.loadAddon(this.serializer)
    this.pty = spawn(shell, selection?.args ?? (process.platform === 'win32' ? [] : ['-i']), { cwd, cols: 80, rows: 24, name: 'xterm-256color', env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
    this.pty.onData(data => {
      this.pendingBytes += data.length
      if (this.pendingBytes > 1024 * 1024) this.pty.pause()
      this.queue = this.queue.then(() => new Promise<void>(done => this.screen.write(data, () => {
        this.publish({ type: 'output', data }); this.pendingBytes -= data.length
        if (this.pendingBytes < 64 * 1024 && this.exitCode === undefined) this.pty.resume()
        done()
      })))
    })
    this.exited = new Promise(done => this.pty.onExit(({ exitCode }) => {
      this.exitCode = exitCode
      void this.queue.then(() => { this.publish({ type: 'exit', code: exitCode }); done() })
    }))
    this.expire()
  }

  private publish(event: TerminalEvent): void { for (const listener of this.listeners) listener(event) }
  private expire(): void { this.disconnected = setTimeout(this.abandoned, 20_000); this.disconnected.unref() }

  /** The queued snapshot and listener registration share the PTY's output order. */
  async subscribe(listener: (event: TerminalEvent) => void): Promise<() => void> {
    clearTimeout(this.disconnected)
    this.queue = this.queue.then(() => {
      listener({ type: 'screen', data: this.serializer.serialize(), cols: this.screen.cols, rows: this.screen.rows })
      if (this.exitCode !== undefined) listener({ type: 'exit', code: this.exitCode })
      this.listeners.add(listener)
    })
    await this.queue
    return () => { this.listeners.delete(listener); if (this.listeners.size === 0 && !this.stopping) this.expire() }
  }

  write(data: string): void {
    if (this.stopping || this.exitCode !== undefined) throw new Error('Terminal has exited')
    this.pty.write(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.queue = this.queue.then(() => {
      if (this.stopping || this.exitCode !== undefined) return
      this.screen.resize(cols, rows); this.pty.resize(cols, rows)
    })
    await this.queue
  }

  /** Capture descendants before stopping the shell, including separate foreground job groups. */
  private async stopProcess(): Promise<void> {
    if (this.exitCode !== undefined) return
    if (process.platform === 'win32') {
      await run('taskkill.exe', ['/pid', String(this.pty.pid), '/T', '/F']).catch(error => {
        if (this.exitCode === undefined) throw error
      })
    } else {
      const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid='])
      const entries = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
      const owned = new Set([this.pty.pid])
      let added = true
      while (added) {
        added = false
        for (const [pid, parent] of entries) if (pid !== undefined && parent !== undefined && owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true }
      }
      // Stop descendants first so the shell cannot orphan a foreground command.
      for (const pid of [...owned].reverse()) {
        try { process.kill(pid, 'SIGKILL') }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error }
      }
    }
    await this.exited
  }

  close(): Promise<void> {
    this.stopping ??= (async () => {
      clearTimeout(this.disconnected)
      try { await this.stopProcess(); await this.queue }
      finally { this.listeners.clear(); this.screen.dispose() }
    })()
    return this.stopping
  }
}

/** Owns every GUI terminal through tab closure, disconnected-client expiry, and Host shutdown. */
export class Terminals {
  private readonly items = new Map<TerminalId, ShellTerminal>()
  private closing = false
  constructor(private readonly shell?: TerminalShell) {}
  get size(): number { return this.items.size }

  create(cwd: string): TerminalInfo {
    if (this.closing) throw new Error('Host is stopping')
    if (this.items.size >= 16) throw new Error('Close a terminal before opening another')
    const terminal = new ShellTerminal(cwd, () => { void this.remove(terminal.info.id).catch(error => { console.error('Terminal cleanup failed:', error instanceof Error ? error.message : String(error)) }) }, this.shell)
    this.items.set(terminal.info.id, terminal)
    return terminal.info
  }

  get(id: string): ShellTerminal {
    // Only Host-minted identities can resolve to an owned PTY.
    const terminal = this.items.get(id as TerminalId)
    if (!terminal) throw new Error('Terminal is not open')
    return terminal
  }

  async remove(id: string): Promise<void> {
    const terminal = this.items.get(id as TerminalId)
    if (!terminal) return
    await terminal.close()
    this.items.delete(terminal.info.id)
  }

  async close(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled([...this.items.keys()].map(id => this.remove(id)))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Terminal shutdown failed')
  }
}
