/** Resolve and install the independently versioned runtime shipped outside Electron's ASAR. */
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isJsonObject, type PiRuntime } from '../bridge/types.ts'

/** Absolute executable locations and versions of one installed distribution payload. */
export interface BundledRuntime {
  root: string
  target: string
  node: { version: string; executable: string }
  pi: { version: string; cli: string; defaultArgs: string[] }
  pnpm: { version: string; cli: string }
  auxiliary: { python: { version: string; executable: string; packagesDirectory: string }; extension: string }
}

/** Build-target name for the current process architecture. */
export function nativeRuntimeTarget(): string {
  return (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform) + '-' + process.arch
}

async function payloadPath(root: string, value: unknown, name: string, directory = false): Promise<string> {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')) throw new Error('Invalid bundled ' + name + ' path')
  const path = resolve(root, value)
  const child = relative(root, path)
  if (!child || child === '..' || child.startsWith('../') || child.startsWith('..\\')) throw new Error('Bundled ' + name + ' path escapes the payload')
  const information = await stat(path)
  if (directory ? !information.isDirectory() : !information.isFile()) throw new Error('Invalid bundled ' + name + ' resource type')
  const actual = relative(root, await realpath(path))
  if (isAbsolute(actual) || actual === '..' || actual.startsWith('../') || actual.startsWith('..\\')) throw new Error('Bundled ' + name + ' link escapes the payload')
  return path
}

function version(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value)) throw new Error('Invalid bundled ' + name + ' version')
  return value
}

/** Read a payload descriptor and reject missing components or incompatible targets. */
export async function readBundledRuntime(root: string): Promise<BundledRuntime> {
  root = await realpath(resolve(root))
  const data: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (!isJsonObject(data) || data.format !== 'pi-dsh-runtime-v1' || data.target !== nativeRuntimeTarget()
    || !isJsonObject(data.node) || !isJsonObject(data.pi) || !isJsonObject(data.pnpm)
    || !Array.isArray(data.pi.defaultArgs) || !data.pi.defaultArgs.every((arg): arg is string => typeof arg === 'string')
    || !isJsonObject(data.auxiliary) || !isJsonObject(data.auxiliary.python)) throw new Error('Bundled runtime is incomplete or does not match ' + nativeRuntimeTarget())
  return {
    root, target: data.target,
    node: { version: version(data.node.version, 'Node'), executable: await payloadPath(root, data.node.executable, 'Node') },
    pi: { version: version(data.pi.version, 'Pi'), cli: await payloadPath(root, data.pi.cli, 'Pi'), defaultArgs: data.pi.defaultArgs },
    pnpm: { version: version(data.pnpm.version, 'pnpm'), cli: await payloadPath(root, data.pnpm.cli, 'pnpm') },
    auxiliary: { python: { version: version(data.auxiliary.python.version, 'Python'), executable: await payloadPath(root, data.auxiliary.python.executable, 'Python'), packagesDirectory: await payloadPath(root, data.auxiliary.python.packagesDirectory, 'Python libraries', true) }, extension: await payloadPath(root, data.auxiliary.extension, 'Pi auxiliary extension') },
  }
}

/** Copy a complete payload offline before publishing its versioned installation. */
export async function installBundledRuntime(source: string, home: string): Promise<BundledRuntime> {
  const manifest = await readFile(join(source, 'manifest.json'), 'utf8')
  const sourceRuntime = await readBundledRuntime(source)
  const identity = createHash('sha256').update(manifest).digest('hex').slice(0, 16)
  const installations = join(home, 'runtimes')
  const destination = join(installations, 'pi-' + sourceRuntime.pi.version + '-' + sourceRuntime.target + '-' + identity)
  await mkdir(installations, { recursive: true, mode: 0o700 })
  try {
    const installed = await readFile(join(destination, '.installed.json'), 'utf8')
    if (installed !== identity + '\n') throw new Error('Managed runtime installation identity differs')
    return await readBundledRuntime(destination)
  } catch (error) {
    if (!(isJsonObject(error) && error.code === 'ENOENT')) throw error
  }
  const temporary = await mkdtemp(join(installations, '.install-'))
  try {
    await cp(source, temporary, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true })
    await readBundledRuntime(temporary)
    await writeFile(join(temporary, '.installed.json'), identity + '\n', { flag: 'wx', mode: 0o600 })
    try { await rename(temporary, destination) }
    catch (error) {
      if (!(isJsonObject(error) && ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String(error.code)))) throw error
      if (await readFile(join(destination, '.installed.json'), 'utf8') !== identity + '\n') throw error
    }
    return await readBundledRuntime(destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

/** Resolve a source-checkout or packaged payload without using the system interpreter. */
export async function availableBundledRuntime(appRoot: string, explicitRoot?: string, installationHome?: string): Promise<BundledRuntime | undefined> {
  const root = explicitRoot ?? process.env.PI_DSH_BUNDLED_RUNTIME ?? join(appRoot, '.pi-dsh-build', 'runtime', nativeRuntimeTarget())
  try { await stat(join(root, 'manifest.json')) }
  catch (error) {
    if (!explicitRoot && !process.env.PI_DSH_BUNDLED_RUNTIME && isJsonObject(error) && error.code === 'ENOENT') return undefined
    throw error
  }
  return installationHome === undefined ? readBundledRuntime(root) : installBundledRuntime(root, installationHome)
}

/** Launch the unmodified official CLI with public auxiliary-extension registration. */
export function bundledPi(runtime: BundledRuntime): PiRuntime {
  return {
    command: runtime.node.executable, args: [runtime.pi.cli, ...runtime.pi.defaultArgs, '-e', runtime.auxiliary.extension], version: runtime.pi.version,
    env: {
      PI_DSH_BUNDLED_RUNTIME: runtime.root,
      PATH: [join(runtime.root, 'bin'), dirname(runtime.node.executable), dirname(runtime.auxiliary.python.executable), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    },
  }
}
