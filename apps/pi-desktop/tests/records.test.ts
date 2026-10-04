/** Pi message presentation keeps the native transcript and tool settlements intact. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PiSnapshot } from '../bridge/types.ts'
import { messagesOf, queuesOf } from '../client/records.ts'

function snapshot(): PiSnapshot {
  return { sessionId: 'gui-1', state: { sessionId: 'pi-1', thinkingLevel: 'medium', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 0 },
    messages: [], entries: [], models: [], commands: [], thinkingLevels: [], pendingUI: [], steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {} }
}

describe('Pi transcript presentation', () => {
  it('retains native user, thinking, and assistant order while joining tool results by call id', () => {
    const value = snapshot()
    value.messages = [
      { role: 'user', content: 'Read the file', timestamp: 10 },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspect the requested path' }, { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' } }], timestamp: 11 },
      { role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'export const a = 1' }], isError: false },
      { role: 'assistant', content: [{ type: 'text', text: 'The file declares a constant' }], timestamp: 12 },
    ]
    const records = messagesOf(value)
    assert.deepEqual(records.map(record => record.role), ['user', 'assistant', 'assistant'])
    assert.deepEqual(records[1]?.blocks, [
      { type: 'thinking', text: 'Inspect the requested path' },
      { type: 'tool', tool: { id: 'read-1', name: 'read', args: { path: 'a.ts' }, output: 'export const a = 1', running: false, error: false, details: {} } },
    ])
  })

  it('renders native incremental tool output without inventing a durable tool result', () => {
    const value = snapshot()
    value.state.isStreaming = true
    value.messages = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'bash-1', name: 'bash', arguments: { command: 'make' } }] }]
    value.tools['bash-1'] = { toolCallId: 'bash-1', status: 'running', partialResult: { content: [{ type: 'text', text: 'Building…' }] } }
    let block = messagesOf(value)[0]?.blocks[0]
    assert.equal(block?.type, 'tool')
    if (block?.type !== 'tool') throw new Error('Tool row missing')
    assert.equal(block.tool.output, 'Building…')
    assert.equal(block.tool.running, true)
    value.tools['bash-1'] = { toolCallId: 'bash-1', status: 'error', result: { content: [{ type: 'text', text: 'Build failed' }], isError: true } }
    block = messagesOf(value)[0]?.blocks[0]
    if (block?.type !== 'tool') throw new Error('Tool row missing')
    assert.equal(block.tool.output, 'Build failed')
    assert.equal(block.tool.running, false)
    assert.equal(block.tool.error, true)
  })

  it('uses both Pi-owned queues without turning queued prompts into transcript messages', () => {
    const value = snapshot()
    value.steering = ['Check the error first']
    value.followUp = ['Then run the tests']
    assert.deepEqual(queuesOf(value), { steer: ['Check the error first'], followUp: ['Then run the tests'] })
    assert.deepEqual(messagesOf(value), [])
  })

  it('keeps an aborted partial reply without presenting user cancellation as a tool error', () => {
    const value = snapshot()
    value.messages = [{ role: 'assistant', content: [{ type: 'text', text: 'Partial reply' }], stopReason: 'aborted', errorMessage: 'Request was aborted' }]
    assert.deepEqual(messagesOf(value)[0]?.blocks, [{ type: 'text', text: 'Partial reply' }])
    assert.equal(messagesOf(value)[0]?.error, undefined)
  })

  it('retains errors before any assistant text and native compaction and branch summaries', () => {
    const value = snapshot()
    value.messages = [
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Provider unavailable' },
      { role: 'compactionSummary', summary: 'Preserve the test results', entryId: 'compact-1' },
      { role: 'branchSummary', summary: 'Earlier branch context', entryId: 'branch-1' },
    ]
    const records = messagesOf(value)
    assert.equal(records.length, 3)
    assert.equal(records[0]?.error, 'Provider unavailable')
    assert.deepEqual(records[1]?.blocks, [{ type: 'summary', kind: 'compaction', text: 'Preserve the test results' }])
    assert.deepEqual(records[2]?.blocks, [{ type: 'summary', kind: 'branch', text: 'Earlier branch context' }])
  })

  it('does not render empty extension text as a blank message with a copy action', () => {
    const value = snapshot()
    value.messages = [{ role: 'custom', content: '' }, { role: 'assistant', content: [{ type: 'text', text: '' }] }]
    assert.deepEqual(messagesOf(value), [])
  })
})

it('native skill projections preserve the original message and derive titles from the request', async () => {
  const { skillInvocation, userMessageTitle } = await import('../bridge/skill-presentation.ts')
  const text = '<skill name="writing" location="/skills/writing/SKILL.md">\nNative instructions\n</skill>\n\nWrite the report.'
  assert.deepEqual(skillInvocation(text), { name: 'writing', location: '/skills/writing/SKILL.md', content: 'Native instructions', prompt: 'Write the report.' })
  const value = snapshot(); value.messages = [{ role: 'user', content: text }]
  const before = JSON.stringify(value)
  assert.equal(messagesOf(value)[0]?.blocks[0]?.type, 'skill')
  assert.equal(JSON.stringify(value), before)
  value.messages = [{ role: 'assistant', content: text }]
  assert.equal(messagesOf(value)[0]?.blocks[0]?.type, 'text')
  assert.equal(userMessageTitle(text), 'Write the report.')
  assert.equal(userMessageTitle(text.split('\n\nWrite')[0]!), '/skill:writing')
  assert.equal(skillInvocation('<skill>ordinary XML</skill>'), undefined)
  assert.equal(userMessageTitle('A normal message'), 'A normal message')
})
