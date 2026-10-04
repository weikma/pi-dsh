/** Verified downloads and confined archive extraction for relocatable runtime payloads. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

async function fileDigest(path, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest()
}

function integritySpec({ sha256, integrity }) {
  if (sha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Expected a SHA-256 hex digest')
    return { algorithm: 'sha256', expected: Buffer.from(sha256, 'hex') }
  }
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? '')
  if (!match) throw new Error('A pinned SHA-256 or SRI digest is required')
  return { algorithm: match[1], expected: Buffer.from(match[2], 'base64') }
}

/** Fetch an artifact once and verify its pinned bytes on every cache read. */
export async function downloadVerified({ url, sha256, integrity, cache, filename }) {
  const spec = integritySpec({ sha256, integrity })
  const label = filename ?? basename(new URL(url).pathname)
  if (!label || label !== basename(label) || label.includes('\\')) throw new Error('Artifact filename must be a single path component')
  await mkdir(cache, { recursive: true })
  const key = createHash('sha256').update(url).update(spec.expected).digest('hex').slice(0, 24)
  const cached = join(cache, `${key}-${label}`)
  try {
    const metadata = await lstat(cached)
    if (!metadata.isFile()) throw new Error('Artifact cache entry must be a regular file')
    if ((await fileDigest(cached, spec.algorithm)).equals(spec.expected)) return cached
    await unlink(cached)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = await mkdtemp(join(cache, '.download-'))
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok || !response.body) throw new Error(`Artifact download returned HTTP ${response.status}: ${url}`)
    const path = join(temporary, 'artifact')
    const hash = createHash(spec.algorithm)
    const digesting = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk) } })
    await pipeline(Readable.fromWeb(response.body), digesting, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
    if (!hash.digest().equals(spec.expected)) throw new Error(`Artifact integrity mismatch: ${url}`)
    await rename(path, cached)
    return cached
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function safePath(name, strip = 0) {
  const normalized = name.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) throw new Error(`Archive path escapes its destination: ${name}`)
  const parts = normalized.split('/').filter((part) => part && part !== '.')
  return parts.slice(strip).join('/')
}

function validateTarEntry(entry, strip) {
  const path = safePath(entry.path, strip)
  if (['CharacterDevice', 'BlockDevice', 'FIFO'].includes(entry.type)) throw new Error('Runtime archives must not contain device entries')
  if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
    const link = entry.linkpath.replaceAll('\\', '/')
    if (link.startsWith('/') || /^[A-Za-z]:/.test(link)) throw new Error(`Archive link escapes its destination: ${entry.path}`)
    const target = entry.type === 'Link' ? safePath(link, strip) : posix.normalize(posix.join(posix.dirname(path), link))
    if (target === '..' || target.startsWith('../') || target.startsWith('/')) throw new Error(`Archive link escapes its destination: ${entry.path}`)
  }
}

/** Extract gzip/plain tar or ZIP (including wheels), rejecting paths outside destination. */
export async function extractSafe({ archive, destination, strip = 0 }) {
  if (!Number.isSafeInteger(strip) || strip < 0) throw new Error('Archive strip count must be a nonnegative integer')
  await mkdir(destination, { recursive: true })
  if ((await lstat(destination)).isSymbolicLink()) throw new Error('Archive destination must not be a symbolic link')
  const file = await open(archive, 'r')
  const magic = Buffer.alloc(4)
  try { await file.read(magic, 0, magic.length, 0) }
  finally { await file.close() }
  if (magic[0] === 0x50 && magic[1] === 0x4b) {
    const { default: extractZip } = await import('extract-zip')
    const temporary = strip ? await mkdtemp(join(dirname(resolve(destination)), '.unzip-')) : undefined
    try {
      await extractZip(archive, {
        dir: resolve(temporary ?? destination),
        onEntry(entry) {
          safePath(entry.fileName)
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP runtime archives must not contain symbolic links')
        },
      })
      if (temporary) {
        let source = temporary
        for (let level = 0; level < strip; level++) {
          const children = await readdir(source, { withFileTypes: true })
          if (children.length !== 1 || !children[0].isDirectory()) throw new Error('Stripped ZIP archive must have a single directory root')
          source = join(source, children[0].name)
        }
        for (const name of await readdir(source)) await cp(join(source, name), join(destination, name), { recursive: true, dereference: false })
      }
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true })
    }
    return
  }
  const tar = await import('tar')
  let failure
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    try { validateTarEntry(entry, strip) }
    catch (error) { failure ??= error }
    entry.resume()
  } })
  if (failure) throw failure
  await tar.x({ file: archive, cwd: destination, strip, strict: true, preservePaths: false, preserveOwner: false })
}

/** Copy a file to a payload path and retain executable permissions on POSIX. */
export async function copyExecutable(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination)
  await chmod(destination, 0o755)
}

/** Write a complete manifest without exposing a partially written JSON record. */
export async function writeManifest(path, value) {
  const { writeFile } = await import('node:fs/promises')
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.manifest-${randomUUID()}.json`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}
