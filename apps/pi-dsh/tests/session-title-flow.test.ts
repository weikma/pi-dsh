/** The selected official Pi generates a separate summary and persists its native session name. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PiBridge, type PiSessionHandle } from '../bridge/manager.ts'
import type { PiSnapshot } from '../bridge/types.ts'
import { readSessionPreview } from '../bridge/session-records.ts'
import { createResponsesFixture } from './responses-fixture.ts'

function until(session: PiSessionHandle, predicate: (snapshot: PiSnapshot) => boolean): Promise<PiSnapshot> {
  if (predicate(session.snapshot())) return Promise.resolve(session.snapshot())
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('Pi did not publish the expected session title')) }, 30000)
    const stop = session.subscribe(snapshot => { if (predicate(snapshot)) { clearTimeout(timeout); stop(); resolve(snapshot) } })
  })
}

test('real Pi generates a native title without blocking the reply or changing model context; history restores it', { timeout: 60000 }, async () => {
  const fixture = await createResponsesFixture(true, [2], true)
  const bridge = new PiBridge(fixture.runtime), restored = new PiBridge(fixture.runtime)
  try {
    const session = await bridge.createSession(fixture.cwd)
    const prompt = '请生成一个项目报告，写入 report.md，然后读回文件确认内容正确。'
    await session.command({ type: 'prompt', message: prompt })
    const streaming = await until(session, value => value.state.isStreaming && value.messages.some(message => message.role === 'assistant'))
    const initialHistory = await bridge.listSessions(fixture.cwd)
    assert.equal(initialHistory.find(item => item.id === streaming.state.sessionId)?.name, prompt)
    assert.equal(fixture.titleRequests.length, 0)
    fixture.release(1)
    await until(session, value => value.state.isStreaming && value.messages.some(message => message.role === 'toolResult'))
    assert.equal(fixture.titleRequests.length, 0)
    fixture.release(2)
    const completed = await until(session, value => !value.state.isStreaming && value.messages.filter(message => message.role === 'assistant').length === 3)
    assert.equal(completed.state.sessionName, undefined, 'The main reply must settle while the title provider is held')
    fixture.releaseTitle()
    const named = await until(session, value => value.state.sessionName === '项目报告生成与核验')
    assert.equal(fixture.titleRequests.length, 1)
    const title = fixture.titleRequests[0]!
    assert.equal(title.model, fixture.requests[0]?.model)
    assert.ok(JSON.stringify(title).includes(prompt))
    assert.ok(!Array.isArray(title.tools) || title.tools.length === 0)
    assert.deepEqual(named.messages, completed.messages, 'Auxiliary prompt and result must stay outside the transcript')
    assert.deepEqual(named.completedContext, completed.completedContext)
    assert.equal(fixture.requests.length, 3)
    const file = named.state.sessionFile; assert.ok(file)
    assert.equal((await bridge.listSessions(fixture.cwd)).find(item => item.id === named.state.sessionId)?.name, '项目报告生成与核验')
    assert.equal((await readSessionPreview(file, fixture.cwd))?.state.sessionName, '项目报告生成与核验')
    const bytes = await readFile(file)
    const reopened = await restored.createSession(fixture.cwd, file)
    assert.equal(reopened.snapshot().state.sessionName, '项目报告生成与核验')
    assert.deepEqual(await readFile(file), bytes)
    await reopened.command({ type: 'prompt', message: '继续确认报告。' })
    await until(reopened, value => !value.state.isStreaming && value.messages.filter(message => message.role === 'assistant').length === 4)
    assert.equal(fixture.titleRequests.length, 1)
    assert.equal(reopened.snapshot().state.sessionName, '项目报告生成与核验')
  } finally { await restored.dispose(); await bridge.dispose(); await fixture.dispose() }
})
