/** Active documentation checks; historical DSH evidence is deliberately read-only. */
import { readFile, writeFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const libraries = ['client/ui-primitives', 'client/ui-dockkit', 'client/store', 'util/brand', 'util/code-language', 'util/workspace-path']
/** Bilingual documents describing the active application and source libraries. */
export const pairs = ['README.md', 'CONTRIBUTING.md', 'BRAND_GUIDELINES.md', 'SAFETY.md', 'docs/architecture.md', 'docs/testing.md', 'docs/pi-dsh/README.md', 'docs/pi-dsh/extensions.md', 'apps/pi-dsh/runtime/AUXILIARY.md', 'apps/pi-dsh/bridge/README.md', 'apps/pi-dsh/assets/README.md', 'docs/upgrade-guide/v0.2.0-rc.2/pi-dsh/guide.md', 'docs/upgrade-guide/v0.2.0-rc.4/runtime-selection/guide.md', 'docs/upgrade-guide/v0.2.0-rc.58/product-name/guide.md', 'packages/README.md', 'packages/client/README.md', ...libraries.map(path => 'packages/' + path + '/README.md')]
/** Instruction files whose current links and budgets are checked. */
export const instructions = ['AGENTS.md', 'docs/AGENTS.md', 'packages/AGENTS.md', 'packages/client/AGENTS.md']
/** Check an explicit checkout; optionally record reviewed bilingual bytes. */
export async function checkDocumentation(root, write = false) {
const failures = []
const digest = text => createHash('sha256').update(text).digest('hex')
for (const englishPath of pairs) {
  const chinesePath = englishPath.replace(/\.md$/, '.zh.md')
  const recordPath = englishPath.replace(/\.md$/, '.i18n.yaml')
  const english = await readFile(resolve(root, englishPath), 'utf8')
  const chinese = await readFile(resolve(root, chinesePath), 'utf8')
  if (english.split('\n').length !== chinese.split('\n').length) failures.push(englishPath + ': bilingual line counts differ')
  const expected = { format: 'pi-dsh-pair-v1', en: digest(english), zh: digest(chinese) }
  if (write) await writeFile(resolve(root, recordPath), JSON.stringify(expected, null, 2) + '\n')
  else {
    try { const record = JSON.parse(await readFile(resolve(root, recordPath), 'utf8')); if (record.en !== expected.en || record.zh !== expected.zh) failures.push(recordPath + ': stale pair; review both sides and run pnpm docs:record') }
    catch (error) { void error; failures.push(recordPath + ': missing current bilingual record; run pnpm docs:record') }
  }
}
for (const path of [...instructions, ...pairs.flatMap(path => [path, path.replace(/\.md$/, '.zh.md')])]) {
  const text = await readFile(resolve(root, path), 'utf8')
  if (!text.endsWith('\n') || text.endsWith('\n\n')) failures.push(path + ': requires exactly one trailing newline')
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:/i.test(target)) continue
    try { await access(resolve(root, dirname(path), target)) }
    catch (error) { void error; failures.push(path + ': missing local link ' + target) }
  }
}
const budgets = JSON.parse(await readFile(resolve(root, 'scripts/doc-budgets.manifest.json'), 'utf8'))
for (const [path, ceiling] of Object.entries(budgets)) {
  const text = await readFile(resolve(root, path), 'utf8')
  const words = text.split(/\s+/).filter(Boolean).length
  if (words > ceiling) failures.push(path + ': ' + words + ' words exceeds ' + ceiling)
}
return failures
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const failures = await checkDocumentation(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv.includes('--write'))
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
  else console.log('Active Pi DSH documentation: ' + pairs.length + ' bilingual pairs, local links and instruction budgets passed.')
}
