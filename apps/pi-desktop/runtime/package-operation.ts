/** Joined, cancellable process group for native Pi package operations. Package code never loads in the GUI. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isJsonObject, type JsonObject } from '../bridge/types.ts'

export async function runPackageOperation(context: { sdkEntry: string; cwd: string; agentDir: string }, action: JsonObject, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Pi package operation cancelled')
  const worker = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './package-worker.ts' : './package-worker.mjs', import.meta.url))
  const child = spawn(process.execPath, [...(worker.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), worker], {
    cwd: context.cwd, env: process.env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
  })
  let result = '', failure: Error | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let termination: Promise<void> | undefined
  let stopping = false
  const stop = () => {
    const pid = child.pid
    if (!pid || stopping) return
    stopping = true
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      termination = new Promise<void>(resolve => {
        killer.on('error', error => { failure ??= error; child.kill() })
        killer.once('close', () => { resolve() })
      })
      return
    }
    const kill = (kind: NodeJS.Signals) => { try { process.kill(-pid, kind) } catch (error) { if (!isJsonObject(error) || error.code !== 'ESRCH') failure ??= error instanceof Error ? error : new Error(String(error)) } }
    kill('SIGTERM'); timer = setTimeout(() => { kill('SIGKILL') }, 1500)
  }
  const output = child.stdio[3]
  if (output && 'on' in output) output.on('data', (chunk: Buffer) => { result += String(chunk); if (result.length > 64 * 1024) { failure = new Error('Pi package result exceeds 64 KiB'); stop() } })
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', error => { failure = error })
    child.once('close', code => {
      if (stopping && process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (!isJsonObject(error) || error.code !== 'ESRCH') failure ??= error instanceof Error ? error : new Error(String(error)) }
      }
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      if (signal.aborted) { reject(new Error('Pi package operation cancelled')); return }
      if (failure) { reject(failure); return }
      let value: unknown
      try { value = JSON.parse(result) } catch { reject(new Error('Pi package operation ended without a result')); return }
      if (!isJsonObject(value) || code !== 0 || value.success !== true) { reject(new Error(isJsonObject(value) && typeof value.error === 'string' ? value.error : 'Pi package operation failed')); return }
      resolve()
    })
  })
  signal.addEventListener('abort', stop, { once: true })
  child.stdin?.on('error', error => { failure = error; stop() })
  child.stdin?.end(JSON.stringify({ ...context, action }))
  if (signal.aborted) stop()
  try { await closed } finally { await termination }
}
