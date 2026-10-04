import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { compactTokens, ContextUsage } from '../client/ContextUsage.tsx'
import { translate } from '../client/i18n.ts'

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('formats token counts with compact decimal units including rounded boundaries', () => {
  expect([0, 999, 999.5, 1200, 57300, 128000, 999_999, 1_000_000, 2_450_000].map(compactTokens)).toEqual(['0', '999', '1K', '1.2K', '57.3K', '128K', '1M', '1M', '2.5M'])
})

it('opens a classified estimate on keyboard focus, dismisses with Escape and hides stale breakdowns', async () => {
  const user = userEvent.setup()
  const breakdown = { system: 200, tools: 100, mcp: 300, extensions: 0, skills: 50, messages: 250, results: 100 }
  const { rerender } = render(<ContextUsage usage={{ tokens: 57300, contextWindow: 1_000_000, percent: 5.73 }} breakdown={breakdown} cacheHitRate={0.875} t={t} />)
  // JSDOM does not track the browser's keyboard focus-visible heuristic.
  vi.spyOn(screen.getByRole('img'), 'matches').mockReturnValue(true)
  await user.tab()
  expect(await screen.findByRole('region', { name: 'Context window' })).toBeTruthy()
  expect(screen.getByText('57.3K / 1M (5.7%)')).toBeTruthy()
  expect(screen.getByText('MCP tools')).toBeTruthy()
  expect(screen.getByText('30.0%')).toBeTruthy()
  expect(screen.queryByText('Extension tools')).toBeNull()
  expect(screen.getByText('Estimated composition')).toBeTruthy()
  expect(screen.getByText('Cache hit rate')).toBeTruthy()
  expect(screen.getByText('87.5%')).toBeTruthy()
  expect(screen.queryByText(/Shares are estimated/)).toBeNull()
  expect([...screen.getByRole('region').querySelectorAll('dt')].map(node => node.textContent)).toEqual(['MCP tools', 'Messages', 'System prompt', 'Pi tools', 'Tool results', 'Skills', 'Cache hit rate'])
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  await user.tab({ shift: true })
  await user.tab()
  expect(await screen.findByRole('region')).toBeTruthy()
  rerender(<ContextUsage usage={{ tokens: null, contextWindow: 1_000_000, percent: null }} breakdown={breakdown} t={t} />)
  expect(screen.queryByText('MCP tools')).toBeNull()
  expect(screen.getByText('Pi will update usage after its next response.')).toBeTruthy()
  expect(screen.queryByText('87.5%')).toBeNull()
  expect(screen.getByText('Cache hit rate').nextElementSibling?.textContent).toBe('—')
})

it('opens on pointer hover and closes after leaving the context indicator', async () => {
  const user = userEvent.setup()
  render(<ContextUsage usage={{ tokens: 32000, contextWindow: 128000, percent: 25 }} cacheHitRate={0} t={t} />)
  const ring = screen.getByRole('img')
  await user.hover(ring)
  expect(await screen.findByRole('region', { name: 'Context window' })).toBeTruthy()
  expect(screen.getByText('32K / 128K (25.0%)')).toBeTruthy()
  expect(screen.getByText('0.0%')).toBeTruthy()
  await user.unhover(ring)
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
})
