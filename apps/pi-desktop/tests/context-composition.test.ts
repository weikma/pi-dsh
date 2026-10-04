import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contextComposition } from '../runtime/context-composition.ts'
import { readContextBreakdown } from '../bridge/context-breakdown.ts'

test('estimates only model-visible content and separates native tools, MCP, extensions and skills', () => {
  const tools = [
    { name: 'read', description: 'Read', parameters: { type: 'object' }, sourceInfo: { path: 'builtin:read' } },
    { name: 'mcp__docs__find', description: 'Search', parameters: {}, sourceInfo: { path: 'builtin:mcp' } },
    { name: 'custom', description: 'Custom', parameters: {}, sourceInfo: { path: '/extensions/custom.ts' } },
  ]
  const skill = '<skill name="demo" location="/skills/demo/SKILL.md">\nDo the work\n</skill>\n\nhello'
  const messages = [
    { role: 'system', content: 'Native system history is not counted twice' },
    { role: 'user', content: skill },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }, { type: 'thinking', thinking: 'think' }], usage: { input: 999999 }, signature: 'ignored' },
    { role: 'toolResult', content: [{ type: 'text', text: 'result' }], details: { hidden: 'ignored' } },
  ]
  const before = JSON.stringify({ tools, messages })
  const sizes = contextComposition('prompt<available_skills>manifest</available_skills>', tools, messages)
  assert.equal(sizes.system, 6)
  assert.equal(sizes.messages, 15)
  assert.equal(sizes.results, 6)
  assert.equal(sizes.skills, '<available_skills>manifest</available_skills>'.length + skill.length - 5)
  assert.ok(sizes.tools > 0 && sizes.mcp > 0 && sizes.extensions > 0)
  assert.equal(JSON.stringify({ tools, messages }), before)
  assert.deepEqual(readContextBreakdown(JSON.stringify(sizes)), sizes)
})

test('image estimates do not count base64 bytes as tokens and invalid metadata stays unavailable', () => {
  const estimate = (data: string) => contextComposition('', [], [{ role: 'user', content: [{ type: 'image', data }] }])
  assert.deepEqual(estimate('x'), estimate('x'.repeat(100_000)))
  const sizes = estimate('x')
  for (const input of [undefined, 'invalid', '{}', JSON.stringify({ ...sizes, system: -1 }), JSON.stringify({ ...sizes, mcp: '5' }), JSON.stringify({ ...sizes, tools: 1e20 })]) assert.equal(readContextBreakdown(input), undefined)
})

test('counts native summaries and included shell output without restoring compacted history', () => {
  const sizes = contextComposition('', [], [
    { role: 'compactionSummary', summary: 'compact', tokensBefore: 100000 },
    { role: 'branchSummary', summary: 'branch' },
    { role: 'bashExecution', command: 'cmd', output: 'out' },
    { role: 'bashExecution', command: 'excluded', output: 'private', excludeFromContext: true },
  ])
  assert.equal(sizes.messages, 13)
  assert.equal(sizes.results, 6)
})
