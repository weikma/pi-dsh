/** Response disclosure respects native timing and user-message boundaries. */
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { workDuration, workRows } from '../client/work-records.ts'
import type { MessageRecord } from '../client/records.ts'

const message = (id: string, role: string, extra: Partial<MessageRecord> = {}): MessageRecord => ({ id, role, blocks: [], streaming: false, ...extra })

it('formats elapsed time consistently at second, minute and hour boundaries', () => {
  assert.deepEqual([-1000, 999, 1000, 59000, 60000, 3599000, 3600000, 22805000].map(workDuration),
    ['0s', '0s', '1s', '59s', '1m 0s', '59m 59s', '1h 0m 0s', '6h 20m 5s'])
})

it('keeps an existing response stable when the next user begins and uses persistence time for completion', () => {
  const first = message('u1', 'user', { timestamp: 1000 })
  const tool = message('a1', 'assistant', { timestamp: 2000, completedAt: 3000 })
  const final = message('a2', 'assistant', { timestamp: 4000, completedAt: 10000 })
  const next = message('u2', 'user', { timestamp: 20000 })
  const rows = workRows([first, tool, final, next], true)
  assert.equal(rows.length, 4)
  if (rows[1]?.type !== 'work' || rows[3]?.type !== 'work') throw new Error('Response groups missing')
  assert.deepEqual(rows[1].work.messages.map(item => item.id), ['a1', 'a2'])
  assert.equal(rows[1].work.active, false)
  assert.equal(rows[1].work.completedAt, 10000)
  assert.equal(rows[1].work.startedAt, 1000)
  assert.equal(rows[3].work.active, true)
  assert.equal(rows[3].work.startedAt, 20000)
  const updated = workRows([first, tool, final, next, message('a3', 'assistant')], true)
  assert.equal(updated[3]?.type === 'work' && updated[3].work.id, rows[3].work.id)
})

it('does not invent completion durations from an assistant generation-start timestamp', () => {
  const rows = workRows([message('u', 'user', { timestamp: 1000 }), message('a', 'assistant', { timestamp: 2000 })], false)
  assert.equal(rows[1]?.type === 'work' && rows[1].work.completedAt, undefined)
})

it('keeps native summaries visible and groups only the current branch messages', () => {
  const summary = message('summary', 'compactionSummary')
  const rows = workRows([summary, message('u', 'user'), message('a', 'assistant', { stopReason: 'aborted' })], false)
  assert.equal(rows[0]?.type === 'message' && rows[0].message, summary)
  assert.equal(rows[2]?.type === 'work' && rows[2].work.outcome, 'stopped')
})
