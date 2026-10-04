/** Assemble pinned official executables outside Electron ASAR and GUI dependencies. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { copyExecutable, downloadVerified, extractSafe, writeManifest } from './bundle-layout.mjs'
import { prepareAuxiliary } from './prepare-auxiliary.mjs'

const sourceRoot = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64', 'linux-arm64']
const digest = value => createHash('sha256').update(value).digest('hex')
const payloadRevision = 2

/** Validate exact package versions, official artifact URLs and complete target hashes. */
export function validateBundleLock(value) {
  if (!record(value) || value.format !== 'pi-dsh-bundle-lock-v1'
    || !/^\d+\.\d+\.\d+$/u.test(value.nodeVersion ?? '') || !record(value.targets)
    || Object.keys(value.targets).sort().join(',') !== [...targets].sort().join(',')) throw new Error('Invalid bundled runtime lock')
  for (const name of ['pi', 'pnpm']) {
    const item = value[name]
    if (!record(item) || !/^\d+\.\d+\.\d+$/u.test(item.version ?? '')
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(item.integrity ?? '')) throw new Error(`Invalid ${name} runtime lock`)
    const url = new URL(item.url)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error(`Unrecognized ${name} package source`)
  }
  if (value.pi.package !== '@earendil-works/pi-coding-agent') throw new Error('The bundled Pi package must be the official coding agent')
  if (!/^[a-f0-9]{40}$/u.test(value.pi.gitHead ?? '') || !record(value.pi.license)
    || value.pi.license.url !== `https://raw.githubusercontent.com/earendil-works/pi/${value.pi.gitHead}/LICENSE`
    || !/^[a-f0-9]{64}$/u.test(value.pi.license.sha256 ?? '')) throw new Error('The bundled Pi license must be pinned to the official release revision')
  for (const [target, item] of Object.entries(value.targets)) {
    if (!record(item) || !['darwin', 'win32', 'linux'].includes(item.os) || !['x64', 'arm64'].includes(item.cpu)) throw new Error(`Invalid runtime target ${target}`)
    for (const name of ['node', 'ripgrep', 'fd']) {
      if (typeof item[`${name}Archive`] !== 'string' || !/^[A-Za-z0-9_.-]+$/u.test(item[`${name}Archive`])
        || !/^[a-f0-9]{64}$/u.test(item[`${name}Sha256`] ?? '')) throw new Error(`Missing ${name} artifact pin for ${target}`)
    }
  }
  return value
}

function allowed(values, actual) {
  if (!values || values.length === 0) return true
  if (values.includes(`!${actual}`)) return false
  const positive = values.filter(value => !value.startsWith('!'))
  return positive.length === 0 || positive.includes(actual)
}

/** Match npm lock metadata to the target, including negative OS/CPU constraints. */
export function packageMatchesTarget(packageInfo, target) {
  return allowed(packageInfo.os, target.os) && allowed(packageInfo.cpu, target.cpu)
    && allowed(packageInfo.libc, target.libc)
}

/** Earlier payload descriptors are rebuilt before resolving newly required file paths. */
export function canReusePreparedPayload(value, mainDigest) {
  if (!record(value) || value.format !== 'pi-dsh-runtime-v1' || value.payloadRevision !== payloadRevision || value.mainDigest !== mainDigest) return false
  const paths = [value.node?.executable, value.pi?.cli, value.pi?.lockfile, value.pi?.licenseFile,
    value.pnpm?.cli, value.pnpm?.packageRoot, value.tools?.ripgrep?.executable, value.tools?.fd?.executable]
  return paths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/')
    && !path.includes('\\') && !path.split('/').includes('..'))
}

function validateProductionLock(lock, bundle) {
  if (!record(lock) || lock.lockfileVersion !== 3 || !record(lock.packages)
    || lock.packages['']?.dependencies?.[bundle.pi.package] !== bundle.pi.version) throw new Error('Pi production lock differs from the selected version')
  const pi = lock.packages[`node_modules/${bundle.pi.package}`]
  if (pi?.integrity !== bundle.pi.integrity || pi?.resolved !== bundle.pi.url) throw new Error('Pi production lock differs from the official artifact pin')
  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path) continue
    if (!path.startsWith('node_modules/') || path.includes('..') || path.includes('\\')
      || !record(info) || typeof info.integrity !== 'string') throw new Error(`Invalid production lock package: ${path}`)
    const url = new URL(info.resolved)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error(`Unrecognized production package source: ${path}`)
  }
}

/** Remove foreign optional binaries; require every applicable locked production package. */
export async function pruneOptionalDependencies(directory, productionLock, target) {
  const removed = []
  for (const [path, info] of Object.entries(productionLock.packages)) {
    if (!path) continue
    const absolute = join(directory, path)
    if (!packageMatchesTarget(info, target)) {
      if (!info.optional) throw new Error(`Required package does not support the target: ${path}`)
      await rm(absolute, { recursive: true, force: true })
      removed.push(path)
      continue
    }
    const installed = JSON.parse(await readFile(join(absolute, 'package.json'), 'utf8'))
    if (installed.version !== info.version) throw new Error(`Installed package version differs from the lock: ${path}`)
  }
  return removed
}

async function binaryEntry(directory, name) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isFile() && item.name === name) return path
    if (item.isDirectory()) {
      const found = await binaryEntry(path, name)
      if (found) return found
    }
  }
}

function cliPath(value) {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) throw new Error('Package CLI must have a relative path')
  return value
}

async function wrappers(root, manifest) {
  const windows = manifest.target === 'win-x64'
  await mkdir(join(root, 'bin'), { recursive: true })
  for (const name of ['pi', 'pnpm']) {
    const relativeCli = manifest[name].cli.replaceAll('/', windows ? '\\' : '/')
    if (windows) {
      await writeFile(join(root, 'bin', `${name}.cmd`), `@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\${relativeCli}" %*\r\n`)
    } else {
      await writeFile(join(root, 'bin', name), `#!/bin/sh\nRUNTIME_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec "$RUNTIME_ROOT/${manifest.node.executable}" "$RUNTIME_ROOT/${relativeCli}" "$@"\n`)
      await chmod(join(root, 'bin', name), 0o755)
    }
  }
  if (!windows) await symlink('../node/bin/node', join(root, 'bin', 'node'))
}

async function validatePayload(root, manifest, productionLock, target) {
  for (const path of [manifest.node.executable, manifest.pi.cli, manifest.pnpm.cli, manifest.tools.ripgrep.executable, manifest.tools.fd.executable,
    'node/LICENSE', `${manifest.pnpm.packageRoot}/LICENSE`, manifest.pi.licenseFile]) {
    if (!(await stat(join(root, path))).isFile()) throw new Error(`Missing bundled runtime file: ${path}`)
  }
  const installedLock = JSON.parse(await readFile(join(root, manifest.pi.lockfile), 'utf8'))
  if (digest(JSON.stringify(installedLock)) !== digest(JSON.stringify(productionLock))) throw new Error('The prepared Pi production lock was modified')
  await pruneOptionalDependencies(join(root, 'pi'), productionLock, target)
  const native = Object.keys(productionLock.packages).find(path => path.endsWith(`/node_modules/@esbuild/${target.os}-${target.cpu}`))
  if (!native) throw new Error('The production lock has no target esbuild package')
  const binary = target.os === 'win32' ? 'esbuild.exe' : 'bin/esbuild'
  if (!(await stat(join(root, 'pi', native, binary))).isFile()) throw new Error('Missing target esbuild executable')
}

/** Prepare a target payload; never execute a binary compiled for another target. */
export async function prepareRuntime({ target, output, cache = join(homedir(), '.cache', 'pi-dsh-runtime') }) {
  const lockText = await readFile(join(sourceRoot, 'bundle-lock.json'), 'utf8')
  const productionText = await readFile(join(sourceRoot, 'pi-production-lock.json'), 'utf8')
  const lock = validateBundleLock(JSON.parse(lockText))
  const artifact = lock.targets[target]
  if (!artifact) throw new Error(`Unsupported bundled runtime target: ${target}`)
  if (typeof output !== 'string' || !output.trim()) throw new Error('A runtime output directory is required')
  const production = JSON.parse(productionText)
  validateProductionLock(production, lock)
  const mainDigest = digest(JSON.stringify({ format: 1, payloadRevision, target, lock, production }))
  const root = resolve(output)
  cache = resolve(cache)
  let previous
  try { previous = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous && previous.format !== 'pi-dsh-runtime-v1') throw new Error('The output directory belongs to another runtime format')
  if (canReusePreparedPayload(previous, mainDigest)) {
    await validatePayload(root, previous, production, artifact)
    previous.auxiliary = await prepareAuxiliary({ target, output: root, cache })
    await writeManifest(join(root, 'manifest.json'), previous)
    return previous
  }
  try {
    const entries = await readdir(root)
    if (entries.length > 0 && !previous) throw new Error('Runtime output must be empty or contain a Pi DSH runtime manifest')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(dirname(root), { recursive: true })
  const stage = await mkdtemp(join(dirname(root), '.pi-runtime-stage-'))
  try {
    const [nodeArchive, pnpmArchive, piLicense] = await Promise.all([
      downloadVerified({ url: `https://nodejs.org/download/release/v${lock.nodeVersion}/${artifact.nodeArchive}`, sha256: artifact.nodeSha256, cache }),
      downloadVerified({ url: lock.pnpm.url, integrity: lock.pnpm.integrity, cache }),
      downloadVerified({ url: lock.pi.license.url, sha256: lock.pi.license.sha256, cache, filename: 'Pi-LICENSE' }),
    ])
    await mkdir(join(stage, 'licenses/pi'), { recursive: true })
    await cp(piLicense, join(stage, 'licenses/pi/LICENSE'))
    await extractSafe({ archive: nodeArchive, destination: join(stage, 'node'), strip: 1 })
    const windows = artifact.os === 'win32'
    const nodeExecutable = windows ? 'node/node.exe' : 'node/bin/node'
    const npmCli = join(stage, 'node', windows ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js')
    await mkdir(join(stage, 'node', 'node_modules'), { recursive: true })
    await mkdir(join(stage, 'pi'), { recursive: true })
    await writeFile(join(stage, 'pi', 'package.json'), JSON.stringify({ name: production.name, private: true, dependencies: production.packages[''].dependencies }, null, 2) + '\n')
    await writeFile(join(stage, 'pi', 'package-lock.json'), productionText)
    await writeFile(join(stage, 'npmrc-user'), '')
    await writeFile(join(stage, 'npmrc-global'), '')
    const args = [npmCli, 'ci', '--ignore-scripts', '--omit=dev', '--include=optional', '--no-audit', '--no-fund',
      '--registry=https://registry.npmjs.org', `--cache=${join(cache, 'npm')}`, `--os=${artifact.os}`, `--cpu=${artifact.cpu}`,
      `--userconfig=${join(stage, 'npmrc-user')}`, `--globalconfig=${join(stage, 'npmrc-global')}`]
    if (artifact.libc) args.push(`--libc=${artifact.libc}`)
    // npm is JavaScript; the host Node runs it even when the payload Node targets another OS.
    await run(process.execPath, args, { cwd: join(stage, 'pi'), timeout: 300_000, maxBuffer: 8 * 1024 * 1024 })
    await rm(join(stage, 'npmrc-user'))
    await rm(join(stage, 'npmrc-global'))
    const removedOptionalPackages = await pruneOptionalDependencies(join(stage, 'pi'), production, artifact)
    await extractSafe({ archive: pnpmArchive, destination: join(stage, 'pnpm/node_modules/pnpm'), strip: 1 })
    const piPackageRoot = `pi/node_modules/${lock.pi.package}`
    const piInfo = JSON.parse(await readFile(join(stage, piPackageRoot, 'package.json'), 'utf8'))
    const pnpmInfo = JSON.parse(await readFile(join(stage, 'pnpm/node_modules/pnpm/package.json'), 'utf8'))
    if (piInfo.version !== lock.pi.version || pnpmInfo.version !== lock.pnpm.version) throw new Error('A bundled package version differs from its artifact pin')
    const tools = {}
    for (const [name, field, urlRoot] of [
      ['ripgrep', 'ripgrep', `https://github.com/BurntSushi/ripgrep/releases/download/${lock.ripgrepVersion}`],
      ['fd', 'fd', `https://github.com/sharkdp/fd/releases/download/v${lock.fdVersion}`],
    ]) {
      const archive = await downloadVerified({ url: `${urlRoot}/${artifact[`${field}Archive`]}`, sha256: artifact[`${field}Sha256`], cache })
      const directory = join(stage, 'dependencies', name)
      await extractSafe({ archive, destination: directory, strip: 1 })
      const filename = `${name === 'ripgrep' ? 'rg' : 'fd'}${windows ? '.exe' : ''}`
      const source = await binaryEntry(directory, filename)
      if (!source) throw new Error(`Missing ${name} executable in the official archive`)
      await copyExecutable(source, join(stage, 'bin', filename))
      tools[name] = { version: lock[`${field}Version`], executable: `bin/${filename}`, archiveSha256: artifact[`${field}Sha256`], resourcesDirectory: `dependencies/${name}` }
    }
    const manifest = {
      format: 'pi-dsh-runtime-v1', payloadRevision, target, mainDigest,
      node: { version: lock.nodeVersion, executable: nodeExecutable, archiveSha256: artifact.nodeSha256 },
      pi: { package: lock.pi.package, version: lock.pi.version, packageRoot: piPackageRoot, cli: `${piPackageRoot}/${cliPath(piInfo.bin.pi)}`,
        lockfile: 'pi/package-lock.json', integrity: lock.pi.integrity, gitHead: lock.pi.gitHead,
        licenseFile: 'licenses/pi/LICENSE', licenseSha256: lock.pi.license.sha256,
        defaultArgs: windows ? ['--tools', 'read,write,edit,powershell'] : [] },
      pnpm: { version: lock.pnpm.version, packageRoot: 'pnpm/node_modules/pnpm', cli: `pnpm/node_modules/pnpm/${cliPath(pnpmInfo.bin.pnpm)}`, integrity: lock.pnpm.integrity },
      tools, pathDirectories: ['bin', windows ? 'node' : 'node/bin'], removedOptionalPackages,
      shellRequirements: windows ? ['Windows PowerShell (included with supported Windows)'] : ['/bin/bash or /bin/sh'],
    }
    await wrappers(stage, manifest)
    manifest.auxiliary = await prepareAuxiliary({ target, output: stage, cache })
    await validatePayload(stage, manifest, production, artifact)
    await writeManifest(join(stage, 'manifest.json'), manifest)
    await rm(root, { recursive: true, force: true })
    await rename(stage, root)
    return manifest
  } finally { await rm(stage, { recursive: true, force: true }) }
}

/** Execute native bundled version and optional-binary checks after preparation. */
export async function smokeRuntime(root, manifest) {
  const lock = validateBundleLock(JSON.parse(await readFile(join(sourceRoot, 'bundle-lock.json'), 'utf8')))
  const target = lock.targets[manifest.target]
  if (!target || process.platform !== target.os || process.arch !== target.cpu) throw new Error('Runtime execution checks require the native target')
  const node = join(root, manifest.node.executable)
  const env = { ...process.env, PATH: [join(root, 'bin'), join(root, dirname(manifest.node.executable)), process.env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') }
  const versions = {}
  for (const [name, command, args] of [
    ['node', node, ['--version']], ['pi', node, [join(root, manifest.pi.cli), '--version']],
    ['pnpm', node, [join(root, manifest.pnpm.cli), '--version']],
    ['ripgrep', join(root, manifest.tools.ripgrep.executable), ['--version']],
    ['fd', join(root, manifest.tools.fd.executable), ['--version']],
  ]) {
    const { stdout } = await run(command, args, { env, timeout: 60_000, maxBuffer: 1024 * 1024 })
    const version = stdout.trim().split('\n')[0].replace(/^(v|ripgrep |fd )/u, '').split(' ')[0]
    const expected = name === 'node' ? manifest.node.version : name === 'pi' ? manifest.pi.version : name === 'pnpm' ? manifest.pnpm.version : manifest.tools[name].version
    if (version !== expected) throw new Error(`Bundled ${name} reported an unexpected version: ${version}`)
    versions[name] = version
  }
  const esbuild = join(root, manifest.pi.packageRoot, 'node_modules/esbuild')
  await run(node, ['-e', 'require(process.argv[1]).transformSync("const n: number = 1", {loader:"ts"})', esbuild], { env, timeout: 60_000 })
  return versions
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    if (!['--target', '--output', '--cache'].includes(key) || !process.argv[index + 1]) throw new Error('Usage: prepare-runtime.mjs --target <target> --output <directory> [--cache <directory>]')
    options[key.slice(2)] = process.argv[index + 1]
  }
  const manifest = await prepareRuntime(options)
  console.log(JSON.stringify({ output: resolve(options.output), manifest }, null, 2))
}
