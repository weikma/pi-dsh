/** Bounded read-only Office decoding with the distribution's independent Python. */
import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { isJsonObject } from './bridge/types.ts'
import type { BundledRuntime } from './runtime/bundled.ts'

/** Office output contains display text and escaped static HTML, never executable content. */
export type OfficePreview = { kind: 'spreadsheet'; path: string; sheets: { name: string; rows: string[][] }[]; truncated: boolean }
  | { kind: 'document'; path: string; html: string; truncated: boolean }

/** Whether a file has a supported spreadsheet or modern Office extension. */
export function supportsOfficePreview(path: string): boolean { return ['.xlsx', '.csv', '.tsv', '.docx', '.pptx'].includes(extname(path).toLowerCase()) }

function decodedPreview(value: unknown, path: string): OfficePreview {
  if (!isJsonObject(value) || typeof value.truncated !== 'boolean') throw new Error('Invalid Office preview response')
  if (value.kind === 'document' && typeof value.html === 'string') return { kind: 'document', path, html: value.html, truncated: value.truncated }
  if (value.kind === 'spreadsheet' && Array.isArray(value.sheets)) {
    const sheets = value.sheets.map(sheet => {
      if (!isJsonObject(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.rows)) throw new Error('Invalid Office sheet')
      const rows = sheet.rows.map((row): string[] => {
        if (!Array.isArray(row) || !row.every((cell): cell is string => typeof cell === 'string')) throw new Error('Invalid Office cells')
        return row
      })
      return { name: sheet.name, rows }
    })
    return { kind: 'spreadsheet', path, sheets, truncated: value.truncated }
  }
  throw new Error('Invalid Office preview response')
}

/** Own decoder processes until close, including timeout and Host shutdown. */
export class OfficePreviewer {
  private readonly pending = new Map<ChildProcess, { stop: () => void; completed: Promise<OfficePreview> }>()
  private closing = false
  constructor(private readonly runtime: BundledRuntime | undefined, private readonly script: string) {}

  /** Decode one project-confined file; reject absent runtimes, oversized output, or decoder failures. */
  async preview(path: string): Promise<OfficePreview> {
    if (this.closing) throw new Error('Office preview is stopping')
    if (!this.runtime) throw new Error('Office preview requires the bundled runtime. Run pnpm runtime:prepare for source development.')
    const child = spawn(this.runtime.auxiliary.python.executable, ['-I', '-B', this.script, path], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: this.runtime.auxiliary.python.packagesDirectory },
    })
    let failure: Error | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      if (child.exitCode !== null || child.signalCode !== null || escalation !== undefined) return
      child.kill('SIGTERM')
      escalation = setTimeout(() => { child.kill('SIGKILL') }, 1000)
      escalation.unref()
    }
    const completed = new Promise<OfficePreview>((complete, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let diagnostic = ''
      const timeout = setTimeout(() => { failure = new Error('Office preview exceeded 30 seconds'); stop() }, 30_000)
      timeout.unref()
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 8 * 1024 * 1024) { failure = new Error('Office preview exceeds the 8 MiB output limit'); stop(); return }
        chunks.push(chunk)
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-64 * 1024) })
      child.once('error', error => { failure = error })
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        if (escalation !== undefined) clearTimeout(escalation)
        if (failure) { reject(failure); return }
        if (signal || code !== 0) { reject(new Error(diagnostic.trim() || 'Office decoder stopped: ' + (signal ?? code))); return }
        try { complete(decodedPreview(JSON.parse(Buffer.concat(chunks).toString('utf8')), path)) }
        catch (error) { reject(error) }
      })
    })
    this.pending.set(child, { stop, completed })
    try { return await completed }
    finally { this.pending.delete(child) }
  }

  /** Stop active decoders and await their process and pipe teardown. */
  async close(): Promise<void> {
    this.closing = true
    const active = [...this.pending.values()]
    for (const task of active) task.stop()
    await Promise.allSettled(active.map(task => task.completed))
  }
}
