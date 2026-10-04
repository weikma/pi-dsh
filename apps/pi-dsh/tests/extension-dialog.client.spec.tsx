import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtensionDialog } from '../client/ExtensionDialog.tsx'
import type { PiUIRequest } from '../bridge/types.ts'
import { translate } from '../client/i18n.ts'

const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
const request: PiUIRequest = { type: 'extension_ui_request', id: 'question', method: 'select', title: 'Which check should I run?', options: [
  '\u001b[32m1. Repository checks — Run the local checks and report results\u001b[0m', '2. Unit tests — Run tests without changing files', '3. Type something.',
] }
// The fixture uses ASCII radio names; jsdom does not provide CSS.escape for user-event.
beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('shows separate choices and returns the exact native option only after confirmation', async () => {
  const user = userEvent.setup(), respond = vi.fn(async () => {})
  render(<ExtensionDialog request={request} t={t} respond={respond} />)
  const group = screen.getByRole('radiogroup', { name: 'Choose an answer' })
  const choices = within(group).getAllByRole('radio')
  const submit = screen.getByRole('button', { name: 'Submit' })
  expect(submit.hasAttribute('disabled')).toBe(true)
  expect(group.textContent).not.toContain('\u001b')
  await user.click(choices[0]!)
  expect(respond).not.toHaveBeenCalled()
  await user.click(submit)
  expect(respond).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'question', value: request.options?.[0] })
  expect(choices.every(choice => choice.hasAttribute('disabled'))).toBe(true)
})

it('supports radio keyboard selection and preserves custom-answer routing', async () => {
  const user = userEvent.setup(), respond = vi.fn(async () => {})
  render(<ExtensionDialog request={request} t={t} respond={respond} />)
  const choices = screen.getAllByRole('radio')
  await waitFor(() => expect(document.activeElement).toBe(choices[0]))
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(respond).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'question', value: '3. Type something.' })
})

it('keeps the selection after a failed response and permits an explicit retry', async () => {
  const user = userEvent.setup(), respond = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue(undefined)
  render(<ExtensionDialog request={request} t={t} respond={respond} />)
  await user.click(screen.getAllByRole('radio')[1]!)
  await user.click(screen.getByRole('button', { name: 'Submit' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection interrupted')
  expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Submit' }))
  expect(respond).toHaveBeenCalledTimes(2)
})

it('sends one cancellation for Escape and honors native timeout', async () => {
  const respond = vi.fn(async () => {})
  const view = render(<ExtensionDialog request={request} t={t} respond={respond} />)
  fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' })
  fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' })
  expect(respond).toHaveBeenCalledTimes(1)
  expect(respond).toHaveBeenLastCalledWith({ type: 'extension_ui_response', id: 'question', cancelled: true })
  view.unmount()
  vi.useFakeTimers()
  render(<ExtensionDialog request={{ ...request, id: 'timed', timeout: 5000 }} t={t} respond={respond} />)
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(respond).toHaveBeenLastCalledWith({ type: 'extension_ui_response', id: 'timed', cancelled: true })
})

it('submits free text unchanged and ignores Enter while composing', async () => {
  const user = userEvent.setup(), respond = vi.fn(async () => {})
  render(<ExtensionDialog request={{ ...request, method: 'input', title: 'Your answer' }} t={t} respond={respond} />)
  const input = screen.getByRole('textbox', { name: 'Your answer' })
  await user.type(input, '只验证连接')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(respond).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(respond).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'question', value: '只验证连接' })
})


it('keeps the custom answer in its option row through the native select/input handoff', async () => {
  const user = userEvent.setup(), respond = vi.fn(async () => {})
  const view = render(<ExtensionDialog request={request} t={t} respond={respond} />)
  const field = screen.getByRole('textbox', { name: 'Your answer' })
  await user.type(field, 'Read only\nPlease')
  expect(respond).toHaveBeenCalledExactlyOnceWith({ type: 'extension_ui_response', id: 'question', value: '3. Type something.' })
  view.rerender(<ExtensionDialog request={undefined} t={t} respond={respond} />)
  view.rerender(<ExtensionDialog request={{ type: 'extension_ui_request', id: 'custom', method: 'input', title: request.title + '\n\nType your answer:' }} t={t} respond={respond} />)
  expect(screen.getByRole('heading')).toHaveProperty('textContent', request.title)
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveProperty('value', 'Read only\nPlease')
  expect(respond).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Submit' }))
  expect(respond).toHaveBeenLastCalledWith({ type: 'extension_ui_response', id: 'custom', value: 'Read only\nPlease' })
})

it('does not carry a custom answer into an unrelated extension request', async () => {
  const user = userEvent.setup(), respond = vi.fn(async () => {})
  const view = render(<ExtensionDialog request={request} t={t} respond={respond} />)
  await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Private draft')
  view.rerender(<ExtensionDialog request={{ type: 'extension_ui_request', id: 'other', method: 'input', title: 'Different question' }} t={t} respond={respond} />)
  expect(screen.getByRole('textbox', { name: 'Different question' })).toHaveProperty('value', '')
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})
