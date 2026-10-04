import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeAppearanceProvider, type CodeAppearance, CodeBlock, ReadBlock, DiffBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { markdownLabels, readLabels } from '../client/Conversation.tsx'
import { translate } from '../client/i18n.ts'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('en', key, values)
const source = 'const answer = 42\nconsole.log(answer)'

function Samples({ value, streaming = true }: { value: CodeAppearance; streaming?: boolean }) {
  return <CodeAppearanceProvider value={value}>
    <CodeBlock code={source} lang="ts" streaming={streaming} {...markdownLabels(t).code} />
    <ReadBlock lines={source.split('\n').map((text, index) => ({ number: index + 8, text }))} totalLines={9} lang="ts" labels={readLabels(t)} />
    <DiffBlock diffs={[{ path: 'sample.ts', oldText: 'first\nold\nlast', newText: 'first\nnew\nlast' }]} labels={readLabels(t)} />
    <CodeBlock code={'unhighlighted\nplain text'} lang="unknown" {...markdownLabels(t).code} />
  </CodeAppearanceProvider>
}

describe('shared code appearance', () => {
  it('updates existing streaming, plain, file and diff surfaces without changing copied source', async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const initial = { theme: 'github-light' as const, lineNumbers: true, wrap: false }
    const { container, rerender } = render(<Samples value={initial} />)
    const firstToken = () => container.querySelector<HTMLElement>('pre .line span')?.style.color
    expect(container.querySelector<HTMLElement>('.md-code-block')?.style.getPropertyValue('--dsw-code-background')).toBe('#fff')
    const before = firstToken()
    expect(before).toBeTruthy()
    expect(container.querySelector('[data-read] span[aria-hidden]')?.textContent).toBe('8')
    const diff = container.querySelector('[data-diff]')!
    expect([...diff.querySelectorAll('span[aria-hidden]')].map(row => row.textContent)).toEqual(['', '11', '2', '2', '33'])
    expect([...container.querySelectorAll('[data-code-wrap]')].every(el => el.getAttribute('data-code-wrap') === 'false')).toBe(true)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe(source)
    await user.click(container.querySelector<HTMLButtonElement>('.md-code-block button')!)
    expect(copy).toHaveBeenLastCalledWith(source)
    const value = { theme: 'nord' as const, lineNumbers: false, wrap: true }
    rerender(<Samples value={value} />)
    expect(firstToken()).not.toBe(before)
    expect(container.querySelector<HTMLElement>('[data-read]')?.style.getPropertyValue('--dsw-code-background')).toBe('#2e3440')
    expect(container.querySelector('[data-read] span[aria-hidden]')).toBeNull()
    expect(container.querySelector('[data-diff] span[aria-hidden]')).toBeNull()
    expect([...container.querySelectorAll('[data-code-wrap]')].every(el => el.getAttribute('data-code-wrap') === 'true')).toBe(true)
    expect(container.querySelector('pre')?.textContent).toBe(source)
    const streamingColor = firstToken()
    rerender(<Samples value={value} streaming={false} />)
    expect(firstToken()).toBe(streamingColor)
    expect(container.querySelector('pre')).toBe(pre)
  })
})
