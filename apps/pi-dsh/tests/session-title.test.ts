/** Deferred model results exercise native-name ownership and cancellation without clock races. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionTitleGenerator } from '../runtime/session-title.ts'

function fixture() {
  let name: string | undefined
  let id = 'original'
  let finish!: (value: string | undefined) => void
  let called!: () => void
  let aborted!: () => void
  const started = new Promise<void>(resolve => { called = resolve })
  const cancelled = new Promise<void>(resolve => { aborted = resolve })
  const result = new Promise<string | undefined>(resolve => { finish = resolve })
  const names: string[] = []
  let calls = 0
  const request = {
    sessionId: id, prompt: 'Please diagnose why the report cannot be generated.',
    currentSessionId: () => id,
    getName: () => name,
    setName: (value: string) => { name = value; names.push(value) },
    generate: async (_prompt: string, signal: AbortSignal) => { calls++; signal.addEventListener('abort', () => aborted(), { once: true }); called(); return result },
  }
  return { request, started, cancelled, names, finish: (value?: string) => finish(value), rename: (value: string) => { name = value }, replace: () => { id = 'replacement' }, calls: () => calls }
}

test('a model summary becomes the native name once and manual names suppress automatic calls', async () => {
  const f = fixture(), titles = new SessionTitleGenerator()
  const done = titles.start(f.request); titles.start(f.request)
  await f.started
  f.finish('“Diagnose report generation”')
  await done
  await titles.cancel()
  assert.deepEqual(f.names, ['Diagnose report generation'])
  titles.start(f.request)
  assert.equal(f.calls(), 1)
  const named = fixture(); named.rename('My title'); titles.start(named.request)
  assert.equal(named.calls(), 0)
})

test('late results cannot overwrite a manual rename or another native session', async () => {
  for (const change of ['rename', 'replace'] as const) {
    const f = fixture(), titles = new SessionTitleGenerator()
    const done = titles.start(f.request); await f.started
    if (change === 'rename') f.rename('Keep my name'); else f.replace()
    f.finish('Unwanted late title')
    await done
    await titles.cancel()
    assert.deepEqual(f.names, [])
  }
})

test('shutdown aborts the request and waits for the provider to settle', async () => {
  const f = fixture(), titles = new SessionTitleGenerator()
  titles.start(f.request); await f.started
  let joined = false
  const shutdown = titles.cancel().then(() => { joined = true })
  await f.cancelled
  assert.equal(joined, false)
  f.finish('Too late')
  await shutdown
  assert.equal(joined, true)
  assert.deepEqual(f.names, [])
})

test('empty, multiline and overlong output leave the conversation unnamed', async () => {
  for (const output of [undefined, '', '<title>Bad</title>', 'Title\nExplanation', 'x'.repeat(101)]) {
    const f = fixture(), titles = new SessionTitleGenerator()
    const done = titles.start(f.request); await f.started
    f.finish(output); await done
    assert.deepEqual(f.names, [])
    await titles.cancel()
  }
})
