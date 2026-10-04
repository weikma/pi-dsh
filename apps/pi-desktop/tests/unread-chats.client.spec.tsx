import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useUnreadChats } from '../client/useUnreadChats.ts'
import { api } from '../client/http.ts'
import type { PiSnapshot } from '../bridge/types.ts'
import type { UnreadChat } from '../unread-types.ts'

let stream: UnreadStream | undefined
let focused = false
const changed = vi.fn(async () => {})
const failed = vi.fn()
const nativeCount = vi.fn(async (_count: number) => {})
const first: UnreadChat = { nativeSessionId: 'one', cwd: '/project', sessionFile: '/sessions/one.jsonl', entryId: 'reply-1' }
const second: UnreadChat = { nativeSessionId: 'two', cwd: '/project', sessionFile: '/sessions/two.jsonl', entryId: 'reply-2' }

class UnreadStream {
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  constructor(readonly url: string) { stream = this }
  close() { this.closed = true }
}

function snapshot(item: UnreadChat, entryId = item.entryId): PiSnapshot {
  return { sessionId: 'gui', state: { sessionId: item.nativeSessionId, sessionFile: '/alias' + item.sessionFile, thinkingLevel: 'off', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 1 },
    messages: [{ role: 'assistant', entryId, content: 'Visible reply' }], entries: [], models: [], commands: [], thinkingLevels: [], pendingUI: [], steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {} }
}
function Probe({ value, obscured = false }: { value: PiSnapshot | null; obscured?: boolean }) {
  const unread = useUnreadChats(value, obscured, failed, changed)
  return <output>{[...unread].join(',')}</output>
}
function publish(items: UnreadChat[]) {
  act(() => { stream?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'unread', items }) })) })
}
beforeEach(() => {
  stream = undefined; focused = false
  vi.stubGlobal('EventSource', UnreadStream)
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(api, 'readChat').mockResolvedValue({ items: [] })
  window.piDesktop = { platform: 'darwin', pickDirectory: async () => null, openExternal: async () => {}, setUnreadCount: nativeCount }
  changed.mockClear(); failed.mockClear(); nativeCount.mockClear()
})
afterEach(() => { cleanup(); delete window.piDesktop; vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('counts background chats and acknowledges only the focused visible reply', async () => {
  const { rerender, unmount } = render(<Probe value={snapshot(first)} />)
  publish([first, second])
  expect(screen.getByRole('status').textContent).toContain(second.nativeSessionId)
  expect(nativeCount).toHaveBeenLastCalledWith(2)
  expect(api.readChat).not.toHaveBeenCalled()
  focused = true; fireEvent(window, new Event('focus'))
  await waitFor(() => expect(api.readChat).toHaveBeenCalledExactlyOnceWith({ nativeSessionId: first.nativeSessionId, entryId: first.entryId }))
  publish([second])
  expect(nativeCount).toHaveBeenLastCalledWith(1)
  rerender(<Probe value={snapshot(second, 'older-reply')} />)
  expect(api.readChat).toHaveBeenCalledTimes(1)
  rerender(<Probe value={snapshot(second)} />)
  await waitFor(() => expect(api.readChat).toHaveBeenLastCalledWith({ nativeSessionId: second.nativeSessionId, entryId: second.entryId }))
  publish([])
  expect(nativeCount).toHaveBeenLastCalledWith(0)
  unmount()
  expect(stream?.closed).toBe(true)
  const calls = vi.mocked(api.readChat).mock.calls.length
  fireEvent(window, new Event('focus'))
  expect(api.readChat).toHaveBeenCalledTimes(calls)
})

it('keeps results unread behind settings, in a hidden window or outside the displayed branch', async () => {
  focused = true
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const { rerender } = render(<Probe value={snapshot(first)} />)
  publish([first])
  expect(api.readChat).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  rerender(<Probe value={snapshot(first)} obscured />)
  fireEvent(document, new Event('visibilitychange'))
  expect(api.readChat).not.toHaveBeenCalled()
  rerender(<Probe value={snapshot(first, 'other-branch')} />)
  expect(api.readChat).not.toHaveBeenCalled()
  rerender(<Probe value={snapshot(first)} />)
  await waitFor(() => expect(api.readChat).toHaveBeenCalledExactlyOnceWith({ nativeSessionId: first.nativeSessionId, entryId: first.entryId }))
})

it('ordinary Web shares read state without native capabilities, and malformed updates do not clear it', () => {
  delete window.piDesktop
  render(<Probe value={null} />)
  publish([first])
  act(() => { stream?.onmessage?.(new MessageEvent('message', { data: '{invalid' })) })
  act(() => { stream?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'unread', items: [{}] }) })) })
  expect(screen.getByRole('status').textContent).toBe(first.nativeSessionId)
  expect(nativeCount).not.toHaveBeenCalled()
  expect(api.readChat).not.toHaveBeenCalled()
})
