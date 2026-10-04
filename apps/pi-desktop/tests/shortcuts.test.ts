import assert from 'node:assert/strict'
import { test } from 'node:test'
import { panelShortcut } from '../client/shortcuts.ts'

test('panel shortcuts respect platform modifiers, Option-produced characters, composition and extra modifiers', () => {
  const key = { key: 'b', code: 'KeyB', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false }
  assert.equal(panelShortcut(key, 'darwin'), 'history')
  assert.equal(panelShortcut({ ...key, key: '∫', altKey: true }, 'darwin'), 'files')
  assert.equal(panelShortcut({ ...key, metaKey: false, ctrlKey: true }, 'win32'), 'history')
  assert.equal(panelShortcut({ ...key, metaKey: false, ctrlKey: true, altKey: true }, 'win32'), 'files')
  assert.equal(panelShortcut({ ...key, shiftKey: true }, 'darwin'), undefined)
  assert.equal(panelShortcut({ ...key, isComposing: true }, 'darwin'), undefined)
  assert.equal(panelShortcut({ ...key, repeat: true }, 'darwin'), undefined)
  assert.equal(panelShortcut(key, 'win32'), undefined)
})
