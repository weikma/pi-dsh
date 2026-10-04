import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createDirectory, listDirectories } from '../directory-picker.ts'

test('directory browsing lists folders and directory links without exposing file contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-directory-picker-'))
  try {
    const home = join(root, 'home')
    await mkdir(home)
    for (const name of ['work 10', 'work 2', '.config']) await mkdir(join(home, name))
    await writeFile(join(home, 'private.txt'), 'Not directory-listing data')
    await symlink(join(home, 'work 2'), join(home, 'linked work'), process.platform === 'win32' ? 'junction' : 'dir')
    const listing = await listDirectories(undefined, home)
    assert.equal(listing.parent, dirname(listing.path))
    assert.deepEqual(listing.entries.map(entry => entry.name), ['.config', 'linked work', 'work 2', 'work 10'])
    assert.equal(listing.entries.find(entry => entry.name === '.config')?.hidden, true)
    assert.equal(listing.truncated, false)
    assert.equal(JSON.stringify(listing).includes('Not directory-listing data'), false)
    const linked = await listDirectories(join(home, 'linked work'), home)
    assert.equal(linked.path, join(listing.path, 'work 2'))
    await assert.rejects(listDirectories(join(home, 'private.txt'), home), /directory/)
    await assert.rejects(listDirectories('relative', home), /absolute/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('creating a folder never traverses, overwrites, or implicitly creates parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-directory-create-'))
  try {
    const parent = join(root, 'parent')
    await mkdir(parent)
    const result = await createDirectory({ path: parent, name: 'Project with spaces' })
    await writeFile(join(result.path, 'keep.txt'), 'keep')
    await assert.rejects(createDirectory({ path: parent, name: 'Project with spaces' }), /EEXIST/)
    assert.equal(await readFile(join(result.path, 'keep.txt'), 'utf8'), 'keep')
    for (const name of ['', '..', '../outside', 'nested/child', 'nested\\child', 'bad\0name']) {
      await assert.rejects(createDirectory({ path: parent, name }), /folder name/)
    }
    await assert.rejects(createDirectory({ path: join(root, 'missing'), name: 'child' }), /ENOENT/)
    assert.deepEqual((await listDirectories(root)).entries.map(entry => entry.name), ['parent'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
