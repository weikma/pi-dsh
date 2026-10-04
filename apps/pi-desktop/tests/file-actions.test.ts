import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { editorLaunch, FileEditor, nativeFileRequest } from '../file-actions.ts'

test('editor launches keep application names and filenames literal, with no renderer executable control', () => {
  const editor = join(tmpdir(), 'Editor with spaces.app')
  const file = join(tmpdir(), 'file $(touch unexpected); --option.md')
  assert.deepEqual(editorLaunch('darwin', editor, file), { command: '/usr/bin/open', args: ['-a', editor, '--', file] })
  assert.deepEqual(editorLaunch('win32', editor, file), { command: editor, args: [file] })
  assert.throws(() => editorLaunch('darwin', 'relative.app', file), /Absolute/)
  assert.throws(() => nativeFileRequest({ cwd: tmpdir(), path: file, action: 'execute', command: 'anything' }), /Unsupported/)
})

test('editor preference survives restart and rejects non-application paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-file-editor-'))
  try {
    const path = join(root, 'Chosen Editor.app')
    await mkdir(path)
    const preferences = join(root, 'preferences/editor.json')
    const owner = new FileEditor(preferences, 'darwin')
    assert.equal(await owner.selected(), undefined)
    await owner.choose(path)
    assert.equal(await new FileEditor(preferences, 'darwin').selected(), path)
    assert.deepEqual(JSON.parse(await readFile(preferences, 'utf8')), { path })
    await assert.rejects(owner.choose(root), /editor application/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
