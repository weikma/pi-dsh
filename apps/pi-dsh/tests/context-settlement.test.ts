/** The real selected Pi must settle its full tool loop before composer usage becomes visible. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PiBridge, type PiSessionHandle } from '../bridge/manager.ts'
import type { PiSnapshot } from '../bridge/types.ts'
import { createResponsesFixture } from './responses-fixture.ts'

function until(session: PiSessionHandle, predicate: (snapshot: PiSnapshot) => boolean): Promise<PiSnapshot> {
  if (predicate(session.snapshot())) return Promise.resolve(session.snapshot())
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('Pi did not reach the expected context settlement')) }, 30000)
    const stop = session.subscribe(snapshot => { if (predicate(snapshot)) { clearTimeout(timeout); stop(); resolve(snapshot) } })
  })
}

test('real Pi hides first-turn context, freezes later streaming and restores completed usage from native history', { timeout: 60000 }, async () => {
  const fixture = await createResponsesFixture(true, [2, 4, 5])
  const bridge = new PiBridge(fixture.runtime)
  const restored = new PiBridge(fixture.runtime)
  try {
    const session = await bridge.createSession(fixture.cwd)
    assert.equal(session.snapshot().completedContext, undefined)
    await session.command({ type: 'prompt', message: 'Create a report and read it back.' })
    await until(session, value => value.state.isStreaming && value.messages.some(message => message.role === 'assistant'))
    assert.equal(session.snapshot().completedContext, undefined)
    fixture.release()
    const tooling = await until(session, value => value.state.isStreaming && value.messages.some(message => message.role === 'toolResult') && value.contextUsage?.tokens === 300)
    assert.equal(tooling.completedContext, undefined)
    fixture.release(2)
    const first = await until(session, value => !value.state.isStreaming && value.completedContext?.usage?.tokens === 700)
    assert.equal(first.messages.filter(message => message.role === 'assistant').length, 3)
    await session.command({ type: 'prompt', message: 'Give another complete reply.' })
    await until(session, value => value.state.isStreaming && value.messages.filter(message => message.role === 'assistant').length === 4)
    assert.deepEqual(session.snapshot().completedContext, first.completedContext)
    fixture.release(4)
    const second = await until(session, value => !value.state.isStreaming && value.completedContext?.usage?.tokens === 900)
    const file = second.state.sessionFile
    assert.ok(file)
    const bytes = await readFile(file)
    const reopened = await restored.createSession(fixture.cwd, file)
    assert.deepEqual(reopened.snapshot().completedContext, second.completedContext)
    assert.deepEqual(await readFile(file), bytes)
    await session.command({ type: 'prompt', message: 'This request will be cancelled.' })
    await until(session, value => value.state.isStreaming && value.messages.filter(message => message.role === 'assistant').length === 5)
    await session.command({ type: 'abort' })
    const cancelled = await until(session, value => !value.state.isStreaming)
    assert.deepEqual(cancelled.completedContext, second.completedContext)
  } finally { await restored.dispose(); await bridge.dispose(); await fixture.dispose() }
})
