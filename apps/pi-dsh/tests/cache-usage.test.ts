import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCacheHitRate } from '../bridge/cache-usage.ts'

test('cache rate includes uncached input and cache writes, excluding output tokens', () => {
  assert.equal(readCacheHitRate({ input: 10, cacheRead: 70, cacheWrite: 20, output: 900 }), 0.7)
  assert.equal(readCacheHitRate({ input: 10, cacheRead: 0, cacheWrite: 0 }), 0)
  assert.equal(readCacheHitRate({ input: 0, cacheRead: 100, cacheWrite: 0 }), 1)
})

test('missing, malformed and empty usage stays unavailable', () => {
  const valid = { input: 10, cacheRead: 70, cacheWrite: 20 }
  for (const value of [undefined, {}, { input: 10 }, { input: 0, cacheRead: 0, cacheWrite: 0 }]) assert.equal(readCacheHitRate(value), undefined)
  for (const field of ['input', 'cacheRead', 'cacheWrite']) {
    for (const value of [-1, NaN, Infinity, '10', null]) assert.equal(readCacheHitRate({ ...valid, [field]: value }), undefined)
  }
})
