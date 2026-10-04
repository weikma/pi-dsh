/** Hash-locked Python and Office resources, independent of the official Pi agent. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { downloadVerified, extractSafe } from './bundle-layout.mjs'

const sourceRoot = dirname(fileURLToPath(import.meta.url))
const digestOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const distributionName = name => name.toLowerCase().replace(/[-_.]+/gu, '-')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Validate pinned wheel names, versions, targets and content hashes before preparation. */
export function validateAuxiliaryLock(value) {
  if (!record(value) || value.format !== 'pi-dsh-auxiliary-lock-v1'
    || !/^\d+\.\d+\.\d+$/u.test(value.pythonVersion ?? '') || !/^\d{8}$/u.test(value.pythonRelease ?? '')
    || !record(value.targets) || !record(value.pythonPackages) || !Array.isArray(value.wheels)) throw new Error('Invalid auxiliary runtime lock')
  const distributions = new Map(Object.entries(value.pythonPackages).map(([name, version]) => [distributionName(name), version]))
  if (distributions.size !== Object.keys(value.pythonPackages).length || distributions.size === 0
    || [...distributions.values()].some(version => typeof version !== 'string' || !version)) throw new Error('Invalid auxiliary Python distributions')
  const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64', 'linux-arm64']
  if (Object.keys(value.targets).sort().join(',') !== targets.sort().join(',')) throw new Error('Auxiliary lock must contain each supported target')
  for (const [target, artifact] of Object.entries(value.targets)) {
    if (!record(artifact) || typeof artifact.pythonTarget !== 'string' || !/^[a-z0-9_-]+$/u.test(artifact.pythonTarget)
      || !/^[a-f0-9]{64}$/u.test(artifact.pythonSha256 ?? '') || !Array.isArray(artifact.wheels)) throw new Error(`Invalid auxiliary target ${target}`)
    const selected = new Map()
    for (const wheel of [...artifact.wheels, ...value.wheels]) {
      if (!record(wheel) || typeof wheel.url !== 'string' || !/^[a-f0-9]{64}$/u.test(wheel.sha256 ?? '')) throw new Error(`Invalid Python wheel in ${target}`)
      const url = new URL(wheel.url)
      if (url.protocol !== 'https:' || url.hostname !== 'files.pythonhosted.org') throw new Error(`Unrecognized Python wheel source in ${target}`)
      const filename = decodeURIComponent(url.pathname.split('/').at(-1))
      const parts = filename.split('-')
      const name = distributionName(parts[0])
      if (!filename.endsWith('.whl') || parts.length < 5 || selected.has(name) || distributions.get(name) !== parts[1]) throw new Error(`Python wheel version differs from the distribution lock: ${filename}`)
      selected.set(name, parts[1])
    }
    if (selected.size !== distributions.size || [...distributions.keys()].some(name => !selected.has(name))) throw new Error(`Incomplete Python wheel set for ${target}`)
  }
  return value
}

async function rejectUnsupportedWheelSchemes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.data')) continue
    const schemes = await readdir(join(directory, entry.name))
    if (schemes.some(scheme => scheme !== 'scripts')) throw new Error(`Unsupported Python wheel installation scheme: ${entry.name}`)
  }
}

/** Prepare relocatable interpreters and resources; return paths relative to the runtime root. */
export async function prepareAuxiliary({ target, output, cache }) {
  const lock = validateAuxiliaryLock(JSON.parse(await readFile(join(sourceRoot, 'auxiliary-lock.json'), 'utf8')))
  const artifact = lock.targets[target]
  if (!artifact) throw new Error(`Unsupported auxiliary target ${target}`)
  const root = resolve(output)
  const windows = target === 'win-x64'
  const python = {
    version: lock.pythonVersion,
    executable: windows ? 'python/python.exe' : 'python/bin/python3',
    packagesDirectory: windows ? 'python/Lib/site-packages' : `python/lib/python${lock.pythonVersion.split('.').slice(0, 2).join('.')}/site-packages`,
    archiveSha256: artifact.pythonSha256,
    distributions: lock.pythonPackages,
  }
  const office = { skillsDirectory: 'office/skills', checker: 'office/scripts/check_office.py' }
  const extension = 'pi/pi-dsh-runtime.ts'
  const sourceFiles = [join(sourceRoot, 'pi-auxiliary.ts')]
  const collect = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile()) sourceFiles.push(path)
    }
  }
  await collect(join(sourceRoot, 'office-assets'))
  sourceFiles.sort()
  const resourcesDigest = digestOf(await Promise.all(sourceFiles.map(async path => [path.slice(sourceRoot.length + 1), createHash('sha256').update(await readFile(path)).digest('hex')])))
  const auxiliary = { format: 'pi-dsh-auxiliary-v1', python, office, extension, payloadDigest: digestOf({ format: 1, target, artifact, wheels: lock.wheels, pythonPackages: lock.pythonPackages, resourcesDigest }) }
  const existing = join(root, '.auxiliary-prepared.json')
  try {
    const previous = JSON.parse(await readFile(existing, 'utf8'))
    if (previous.payloadDigest === auxiliary.payloadDigest
      && (await stat(join(root, python.executable))).isFile()
      && (await stat(join(root, python.packagesDirectory))).isDirectory()
      && (await stat(join(root, office.checker))).isFile()
      && (await stat(join(root, extension))).isFile()) return auxiliary
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, '.auxiliary-'))
  try {
    const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
    const archive = await downloadVerified({ url: `https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, sha256: artifact.pythonSha256, cache, filename })
    await extractSafe({ archive, destination: stage })
    const packages = join(stage, python.packagesDirectory)
    await mkdir(packages, { recursive: true })
    for (const wheel of [...artifact.wheels, ...lock.wheels]) {
      const archive = await downloadVerified({ url: wheel.url, sha256: wheel.sha256, cache, filename: new URL(wheel.url).pathname.split('/').at(-1) })
      await extractSafe({ archive, destination: packages })
    }
    await rejectUnsupportedWheelSchemes(packages)
    await stat(join(stage, python.executable))
    await cp(join(sourceRoot, 'office-assets'), join(stage, 'office'), { recursive: true })
    for (const directory of ['python', 'office']) {
      await rm(join(root, directory), { recursive: true, force: true })
      await rename(join(stage, directory), join(root, directory))
    }
    await mkdir(join(root, 'pi'), { recursive: true })
    await cp(join(sourceRoot, 'pi-auxiliary.ts'), join(root, extension))
    await writeFile(existing, JSON.stringify(auxiliary, null, 2) + '\n')
    return auxiliary
  } finally { await rm(stage, { recursive: true, force: true }) }
}

/** Verify native Python, locked libraries and Office creation after the complete payload is assembled. */
export async function smokeAuxiliary(root, auxiliary) {
  const run = promisify(execFile)
  const python = join(root, auxiliary.python.executable)
  const script = `import importlib.metadata, json, sys
expected = json.loads(sys.argv[1])
actual = {name: importlib.metadata.version(name) for name in expected}
assert actual == expected, (actual, expected)
import numpy, pandas, docx, pptx, openpyxl, PIL, lxml, xlsxwriter
assert numpy.arange(4).sum() == 6
assert pandas.DataFrame({'n':[1,2]}).n.sum() == 3
assert sys.version.split()[0] == sys.argv[2]
print(json.dumps({'python': sys.version.split()[0], 'distributions': actual}))`
  const { stdout } = await run(python, ['-I', '-B', '-c', script, JSON.stringify(auxiliary.python.distributions), auxiliary.python.version], { timeout: 120_000, maxBuffer: 1024 * 1024 })
  await run(python, ['-I', '-B', '-m', 'pip', 'check'], { timeout: 120_000, maxBuffer: 1024 * 1024 })
  const workspace = await mkdtemp(join(tmpdir(), 'pi-auxiliary-smoke-'))
  try {
    const create = `from pathlib import Path
from docx import Document
from pptx import Presentation
from openpyxl import Workbook, load_workbook
root = Path(__import__('sys').argv[1])
document = Document()
document.add_paragraph('Bundled Office runtime verified')
document.save(root / 'report.docx')
deck = Presentation()
slide = deck.slides.add_slide(deck.slide_layouts[6])
slide.shapes.add_textbox(0, 0, 1000000, 1000000).text = 'Bundled Office runtime verified'
deck.save(root / 'report.pptx')
workbook = Workbook()
workbook.active.title = 'Summary'
workbook.active.append(['Bundled Office runtime verified', 7])
workbook.save(root / 'report.xlsx')
assert load_workbook(root / 'report.xlsx').active['B1'].value == 7
assert Document(root / 'report.docx').paragraphs[0].text == 'Bundled Office runtime verified'
assert len(Presentation(root / 'report.pptx').slides) == 1`
    await run(python, ['-I', '-B', '-c', create, workspace], { timeout: 120_000, maxBuffer: 1024 * 1024 })
    for (const name of ['report.docx', 'report.pptx', 'report.xlsx']) {
      await run(python, ['-I', '-B', join(root, auxiliary.office.checker), join(workspace, name), '--contains', 'Bundled Office runtime verified'], { timeout: 120_000, maxBuffer: 1024 * 1024 })
    }
  } finally { await rm(workspace, { recursive: true, force: true }) }
  return JSON.parse(stdout)
}
