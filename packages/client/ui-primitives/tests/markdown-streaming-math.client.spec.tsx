// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import katex from 'katex'
import { MarkdownText } from './markdown-test-components.tsx'
import { IncrementalMarkdownParser } from '../src/markdown/incremental.ts'
import { parseGfmWithMath } from '../src/markdown/parse.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('math during streaming', () => {
  it.each([['$', '$'], ['\\(', '\\)'], ['$$', '$$']])('renders inline %s math only after its closing delimiter', (open, close) => {
    const partial = `Value ${open}\\frac{1}{2}`
    const live = render(<MarkdownText text={partial} streaming />)
    expect(live.container.querySelector('.katex')).toBeNull()
    expect(live.container.textContent).toContain('frac{1}{2}')
    live.rerender(<MarkdownText text={`${partial}${close} and more`} streaming />)
    expect(live.container.querySelector('.katex annotation')?.textContent).toBe('\\frac{1}{2}')
    expect(live.container.querySelector('.katex-display')).toBeNull()
  })

  it.each([['$$', '$$'], ['\\[', '\\]'], ['```math', '```']])('renders an open %s block and recovers from incomplete TeX', (open, close) => {
    const start = `${open}\nx^2`
    const live = render(<MarkdownText text={start} streaming />)
    expect(live.container.querySelector('.katex-display annotation')?.textContent?.trim()).toBe('x^2')
    live.rerender(<MarkdownText text={`${start} + \\frac{1}{`} streaming />)
    expect(live.container.querySelector('.katex')).toBeNull()
    expect(live.container.querySelector('.katex-error')).toBeNull()
    live.rerender(<MarkdownText text={`${start} + \\frac{1}{2}\n${close}\n\nStill writing`} streaming />)
    expect(live.container.querySelector('.katex-display annotation')?.textContent?.trim()).toBe('x^2 + \\frac{1}{2}')
    expect(live.container.textContent).toContain('Still writing')
  })

  it('reveals malformed TeX errors only when streaming ends', () => {
    const text = 'Before.\n\n$$\n\\frac{\n$$\n\nAfter.'
    const live = render(<MarkdownText text={text} streaming />)
    expect(live.container.querySelector('.katex-error')).toBeNull()
    expect(live.container.textContent).toContain('After.')
    live.rerender(<MarkdownText text={text} />)
    expect(live.container.querySelector('.katex-error')?.textContent).toBe('\\frac{')
  })

  it('reuses a completed formula while adjacent text grows and the paragraph freezes', () => {
    const renderMath = vi.spyOn(katex, 'renderToString')
    const text = 'Value \\(x^2\\)'
    const live = render(<MarkdownText text={text} streaming />)
    const formula = live.container.querySelector('.katex')
    expect(formula).not.toBeNull()
    for (const suffix of [' tail', ' tail text', ' tail text\n\nSecond.\n\nThird.\n\nFourth.']) {
      live.rerender(<MarkdownText text={text + suffix} streaming />)
      expect(live.container.querySelector('.katex')).toBe(formula)
    }
    expect(renderMath).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary code and escaped delimiters literal while rendering table and list formulas', () => {
    const text = [
      '`$x$ \\(y\\)` and \\$5.00', '',
      '```tex', '\\[x\\]', '$$y$$', '```', '',
      '- Value \\(a^2\\)', '',
      '| Value |', '| --- |', '| $b^2$ |',
    ].join('\n')
    const live = render(<MarkdownText text={text} streaming />)
    expect(live.container.querySelectorAll('.katex')).toHaveLength(2)
    expect(live.container.querySelector('li .katex annotation')?.textContent).toBe('a^2')
    expect(live.container.querySelector('td .katex annotation')?.textContent).toBe('b^2')
    expect(live.container.querySelector('pre code')?.textContent).toContain('\\[x\\]')
    expect(live.container.textContent).toContain('$5.00')
  })

  it.each([['$$', '$$'], ['\\[', '\\]']])('keeps blank lines inside an open %s block beyond the freeze frontier', (open, close) => {
    const parser = new IncrementalMarkdownParser(text => parseGfmWithMath(text, true))
    let text = `One.\n\nTwo.\n\nThree.\n\n${open}\nx^2`
    const first = parser.update(text)
    for (const suffix of ['\n\n', '+ y^2', '\n\n', '= z^2']) {
      text += suffix
      const current = parser.update(text)
      expect(current.frozen.length).toBe(first.frozen.length)
      expect(current.tail.at(-1)?.node.type).toBe('math')
    }
    text += `\n${close}\n\nAfter one.\n\nAfter two.\n\nAfter three.`
    const completed = parser.update(text)
    const formula = completed.frozen.find(block => block.node.type === 'math')
    expect(formula?.node.type === 'math' && formula.node.value).toContain('= z^2')
    expect([...completed.frozen, ...completed.tail].map(block => block.key))
      .toEqual(parseGfmWithMath(text, true).children.map(node => node.position?.start.offset))
  })

  it('matches a fresh render at each character across formula delimiters, blank lines and freezes', { timeout: 20_000 }, () => {
    const text = 'One.\n\nTwo.\n\nThree.\n\n\\[\nx^2\n\n+ y^2\n\\]\n\nInline \\(z^2\\).\n\n$$\na^2\n\n+b^2\n$$\n\nDone.\n\nNext.'
    const live = render(<MarkdownText text="" streaming />)
    for (let end = 1; end <= text.length; end++) {
      const prefix = text.slice(0, end)
      live.rerender(<MarkdownText text={prefix} streaming />)
      const fresh = render(<MarkdownText text={prefix} streaming />)
      expect(live.container.innerHTML, prefix).toBe(fresh.container.innerHTML)
      fresh.unmount()
    }
  })
})
