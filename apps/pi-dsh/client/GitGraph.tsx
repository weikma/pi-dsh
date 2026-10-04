import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { api } from './http.ts'
import type { GitCommit } from '../git-types.ts'
import type { T } from './i18n.ts'
import css from './GitGraph.module.css'

/** Lay out visible commit ancestry; unloaded parents continue into the next page. */
function graphRows(commits: GitCommit[]) {
  let lanes: string[] = []
  return commits.map(commit => {
    let column = lanes.indexOf(commit.id)
    if (column < 0) { column = lanes.length; lanes.push(commit.id) }
    const before = [...lanes]
    lanes.splice(column, 1)
    for (const parent of [...commit.parents].reverse()) if (!lanes.includes(parent)) lanes.splice(column, 0, parent)
    const lines = before.flatMap((id, from) => id === commit.id ? [] : [{ from, to: lanes.indexOf(id), parent: false }])
    for (const parent of commit.parents) lines.push({ from: column, to: lanes.indexOf(parent), parent: true })
    return { commit, column, lines, columns: Math.max(before.length, lanes.length, 1) }
  })
}

/** Read-only graph of local and already-fetched refs, with paged history and commit metadata. */
export function GitGraph({ open, cwd, t, locale, close, feedback }: { open: boolean; cwd: string; t: T; locale: 'en' | 'zh'; close(): void; feedback(message: string): void }) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const request = useRef<AbortController>(), revision = useRef(0)
  const load = async (skip: number) => {
    const version = ++revision.current
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    try {
      const page = await api.gitGraph(cwd, skip, controller.signal)
      if (version !== revision.current) return
      setCommits(current => skip === 0 ? page.commits : [...current, ...page.commits.filter(commit => !current.some(value => value.id === commit.id))])
      setHasMore(page.hasMore)
      if (skip === 0) setSelected(null)
    } catch (error) { if (version === revision.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (version === revision.current) setLoading(false) }
  }
  useEffect(() => {
    if (open) { setCommits([]); setSelected(null); void load(0) }
    return () => { ++revision.current; request.current?.abort() }
  }, [open, cwd])
  const rows = useMemo(() => graphRows(commits), [commits])
  const width = Math.max(40, ...rows.map(row => row.columns * 18 + 16))
  const chosen = commits.find(commit => commit.id === selected)
  const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <Modal open={open} title={t('gitGraph')} description={t('gitGraphDescription')} closeLabel={t('close')} onClose={close} className={css.dialog} contentClassName={css.content}>
    <div className={css.toolbar}><span>{cwd}</span><Button size="sm" disabled={loading} icon={<IconRefreshOutlineRegular size={14} />} onClick={() => { void load(0) }}>{t('refresh')}</Button></div>
    {error && <div className={css.error} role="alert">{error}<Button size="sm" disabled={loading} onClick={() => { void load(commits.length) }}>{t('retry')}</Button></div>}
    <div className={css.table} role="region" aria-label={t('gitGraph')}>
      <div className={css.row + ' ' + css.head}><span style={{ width }}>{t('gitGraphColumn')}</span><span>{t('gitSubject')}</span><span>{t('gitDate')}</span><span>{t('gitAuthor')}</span><span>{t('gitCommit')}</span></div>
      {rows.map(({ commit, column, lines }) => <button type="button" key={commit.id} className={css.row} aria-pressed={commit.id === selected} onClick={() => { setSelected(commit.id) }}>
        <svg width={width} height={44} viewBox={`0 0 ${width} 44`} aria-hidden="true" className={css.graph}>
          {lines.map((line, index) => <path key={index} d={`M${line.from * 18 + 12} ${line.parent ? 22 : 0} L${line.to * 18 + 12} 44`} fill="none" stroke="currentColor" strokeWidth={1.3} />)}
          <path d={`M${column * 18 + 12} 0V22`} stroke="currentColor" strokeWidth={1.3} />
          <circle cx={column * 18 + 12} cy={22} r={3.5} />
        </svg>
        <span className={css.subject}>{commit.refs && <small>{commit.refs}</small>}{commit.subject}</span><span>{date(commit.timestamp)}</span><span>{commit.author}</span><code>{commit.id.slice(0, 7)}</code>
      </button>)}
      {loading && <div className={css.loading} role="status" aria-label={t('loading')}><span /></div>}
      {!loading && !error && commits.length === 0 && <p className={css.empty}>{t('gitNoCommits')}</p>}
      {hasMore && <div className={css.more}><Button disabled={loading} onClick={() => { void load(commits.length) }}>{t('gitLoadMore')}</Button></div>}
    </div>
    {chosen && <div className={css.details}><dl>{[[t('gitSubject'), chosen.subject], [t('gitCommit'), chosen.id], [t('gitAuthor'), chosen.author], [t('gitDate'), date(chosen.timestamp)], [t('gitParents'), chosen.parents.map(id => id.slice(0, 7)).join(', ') || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><Button size="sm" onClick={() => { void navigator.clipboard.writeText(chosen.id).then(() => { feedback(t('copied')) }).catch(error => { feedback(error instanceof Error ? error.message : String(error)) }) }}>{t('copyCommit')}</Button></div>}
  </Modal>
}
