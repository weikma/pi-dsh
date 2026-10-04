/** Settings import preserves selections and publishes complete files during concurrent starts. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { importGuiPreferences, importRuntimeSelection } from '../user-data.ts'

test('default GUI import preserves source bytes and never overwrites current preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-dsh-settings-'))
  try {
    const previous = join(root, '.pi-desktop'), current = join(root, '.pi-dsh')
    await mkdir(previous)
    const preferences = '{"projects":[{"cwd":"/project","name":"Project"}],"gui":{"locale":"zh"}}\n'
    const editor = '{"path":"/chosen/editor"}\n'
    await writeFile(join(previous, 'preferences.json'), preferences)
    await writeFile(join(previous, 'editor.json'), editor)
    await writeFile(join(previous, 'auth.json'), 'must stay outside the GUI import')
    await Promise.all([importGuiPreferences(root, current), importGuiPreferences(root, current)])
    assert.equal(await readFile(join(current, 'preferences.json'), 'utf8'), preferences)
    assert.equal(await readFile(join(previous, 'preferences.json'), 'utf8'), preferences)
    assert.equal(await readFile(join(current, 'editor.json'), 'utf8'), editor)
    assert.deepEqual((await readdir(current)).sort(), ['editor.json', 'preferences.json'])
    await writeFile(join(current, 'preferences.json'), '{"gui":{"locale":"en"}}')
    await importGuiPreferences(root, current)
    assert.equal(await readFile(join(current, 'preferences.json'), 'utf8'), '{"gui":{"locale":"en"}}')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('runtime import keeps the exact external command and yields to an explicit current selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-dsh-runtime-selection-'))
  try {
    const previous = join(root, '@deepseek-ai', 'pi-desktop')
    const current = join(root, 'pi-dsh', 'runtime.json')
    await mkdir(previous, { recursive: true })
    const selection = '{"command":"/independent/node","args":["/independent/pi"],"env":{"CUSTOM":"preserved"}}\n'
    await writeFile(join(previous, 'runtime.json'), selection)
    await Promise.all([importRuntimeSelection(root, current), importRuntimeSelection(root, current)])
    assert.equal(await readFile(current, 'utf8'), selection)
    assert.equal(await readFile(join(previous, 'runtime.json'), 'utf8'), selection)
    await writeFile(current, '{"mode":"bundled"}')
    await importRuntimeSelection(root, current)
    assert.equal(await readFile(current, 'utf8'), '{"mode":"bundled"}')
    assert.deepEqual(await readdir(join(root, 'pi-dsh')), ['runtime.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a fresh profile creates no imported settings or runtime selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-dsh-fresh-data-'))
  try {
    await importGuiPreferences(root, join(root, '.pi-dsh'))
    await importRuntimeSelection(root, join(root, 'pi-dsh', 'runtime.json'))
    assert.deepEqual(await readdir(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})
