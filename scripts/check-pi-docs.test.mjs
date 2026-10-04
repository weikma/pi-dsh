/** Keep documentation checks effective on reviewed and invalid checkout fixtures. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkDocumentation, pairs, instructions } from './check-pi-docs.mjs'

test('documentation accepts reviewed pairs and rejects stale records, missing links, line mismatch and budgets', async () => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const root = await mkdtemp(join(tmpdir(), 'pi-desktop-docs-'))
  try {
    const documents = [...instructions, ...pairs.flatMap(path => [path, path.replace(/\.md$/, '.zh.md')])]
    for (const path of [...documents, 'scripts/doc-budgets.manifest.json']) {
      await mkdir(dirname(resolve(root, path)), { recursive: true })
      await writeFile(resolve(root, path), await readFile(resolve(sourceRoot, path)))
    }
    for (const path of documents) {
      const text = await readFile(resolve(root, path), 'utf8')
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0]
        if (!target || /^[a-z]+:/i.test(target)) continue
        const absolute = resolve(root, dirname(path), target)
        try { await access(absolute) }
        catch (error) { void error; await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, '') }
      }
    }
    assert.deepEqual(await checkDocumentation(root, true), [])
    assert.deepEqual(await checkDocumentation(root), [])
    const path = join(root, 'README.md')
    const original = await readFile(path, 'utf8')
    await writeFile(path, original.replace('Pi-DSH', 'Pi-DSH edited'))
    assert.ok((await checkDocumentation(root)).some(failure => failure.includes('stale pair')))
    await writeFile(path, original + '\n[Missing](missing-document.md)\n')
    const invalid = await checkDocumentation(root)
    assert.ok(invalid.some(failure => failure.includes('bilingual line counts differ')))
    assert.ok(invalid.some(failure => failure.includes('missing local link missing-document.md')))
    await writeFile(path, original + '\n')
    assert.ok((await checkDocumentation(root)).some(failure => failure.includes('exactly one trailing newline')))
    await writeFile(path, original)
    await writeFile(join(root, 'scripts/doc-budgets.manifest.json'), JSON.stringify({ 'AGENTS.md': 1 }))
    assert.ok((await checkDocumentation(root)).some(failure => failure.includes('words exceeds 1')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
