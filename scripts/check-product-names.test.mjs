/** Negative controls keep the repository naming guard effective without changing user files. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { namingIssues } from './check-product-names.mjs'

test('current names pass and legacy filenames or product content fail', () => {
  assert.deepEqual(namingIssues('.github/workflows/pi-dsh.yml', 'name: Pi DSH'), [])
  for (const path of ['.github/workflows/pi-desktop.yml', 'apps/piDesktop/main.ts', 'docs/Pi-DSH.md']) assert.match(namingIssues(path, '')[0], /filename/)
  for (const name of ['Pi Desktop', 'PI_DESKTOP_HOME', 'piDesktop', 'Pi-DSH', 'PI DSH', 'im.pi.desktop', 'desktop-runtime.ts']) assert.match(namingIssues('README.md', name)[0], /content/)
  assert.deepEqual(namingIssues('THIRD_PARTY_NOTICES.md', 'Pi Coding Agent and DeepSeek Harness'), [])
})

test('only explicit migration owners may describe old input names', () => {
  assert.deepEqual(namingIssues('apps/pi-dsh/user-data.ts', '.pi-desktop'), [])
  assert.deepEqual(namingIssues('docs/upgrade-guide/v0.2.0-rc.58/product-name/guide.md', 'PI_DESKTOP_ → PI_DSH_'), [])
  assert.equal(namingIssues('apps/pi-dsh/another-migration.ts', '.pi-desktop').length, 1)
})
