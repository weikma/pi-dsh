/** Public Pi translates Responses summaries into the same thinking events and native history. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { PiBridge, type PiSessionHandle } from '../bridge/manager.ts'
import type { PiSnapshot } from '../bridge/types.ts'
import { readSessionPreview } from '../bridge/session-records.ts'
import { createResponsesFixture, FINAL_THINKING } from './responses-fixture.ts'

function until(session: PiSessionHandle, predicate: (value: PiSnapshot) => boolean): Promise<PiSnapshot> {
  if (predicate(session.snapshot())) return Promise.resolve(session.snapshot())
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('Pi did not publish the expected thinking state')) }, 30000)
    const stop = session.subscribe(value => { if (predicate(value)) { clearTimeout(timeout); stop(); resolve(value) } })
  })
}

test('real Pi publishes Responses thinking without deltas, retains it across tools and keeps empty summaries empty', { timeout: 60000 }, async () => {
  const fixture = await createResponsesFixture(true)
  const bridge = new PiBridge(fixture.runtime)
  try {
    const session = await bridge.createSession(fixture.cwd)
    await session.command({ type: 'prompt', message: 'Create a report and check its contents.' })
    const pending = await until(session, value => value.state.isStreaming && value.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.thinking === FINAL_THINKING)))
    assert.equal(pending.messages.some(message => message.stopReason === 'stop'), false)
    assert.deepEqual(fixture.requests[0]?.reasoning, { effort: 'high', summary: 'auto' })
    fixture.release()
    const finished = await until(session, value => !value.state.isStreaming && value.messages.some(message => message.stopReason === 'stop'))
    assert.match(await readFile(join(fixture.cwd, 'report.md'), 'utf8'), /standard Pi transcript/)
    const thinking = (value: PiSnapshot) => value.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'thinking').map(block => block.thinking) : [])
    assert.equal(thinking(finished).length, 3)
    assert.ok(thinking(finished).includes(FINAL_THINKING))
    assert.equal(typeof finished.state.sessionFile, 'string')
    const preview = await readSessionPreview(String(finished.state.sessionFile), fixture.cwd)
    assert.ok(preview)
    assert.deepEqual(thinking(preview), thinking(finished))
    await session.command({ type: 'prompt', message: 'Reply without a thinking summary.' })
    const empty = await until(session, value => !value.state.isStreaming && value.messages.filter(message => message.role === 'assistant').length === 4)
    assert.equal(thinking(empty).at(-1), '')
    assert.equal(fixture.requests.length, 4)
  } finally { fixture.release(); await bridge.dispose(); await fixture.dispose() }
})
