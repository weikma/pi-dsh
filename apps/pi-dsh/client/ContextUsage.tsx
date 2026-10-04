import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PiSnapshot } from '../bridge/types.ts'
import { CONTEXT_CATEGORIES, type ContextCategory } from '../bridge/context-breakdown.ts'
import type { T } from './i18n.ts'
import css from './App.module.css'
import card from './ContextUsage.module.css'

const labels = { system: 'contextSystem', tools: 'contextTools', mcp: 'contextMcp', extensions: 'contextExtensions', skills: 'contextSkills', messages: 'contextMessages', results: 'contextResults' } satisfies Record<ContextCategory, Parameters<T>[0]>

/** Decimal token units, rounding across the K/M boundary without locale-specific suffixes. */
export function compactTokens(tokens: number): string {
  if (tokens >= 999_950) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 999.5) return `${Number((tokens / 1000).toFixed(1))}K`
  return String(Math.round(tokens))
}

/** Pi owns the total estimate; category shares normalize character counts. */
export function ContextUsage({ usage, breakdown, cacheHitRate, t }: { usage: PiSnapshot['contextUsage']; breakdown?: PiSnapshot['contextBreakdown']; cacheHitRate?: PiSnapshot['cacheHitRate']; t: T }) {
  const percent = usage?.percent
  const tokens = usage?.tokens
  const capacity = usage?.contextWindow ?? 0
  const known = typeof percent === 'number' && typeof tokens === 'number'
  const label = known ? t('contextUsed', { percent: percent.toFixed(1) }) : t('contextUnknown')
  const detail = known
    ? t('contextTokens', { used: compactTokens(tokens), total: compactTokens(capacity) })
    : usage ? t('contextPending') : t('contextUnavailable')
  const totalWeight = breakdown ? CONTEXT_CATEGORIES.reduce((sum, key) => sum + breakdown[key], 0) : 0
  const rows = known && breakdown && totalWeight > 0 ? CONTEXT_CATEGORIES.filter(key => breakdown[key] > 0).map(key => ({ key, percent: breakdown[key] / totalWeight * 100 })).sort((a, b) => b.percent - a.percent) : []
  const fill = known ? Math.min(percent, 100) : 0
  return <HoverCard inline openDelayMs={200} anchor={
    <span tabIndex={0} role="img" aria-label={`${label}. ${detail}`} className={css.contextUsage}>
      <span className={css.contextRing} style={{ background: `conic-gradient(var(--dsw-alias-label-secondary) ${fill}%, color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent) 0)` }} />
    </span>
  } content={<section className={card.content} aria-label={t('contextWindow')}>
    <header className={card.header}><span>{t('contextWindow')}</span><span className={card.amount}>{known ? `${compactTokens(tokens)} / ${compactTokens(capacity)} (${percent.toFixed(1)}%)` : '—'}</span></header>
    <div className={card.bar} aria-hidden="true">
      {rows.length ? rows.map(row => <span key={row.key} className={card[row.key]} style={{ width: `${fill * row.percent / 100}%` }} />) : <span className={card.system} style={{ width: `${fill}%` }} />}
    </div>
    {rows.length ? <>
      <p className={card.caption}>{t('contextComposition')}</p>
      <dl className={card.rows}>{rows.map(row => <div key={row.key}><dt><span className={`${card.dot} ${card[row.key]}`} />{t(labels[row.key])}</dt><dd>{row.percent.toFixed(1)}%</dd></div>)}</dl>
    </> : <p className={card.note}>{known ? t('contextNoBreakdown') : detail}</p>}
    <dl className={card.cache}><dt>{t('cacheHitRate')}</dt><dd>{cacheHitRate === undefined ? '—' : `${(cacheHitRate * 100).toFixed(1)}%`}</dd></dl>
  </section>} />
}
