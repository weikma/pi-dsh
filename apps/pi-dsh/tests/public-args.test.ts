/** Runtime edits preserve private launch keys while renderer responses contain no key values. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicRuntimeArgs, restoreRuntimeArgs } from '../runtime/public-args.ts'

test('runtime API-key hints retain values through edits and permit explicit replacement or removal', () => {
  const original = ['pi.js', '--api-key', 'private-key', '--api-key=second-private-key']
  const visible = publicRuntimeArgs(original)
  assert.ok(!JSON.stringify(visible).includes('private-key'))
  assert.deepEqual(restoreRuntimeArgs(original, visible), original)
  assert.deepEqual(restoreRuntimeArgs(original, [...visible, '--provider', 'deepseek']), [...original, '--provider', 'deepseek'])
  assert.deepEqual(restoreRuntimeArgs(original, ['pi.js']), ['pi.js'])
  assert.deepEqual(restoreRuntimeArgs(original, ['pi.js', '--api-key', 'new-key']), ['pi.js', '--api-key', 'new-key'])
  assert.throws(() => restoreRuntimeArgs([], visible), /Re-enter/)
})
