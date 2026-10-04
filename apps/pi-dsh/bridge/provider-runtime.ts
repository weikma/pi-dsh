/** Locate the selected official Pi's public SDK without importing it into the GUI or Electron. */
import { constants } from 'node:fs'
import { access, open, readFile, realpath, stat } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isJsonObject, type JsonValue, type PiRuntime } from './types.ts'

const PACKAGES = new Set(['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent'])
const NODE = /^node(?:\.exe)?$/i
const BUN = /^bun(?:\.exe)?$/i

/** Selected SDK and independent interpreter for the provider worker; arguments remain stdin data. */
export interface ProviderRuntime {
  command: string
  sdkEntry: string
  cliArgs: string[]
  env: NodeJS.ProcessEnv
  agentDir?: string
}

/** Unsupported selections retain the official terminal configuration route. */
export class ProviderRuntimeUnsupportedError extends Error {
  readonly code = 'provider-runtime/unsupported'
  constructor(message: string) { super(message); this.name = 'ProviderRuntimeUnsupportedError' }
}

function unsupported(message: string): never { throw new ProviderRuntimeUnsupportedError(message) }

async function executable(path: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(path)
    if (!(await stat(resolved)).isFile()) return undefined
    await access(resolved, constants.X_OK)
    return resolved
  } catch (error) {
    void error /* A missing or inaccessible candidate cannot launch the independent worker. */
    return undefined
  }
}

async function findExecutable(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (isAbsolute(command)) return executable(command)
  if (command.includes('/') || command.includes('\\')) return undefined
  const path = process.platform === 'win32'
    ? env[Object.keys(env).sort().find(name => name.toUpperCase() === 'PATH') ?? 'PATH']
    : env.PATH
  for (const directory of (path ?? '').split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    for (const suffix of process.platform === 'win32' && !command.toLowerCase().endsWith('.exe') ? ['', '.exe'] : ['']) {
      const candidate = await executable(join(directory, command + suffix))
      if (candidate !== undefined) return candidate
    }
  }
  return undefined
}

function importTarget(value: JsonValue | undefined, depth = 0): string | undefined {
  if (typeof value === 'string') return value
  if (!isJsonObject(value) || depth > 10) return undefined
  for (const [condition, target] of Object.entries(value)) {
    if (!['node', 'import', 'default'].includes(condition)) continue
    const result = importTarget(target, depth + 1)
    if (result !== undefined) return result
  }
  return undefined
}

async function publicSdk(cli: string): Promise<string> {
  if (!/\.(?:mjs|cjs|js)$/i.test(cli)) unsupported('The selected official Pi CLI is not a supported JavaScript entry.')
  let root = dirname(cli)
  for (;;) {
    let metadata: JsonValue
    try {
      const metadataPath = await realpath(join(root, 'package.json'))
      if (dirname(metadataPath) !== root) unsupported('The selected Pi package metadata is outside its package directory.')
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    }
    catch (error) {
      if (isJsonObject(error) && error.code === 'ENOENT') {
        const parent = dirname(root)
        if (parent === root) unsupported('The selected Pi CLI has no resolvable official package. Use its terminal configuration route.')
        root = parent; continue
      }
      if (error instanceof ProviderRuntimeUnsupportedError) throw error
      unsupported('The selected Pi package metadata is invalid or inaccessible.')
    }
    if (!isJsonObject(metadata) || typeof metadata.name !== 'string' || !PACKAGES.has(metadata.name)) {
      unsupported('The selected CLI does not belong to a supported official Pi package.')
    }
    const bin = typeof metadata.bin === 'string' ? metadata.bin : isJsonObject(metadata.bin) ? metadata.bin.pi : undefined
    if (typeof bin !== 'string' || isAbsolute(bin)) unsupported('The selected Pi package does not declare its CLI entry.')
    let declaredCli: string
    try { declaredCli = await realpath(join(root, bin)) }
    catch (error) { void error; unsupported('The selected Pi package CLI entry is unavailable.') }
    if (declaredCli !== cli) unsupported('The selected script is not the official package CLI entry.')
    const exports = metadata.exports
    const target = exports === undefined ? metadata.main : importTarget(isJsonObject(exports) && '.' in exports ? exports['.'] : exports)
    if (typeof target !== 'string' || isAbsolute(target) || target.split(/[\\/]/).includes('..') || (exports !== undefined && !target.startsWith('./'))) {
      unsupported('The selected Pi package does not expose a supported public SDK entry.')
    }
    let sdk: string
    try { sdk = await realpath(join(root, target)) }
    catch (error) { void error; unsupported('The selected Pi public SDK entry is unavailable.') }
    const inside = relative(root, sdk)
    if (inside === '..' || inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(inside)
      || !/\.(?:mjs|cjs|js)$/i.test(sdk) || !(await stat(sdk)).isFile()) {
      unsupported('The selected Pi public SDK entry is outside its package or cannot run in independent Node.')
    }
    return pathToFileURL(sdk).href
  }
}

async function isIndependentNode(command: string): Promise<boolean> {
  if (!NODE.test(basename(command))) return false
  return process.versions.electron === undefined || command !== await realpath(process.execPath)
}

/**
 * Resolve only the selected official CLI's public package export and an independent Node interpreter.
 * @param runtime - Selection used by the Pi RPC process; secrets in args/env stay in returned stdin data.
 * @param bundledNode - Optional independent interpreter fallback, never a source of SDK implementation.
 * @returns Worker launch metadata with the same effective RPC environment and preserved Pi CLI options.
 * @throws ProviderRuntimeUnsupportedError for wrappers, compiled CLIs, missing exports or unavailable interpreters.
 */
export async function resolveProviderRuntime(runtime: PiRuntime, bundledNode?: string): Promise<ProviderRuntime> {
  try { return await resolveRuntime(runtime, bundledNode) }
  catch (error) {
    if (error instanceof ProviderRuntimeUnsupportedError) throw error
    unsupported('The selected Pi package or independent Node interpreter is unavailable. Use its terminal configuration route.')
  }
}

async function resolveRuntime(runtime: PiRuntime, bundledNode?: string): Promise<ProviderRuntime> {
  const env = { ...process.env, ...runtime.env, ...(runtime.agentDir ? { PI_CODING_AGENT_DIR: runtime.agentDir } : {}) }
  const selected = await findExecutable(runtime.command, env)
  if (selected === undefined) unsupported('The selected Pi executable cannot be resolved. Use its terminal configuration route.')
  let cli: string
  let cliArgs: string[]
  let preferredNode: string | undefined
  if (NODE.test(basename(selected)) || BUN.test(basename(selected))) {
    const entry = runtime.args[0]
    if (entry === undefined || !isAbsolute(entry)) unsupported('Use an absolute official Pi CLI entry immediately after Node or Bun; interpreter flags are unsupported.')
    try { cli = await realpath(entry) }
    catch (error) { void error; unsupported('The selected Pi CLI entry is unavailable.') }
    if (!(await stat(cli)).isFile()) unsupported('The selected Pi CLI entry is not a file.')
    cliArgs = runtime.args.slice(1)
    if (await isIndependentNode(selected)) preferredNode = selected
  } else {
    const file = await open(selected, 'r')
    let first: string
    try { const bytes = Buffer.alloc(256); const result = await file.read(bytes); first = bytes.subarray(0, result.bytesRead).toString('utf8').split(/\r?\n/, 1)[0]! }
    finally { await file.close() }
    if (!/^#!\s*\/usr\/bin\/env\s+(?:-S\s+)?node\s*$/.test(first)) unsupported('This Pi wrapper or compiled executable has no supported Node script entry. Use its terminal configuration route.')
    cli = selected; cliArgs = [...runtime.args]
  }
  const sdkEntry = await publicSdk(cli)
  let command = preferredNode
  if (command === undefined) {
    const candidate = await findExecutable('node', env)
    if (candidate !== undefined && await isIndependentNode(candidate)) command = candidate
  }
  if (command === undefined && bundledNode !== undefined) {
    const candidate = await executable(bundledNode)
    if (candidate !== undefined && await isIndependentNode(candidate)) command = candidate
  }
  if (command === undefined && process.versions.electron === undefined) {
    const candidate = await executable(process.execPath)
    if (candidate !== undefined && await isIndependentNode(candidate)) command = candidate
  }
  if (command === undefined) unsupported('No independent Node interpreter is available for the selected Pi SDK.')
  return { command, sdkEntry, cliArgs, env, ...(runtime.agentDir === undefined ? {} : { agentDir: runtime.agentDir }) }
}
