/** Bounded Git subprocesses with joined cancellation, including foreground Git hooks. */
import { spawn, type ChildProcess } from 'node:child_process'
import { isJsonObject } from './bridge/types.ts'

export interface GitOutput { code: number; stdout: string; stderr: string }

/** Own Git commands until their processes and inherited output pipes close. */
export class GitCommands {
  private closing = false
  private readonly pending = new Map<ChildProcess, { stop(): void; completed: Promise<GitOutput> }>()

  /** Run literal arguments without a shell; timeout, output overflow and close stop the process group. */
  async run(cwd: string, args: string[]): Promise<GitOutput> {
    if (this.closing) throw new Error('Git operations are stopping')
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    // An imported shell's repository override must not redirect a selected project operation.
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) delete env[key]
    const child = spawn('git', ['--no-pager', '-c', 'color.ui=false', ...args], { cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: Error | undefined, escalation: ReturnType<typeof setTimeout> | undefined
    let termination: Promise<void> | undefined, stopping = false
    const killGroup = (signal: NodeJS.Signals): void => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) }
      catch (error) { if (!isJsonObject(error) || error.code !== 'ESRCH') failure ??= error instanceof Error ? error : new Error(String(error)) }
    }
    const stop = (): void => {
      if (stopping || !child.pid) return
      stopping = true
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        termination = new Promise(resolve => { killer.once('error', error => { failure ??= error; child.kill() }); killer.once('close', () => { resolve() }) })
      } else {
        killGroup('SIGTERM'); escalation = setTimeout(() => { killGroup('SIGKILL') }, 1500); escalation.unref()
      }
    }
    const completed = new Promise<GitOutput>((resolve, reject) => {
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      let size = 0
      const timeout = setTimeout(() => { failure = new Error('Git operation exceeded 30 seconds'); stop() }, 30_000)
      timeout.unref()
      const collect = (destination: Buffer[]) => (chunk: Buffer): void => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) { failure = new Error('Git output exceeds 2 MiB'); stop(); return }
        destination.push(chunk)
      }
      child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr))
      child.once('error', error => { failure = error })
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        if (escalation) clearTimeout(escalation)
        if (stopping && process.platform !== 'win32') killGroup('SIGKILL')
        if (failure) { reject(failure); return }
        if (stopping || signal || code === null) { reject(new Error('Git operation cancelled')); return }
        resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
      })
    })
    const joined = completed.finally(async () => { await termination })
    this.pending.set(child, { stop, completed: joined })
    try { return await joined }
    finally { this.pending.delete(child) }
  }

  /** Cancel active commands and wait for their process groups and pipes to finish. */
  async close(): Promise<void> {
    this.closing = true
    const active = [...this.pending.values()]
    for (const operation of active) operation.stop()
    await Promise.allSettled(active.map(operation => operation.completed))
  }
}
