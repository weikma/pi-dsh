/** Reject obsolete product names in tracked paths and current source content. */
import { execFile } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// These exact owners need historical spellings to import settings or demonstrate an upgrade.
const migrationOwners = new Set([
  'apps/pi-dsh/user-data.ts', 'apps/pi-dsh/tests/user-data.test.ts',
  'docs/upgrade-guide/v0.2.0-rc.58/product-name/guide.md', 'docs/upgrade-guide/v0.2.0-rc.58/product-name/guide.zh.md',
  'scripts/check-product-names.test.mjs',
])
const obsolete = /pi[._ -]?desktop|im\.pi\.desktop|desktop-runtime\.ts/iu
const informal = /\b(?:Pi-|PI[ -])DSH\b/u

/** Migration text may name its input format; no current path may retain an obsolete product name. */
export function namingIssues(path, text) {
  const issues = []
  if (obsolete.test(path) || informal.test(path)) issues.push(path + ': obsolete product filename')
  if (!migrationOwners.has(path) && (obsolete.test(text) || informal.test(text))) issues.push(path + ': obsolete product name in content')
  return issues
}

/** Inspect repository-owned files, including new files; ignore deleted paths, symlinks and binary assets. */
export async function checkProductNames(root) {
  const { stdout } = await promisify(execFile)('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  const issues = []
  for (const path of new Set(stdout.split('\0').filter(Boolean))) {
    if (path.startsWith('vendor/')) continue
    let info
    try { info = await lstat(resolve(root, path)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!info.isFile()) continue
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(resolve(root, path))) }
    catch (error) { if (error instanceof TypeError) { issues.push(...namingIssues(path, '')); continue }; throw error }
    issues.push(...namingIssues(path, text))
  }
  return issues
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const issues = await checkProductNames(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1 }
  else console.log('Pi DSH names passed: paths, source, CI and documentation; historical spellings are confined to explicit migration owners.')
}
