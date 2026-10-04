/** Transcript controls preserve native text and keep manual scrolling usable during streaming. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Conversation } from '../client/Conversation.tsx'
import { translate } from '../client/i18n.ts'
import type { PiSnapshot } from '../bridge/types.ts'
import { plainAnsiText } from '@deepseek-ai/dsh-client-ui-primitives'

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params)
const base: PiSnapshot = { sessionId: 'host', state: { sessionId: 'native', thinkingLevel: 'off', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 0 },
  messages: [], entries: [], models: [], commands: [], thinkingLevels: [], pendingUI: [], steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {} }

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function view(snapshot: PiSnapshot) {
  const feedback = vi.fn()
  render(<Conversation snapshot={snapshot} t={t} feedback={feedback} openFile={() => {}} openExternal={() => {}} navigate={() => {}} historyDisabled />)
  return feedback
}

it('shows OpenAI summaries in the existing Thinking disclosure after one process expansion', async () => {
  const user = userEvent.setup()
  const original: PiSnapshot = { ...base, messages: [
    { role: 'user', content: 'Check the report', timestamp: 1000 },
    { role: 'assistant', entryId: 'answer', api: 'openai-responses', provider: 'openai', timestamp: 2000, content: [
      { type: 'thinking', thinking: '\u001b[36mThinking:\u001b[0m The report already contains the requested checks.' },
      { type: 'text', text: 'The report is ready.' },
    ] },
  ], entries: [{ id: 'answer', timestamp: new Date(11000).toISOString() }] }
  const before = JSON.stringify(original)
  view(original)
  const thinking = screen.getByText('Thinking').closest('details')!
  expect(thinking.open).toBe(true)
  expect(thinking.closest('[hidden]')).not.toBeNull()
  await user.click(screen.getByRole('button', { name: 'Worked for 10s' }))
  expect(thinking.closest('[hidden]')).toBeNull()
  expect(screen.getByText('The report already contains the requested checks.')).toBeTruthy()
  expect(screen.queryByText('Reasoning summary')).toBeNull()
  expect(screen.getByText('The report is ready.').closest('details')).toBeNull()
  await user.click(screen.getByText('Thinking'))
  expect(thinking.open).toBe(false)
  expect(JSON.stringify(original)).toBe(before)
})

it.each(['en', 'zh'] as const)('explains an empty completed thinking block without inventing text (%s)', async locale => {
  const user = userEvent.setup()
  const localize = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params)
  const props = { t: localize, feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: true }
  const empty: PiSnapshot = { ...base, state: { ...base.state, isStreaming: true }, messages: [
    { role: 'user', content: 'Check', timestamp: 1000 },
    { role: 'assistant', api: 'openai-responses', content: [{ type: 'thinking', thinking: '' }], usage: { reasoning: 92 } },
  ] }
  const { rerender } = render(<Conversation {...props} snapshot={empty} />)
  expect(screen.queryByText(localize('thinkingUnavailable'))).toBeNull()
  rerender(<Conversation {...props} snapshot={{ ...empty, state: base.state }} />)
  await user.click(screen.getByRole('button', { name: localize('worked') }))
  const notice = screen.getByText(localize('thinkingUnavailable'))
  expect(notice.closest('details')?.open).toBe(true)
  expect(notice.closest('[hidden]')).toBeNull()
  rerender(<Conversation {...props} snapshot={{ ...base, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'No thinking was requested' }] }] }} />)
  expect(screen.queryByText(localize('thinkingUnavailable'))).toBeNull()
  expect(screen.queryByText(localize('thinking'))).toBeNull()
})

it('preserves a user-collapsed Thinking disclosure across streaming updates and settlement', async () => {
  const user = userEvent.setup()
  const props = { t, feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: true }
  const reply = (thinking: string, isStreaming = true): PiSnapshot => ({ ...base, state: { ...base.state, isStreaming }, messages: [
    { role: 'user', content: 'Check', timestamp: 1000 },
    { role: 'assistant', timestamp: 2000, content: [{ type: 'thinking', thinking }] },
  ] })
  const { rerender } = render(<Conversation {...props} snapshot={reply('Partial')} />)
  const details = screen.getByText('Thinking').closest('details')!
  await user.click(screen.getByText('Thinking'))
  expect(details.open).toBe(false)
  rerender(<Conversation {...props} snapshot={reply('Complete')} />)
  expect(details.open).toBe(false)
  rerender(<Conversation {...props} snapshot={reply('Complete', false)} />)
  expect(details.open).toBe(false)
})

it('removes terminal controls from thinking and extension output without rewriting native data', () => {
  const thinking = '\u001b[38;5;140mThinking:\u001b[39m \u001b[38;5;109mInspect the tools.\u001b[0m'
  const original = { ...base, messages: [
    { role: 'assistant', content: [{ type: 'thinking', thinking }, { type: 'toolCall', name: 'subagent', id: 'sub', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'sub', content: [{ type: 'text', text: thinking }] },
  ] }
  const before = JSON.stringify(original)
  view(original)
  expect(screen.getByText('Inspect the tools.')).toBeTruthy()
  expect(screen.getByText('Thinking: Inspect the tools.')).toBeTruthy()
  expect(screen.getByRole('log').textContent).not.toContain('\u001b')
  expect(JSON.stringify(original)).toBe(before)
  expect(plainAnsiText('Hello\u001b[38;5;')).toBe('Hello')
  expect(plainAnsiText('\u001b]8;;https://example.com\u0007visible\u001b]8;;\u0007')).toBe('visible')
  expect(plainAnsiText('Plain 中文\n\t[38;5;140m')).toBe('Plain 中文\n\t[38;5;140m')
})

it('copies the original answer text without appending thinking or tool arguments', async () => {
  const user = userEvent.setup()
  const feedback = view({ ...base, messages: [{ role: 'assistant', content: [
    { type: 'thinking', thinking: 'Internal thinking' }, { type: 'text', text: '**Original answer**' }, { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'secret.txt' } },
  ] }] })
  await user.click(screen.getByRole('button', { name: 'Worked' }))
  await user.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(await navigator.clipboard.readText()).toBe('**Original answer**')
  expect(feedback).toHaveBeenCalledWith('Copied')
})

it('collapses native skill context while keeping the request visible and original text copyable', async () => {
  const user = userEvent.setup()
  const text = '<skill name="writing" location="/skills/writing/SKILL.md">\nNative skill instructions\n</skill>\n\nWrite the report.'
  view({ ...base, messages: [{ role: 'user', content: text }] })
  const summary = screen.getByText('/skill:writing')
  expect(summary.closest('details')?.open).toBe(false)
  expect(screen.getByText('Write the report.')).toBeTruthy()
  await user.click(summary)
  expect(summary.closest('details')?.open).toBe(true)
  expect(screen.getByText('Native skill instructions')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(await navigator.clipboard.readText()).toBe(text)
})

it('reports clipboard failure and retains the answer for manual copying', async () => {
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'))
  const feedback = view({ ...base, messages: [{ role: 'assistant', content: 'Answer remains visible' }] })
  await user.click(screen.getByRole('button', { name: 'Copy message' }))
  expect(feedback).toHaveBeenCalledWith('Could not copy. Select the text and copy it manually.')
  expect(screen.getByText('Answer remains visible')).toBeTruthy()
})

it('shows native summaries and compaction progress without replacing earlier answers', () => {
  view({ ...base, state: { ...base.state, isCompacting: true }, messages: [
    { role: 'assistant', content: 'Earlier answer' }, { role: 'compactionSummary', summary: 'Saved context' }, { role: 'branchSummary', summary: 'Other branch context' },
  ] })
  expect(screen.getByText('Earlier answer')).toBeTruthy()
  expect(screen.getByText('Compaction summary')).toBeTruthy()
  expect(screen.getByText('Branch summary')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Compacting conversation')
})

it('offers a return to the latest message after manual scrolling', async () => {
  const user = userEvent.setup()
  view({ ...base, messages: [{ role: 'assistant', content: 'Latest reply' }] })
  const log = screen.getByRole('log', { name: 'Conversation' })
  Object.defineProperties(log, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 400, configurable: true } })
  log.scrollTop = 100
  fireEvent.scroll(log)
  await user.click(screen.getByRole('button', { name: 'Back to bottom' }))
  expect(log.scrollTop).toBe(1000)
  expect(screen.queryByRole('button', { name: 'Back to bottom' })).toBeNull()
})


it('keeps one Working disclosure through tool updates and settles in place above the final answer', async () => {
  const user = userEvent.setup()
  const started: PiSnapshot = { ...base, state: { ...base.state, isStreaming: true }, messages: [{ role: 'user', content: 'Inspect', timestamp: 1000 }] }
  const props = { t, feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: true }
  const { rerender, container } = render(<Conversation {...props} snapshot={started} />)
  const header = screen.getByRole('button', { name: /^Working for / })
  expect(header.getAttribute('aria-expanded')).toBe('true')
  await user.click(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  const tools: PiSnapshot = { ...started, messages: [...started.messages,
    { role: 'assistant', timestamp: 2000, content: [{ type: 'thinking', thinking: 'Thinking: Check the file.' }, { type: 'text', text: 'Checking the file.' }, { type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a.ts' } }] },
  ], tools: { read: { toolCallId: 'read', status: 'running' } } }
  rerender(<Conversation {...props} snapshot={tools} />)
  expect(screen.getByRole('button', { name: /^Working for / })).toBe(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[data-tool="read"]')?.closest('[hidden]')).toBeTruthy()
  await user.click(header)
  expect(container.querySelector('[data-tool="read"]')?.closest('[hidden]')).toBeNull()
  const completed: PiSnapshot = { ...tools, state: base.state, messages: [...tools.messages,
    { role: 'toolResult', toolCallId: 'read', content: 'File content' },
    { role: 'assistant', entryId: 'final', timestamp: 3000, stopReason: 'stop', content: [{ type: 'thinking', thinking: 'Conclude.' }, { type: 'text', text: '**Final answer**' }] },
  ], entries: [{ id: 'final', timestamp: new Date(22806000).toISOString() }], tools: {} }
  rerender(<Conversation {...props} snapshot={completed} />)
  expect(screen.getByRole('button', { name: 'Worked for 6h 20m 5s' })).toBe(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('Final answer').closest('[hidden]')).toBeNull()
  expect(container.querySelector('[data-tool="read"]')?.closest('[hidden]')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  await user.click(header)
  expect(screen.getByText('Check the file.')).toBeTruthy()
  expect(screen.queryByText('Thinking: Check the file.')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(3)
})

it('keeps failures and aborted partial output visible when process details are collapsed', () => {
  view({ ...base, messages: [
    { role: 'user', content: 'Try it', timestamp: 1000 },
    { role: 'assistant', entryId: 'failed', content: [], stopReason: 'error', errorMessage: 'Provider unavailable' },
    { role: 'user', content: 'Try again', timestamp: 11000 },
    { role: 'assistant', entryId: 'stopped', content: [{ type: 'thinking', thinking: 'Thinking: Keep working.' }, { type: 'text', text: 'Partial reply' }], stopReason: 'aborted', errorMessage: 'Aborted' },
  ], entries: [{ id: 'failed', timestamp: new Date(6000).toISOString() }, { id: 'stopped', timestamp: new Date(21000).toISOString() }] })
  expect(screen.getByRole('button', { name: 'Failed after 5s' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Stopped after 10s' })).toBeTruthy()
  expect(screen.getByText('Provider unavailable').closest('[hidden]')).toBeNull()
  expect(screen.getByText('Partial reply').closest('[hidden]')).toBeNull()
  expect(screen.queryByText('Aborted')).toBeNull()
})

it('uses the same h m s duration in Chinese and keeps the final answer outside the disclosure', () => {
  render(<Conversation snapshot={{ ...base, messages: [{ role: 'user', content: '检查', timestamp: 0 },
    { role: 'assistant', entryId: 'answer', content: '完成' }], entries: [{ id: 'answer', timestamp: new Date(3605000).toISOString() }] }}
    t={(key, params) => translate('zh', key, params)} feedback={() => {}} openFile={() => {}} openExternal={() => {}} navigate={() => {}} historyDisabled />)
  expect(screen.getByRole('button', { name: '已处理 1h 0m 5s' })).toBeTruthy()
  expect(screen.getByText('完成').closest('[hidden]')).toBeNull()
})

it('renders completed formulas in a native streaming reply while Working remains active', () => {
  view({ ...base, state: { ...base.state, isStreaming: true }, messages: [
    { role: 'user', content: 'Explain the formula', timestamp: 1000 },
    { role: 'assistant', content: [{ type: 'text', text: 'Inline \\(x^2\\).\n\n$$\nE = mc^2\n$$\n\nThe explanation continues' }] },
  ] })
  const log = screen.getByRole('log')
  expect(screen.getByRole('button', { name: /^Working for / })).toBeTruthy()
  expect(log.querySelectorAll('.katex')).toHaveLength(2)
  expect(log.querySelector('.katex-display annotation')?.textContent).toBe('E = mc^2')
  expect(screen.getByText('The explanation continues')).toBeTruthy()
})


it.each(['en', 'zh'] as const)('updates live elapsed time without new Pi events and freezes the completed duration (%s)', locale => {
  vi.useFakeTimers(); vi.setSystemTime(59000)
  const running: PiSnapshot = { ...base, state: { ...base.state, isStreaming: true }, messages: [{ role: 'user', content: 'Work', timestamp: 0 }] }
  const props = { t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params), feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: true }
  const prefix = locale === 'en' ? 'Working for ' : '正在处理 '
  const { rerender } = render(<Conversation {...props} snapshot={running} />)
  const header = screen.getByRole('button', { name: prefix + '59s' })
  fireEvent.click(header)
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByRole('button', { name: prefix + '1m 0s' })).toBe(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  const tools: PiSnapshot = { ...running, messages: [...running.messages, { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a.ts' } }] }] }
  rerender(<Conversation {...props} snapshot={tools} />)
  act(() => { vi.advanceTimersByTime(3599000) })
  expect(screen.getByRole('button', { name: prefix + '1h 0m 59s' })).toBe(header)
  const completed: PiSnapshot = { ...running, state: base.state, messages: [...running.messages, { role: 'assistant', entryId: 'finished', content: 'Done' }], entries: [{ id: 'finished', timestamp: new Date(3659000).toISOString() }] }
  rerender(<Conversation {...props} snapshot={completed} />)
  const label = (locale === 'en' ? 'Worked for ' : '已处理 ') + '1h 0m 59s'
  expect(screen.getByRole('button', { name: label })).toBe(header)
  expect(vi.getTimerCount()).toBe(0)
  act(() => { vi.advanceTimersByTime(10000) })
  expect(screen.getByRole('button', { name: label })).toBe(header)
  rerender(<Conversation {...props} snapshot={{ ...running, messages: [{ role: 'user', content: 'A different branch', timestamp: Date.now() }] }} />)
  expect(screen.queryByRole('status')).toBeNull()
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByRole('button', { name: prefix + '1s' })).toBeTruthy()
})

it.each(['en', 'zh'] as const)('reveals the running header at one second and keeps its clock through native startup (%s)', locale => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const localize = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params)
  const props = { t: localize, feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: true }
  const { rerender, unmount } = render(<Conversation {...props} snapshot={null} pending={{ text: 'Start now', images: [] }} />)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  act(() => { vi.advanceTimersByTime(999) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  const prefix = locale === 'en' ? 'Working for ' : '正在处理 '
  const header = screen.getByRole('button', { name: prefix + '1s' })
  fireEvent.click(header)
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByRole('button', { name: prefix + '2s' })).toBe(header)
  rerender(<Conversation {...props} snapshot={{ ...base, state: { ...base.state, isStreaming: true }, messages: [{ role: 'user', content: 'Start now', timestamp: 3000 }] }} />)
  expect(screen.getByRole('button', { name: prefix + '2s' })).toBe(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})


it('shows each native message time after its actions in local 24-hour hours and minutes', () => {
  const sent = new Date(2026, 9, 3, 22, 43, 59), reply = new Date(2026, 9, 4, 0, 4, 35)
  const props = { t, feedback: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), navigate: vi.fn(), historyDisabled: false }
  const { container } = render(<Conversation {...props} snapshot={{ ...base, messages: [
    { role: 'user', entryId: 'question', content: 'Question', timestamp: sent.getTime() },
    { role: 'assistant', entryId: 'answer', content: 'Answer', timestamp: reply.getTime() },
  ], entries: [{ id: 'answer', timestamp: new Date(2026, 9, 4, 0, 5).toISOString() }] }} />)
  const times = [...container.querySelectorAll('time')]
  expect(times.map(time => time.textContent)).toEqual(['22:43', '00:04'])
  expect(times.map(time => time.dateTime)).toEqual([sent.toISOString(), reply.toISOString()])
  for (const time of times) {
    expect([...time.parentElement!.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['Copy message', 'Branch from this message'])
    expect(time.previousElementSibling?.querySelector('button')?.getAttribute('aria-label')).toBe('Branch from this message')
  }
})

it('omits absent or invalid native message dates without inventing a send time', () => {
  const { container } = render(<Conversation snapshot={{ ...base, messages: [
    { role: 'user', content: 'Timestamp unavailable' },
    { role: 'assistant', content: 'Invalid timestamp', timestamp: 1e30 },
  ] }} t={t} feedback={() => {}} openFile={() => {}} openExternal={() => {}} navigate={() => {}} historyDisabled />)
  expect(container.querySelector('time')).toBeNull()
  expect(screen.getByText('Timestamp unavailable')).toBeTruthy()
  expect(screen.getByText('Invalid timestamp')).toBeTruthy()
})
