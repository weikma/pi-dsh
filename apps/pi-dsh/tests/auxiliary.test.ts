/** Python payload inputs remain complete and match each platform's locked wheels. */
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateAuxiliaryLock } from '../runtime/prepare-auxiliary.mjs'

interface Lock {
  format: string
  pythonVersion: string
  pythonRelease: string
  targets: Record<string, { pythonTarget: string; pythonSha256: string; wheels: { url: string; sha256: string }[] }>
  wheels: { url: string; sha256: string }[]
  pythonPackages: Record<string, string>
}

async function selectedLock(): Promise<Lock> {
  return JSON.parse(await readFile(new URL('../runtime/auxiliary-lock.json', import.meta.url), 'utf8')) as Lock
}

it('pins complete Office and data libraries for all five Desktop runtime targets', async () => {
  const lock = await selectedLock()
  assert.equal(validateAuxiliaryLock(lock), lock)
  assert.equal(lock.pythonVersion, '3.12.14')
  assert.deepEqual(Object.keys(lock.targets).sort(), ['linux-arm64', 'linux-x64', 'mac-arm64', 'mac-x64', 'win-x64'])
  for (const required of ['numpy', 'pandas', 'python-docx', 'python-pptx', 'openpyxl', 'Pillow', 'lxml', 'XlsxWriter']) assert.ok(lock.pythonPackages[required])
})

it('rejects wheels whose versions, target closure or registry source disagree with the lock', async () => {
  const lock = await selectedLock()
  const mismatched = structuredClone(lock)
  mismatched.pythonPackages.numpy = '0.0.0'
  assert.throws(() => validateAuxiliaryLock(mismatched), /wheel version differs/)
  const incomplete = structuredClone(lock)
  const artifact = incomplete.targets['mac-arm64']
  assert.ok(artifact)
  artifact.wheels.pop()
  assert.throws(() => validateAuxiliaryLock(incomplete), /Incomplete Python wheel set/)
  const thirdParty = structuredClone(lock)
  const wheel = thirdParty.wheels[0]
  assert.ok(wheel)
  wheel.url = wheel.url.replace('files.pythonhosted.org', 'untrusted.example')
  assert.throws(() => validateAuxiliaryLock(thirdParty), /Unrecognized Python wheel source/)
  const invalidHash = structuredClone(lock)
  const target = invalidHash.targets['win-x64']
  assert.ok(target)
  target.pythonSha256 = '0'.repeat(63)
  assert.throws(() => validateAuxiliaryLock(invalidHash), /Invalid auxiliary target/)
})
