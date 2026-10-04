import { useMemo, useState } from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PiSnapshot } from '../bridge/types.ts'
import { object, string, textContent } from './records.ts'
import type { T } from './i18n.ts'
import css from './App.module.css'

/** Display every native branch without reconstructing or rewriting Pi's session files. */
export function SessionTree({ snapshot, forkOnly = false, disabled, t, navigate }: { snapshot: PiSnapshot; forkOnly?: boolean; disabled: boolean; t: T; navigate(entryId: string, action: 'navigate' | 'fork'): void }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const byId = new Map(snapshot.entries.map(entry => [string(entry.id), entry]))
    const active = new Set<string>()
    let leaf = snapshot.leafId ?? snapshot.messages.at(-1)?.entryId
    while (typeof leaf === 'string' && !active.has(leaf)) { active.add(leaf); leaf = string(byId.get(leaf)?.parentId) || undefined }
    const visible = snapshot.entries.filter(entry => entry.type === 'message' && ['user', 'assistant'].includes(string(object(entry.message).role)) || entry.type === 'branch_summary' || entry.type === 'compaction')
    const ids = new Set(visible.map(entry => string(entry.id)))
    // Pi's leaf can be a rename or settings record; highlight its closest visible ancestor.
    const current = [...active].find(id => ids.has(id))
    const children = new Map<string, typeof visible>()
    for (const entry of visible) {
      const seen = new Set<string>()
      let parent = string(entry.parentId)
      while (parent && !ids.has(parent) && !seen.has(parent)) { seen.add(parent); parent = string(byId.get(parent)?.parentId) }
      if (!ids.has(parent)) parent = ''
      const siblings = children.get(parent) ?? []
      siblings.push(entry); children.set(parent, siblings)
    }
    const result: { id: string; role: string; text: string; depth: number; active: boolean; current: boolean }[] = []
    const visited = new Set<string>()
    const visit = (parent: string, depth: number) => {
      for (const entry of children.get(parent) ?? []) {
        const id = string(entry.id)
        if (visited.has(id)) continue
        visited.add(id)
        const message = object(entry.message)
        const role = string(message.role) || string(entry.type)
        const text = textContent(message.content).trim() || string(entry.summary).trim() || (Array.isArray(message.content) ? message.content.map(block => string(object(block).name)).filter(Boolean).join(', ') : '')
        result.push({ id, role, text, depth, active: active.has(id), current: id === current })
        visit(id, depth + 1)
      }
    }
    visit('', 0)
    return result
  }, [snapshot.entries, snapshot.leafId, snapshot.messages])
  return <>
    <p className={css.setupText}>{t(forkOnly ? 'forkHint' : 'branchHint')}</p>
    <Input aria-label={t('searchHistory')} placeholder={t('searchHistory')} value={query} onChange={event => { setQuery(event.target.value) }} />
    <div className={css.tree} role="list" aria-label={t('sessionTree')}>
      {rows.filter(row => (!forkOnly || row.role === 'user') && row.text.toLowerCase().includes(query.toLowerCase())).map(row => <div className={css.treeRow} role="listitem" key={row.id} data-active-branch={row.active} data-current={row.current} style={{ paddingInlineStart: `${Math.min(row.depth, 6) * 12}px` }}>
        <StateDot state={row.active ? 'done' : 'idle'} />
        <div className={css.treeText}><small>{t(row.role === 'user' ? 'userMessage' : row.role === 'assistant' ? 'assistantMessage' : 'historySummary')}{row.current && ` · ${t('currentPosition')}`}</small><span title={row.text}>{row.text || t('emptyMessage')}</span></div>
        <div className={css.treeActions}>
          {!forkOnly && <Button size="sm" disabled={disabled} onClick={() => { navigate(row.id, 'navigate') }}>{t('continueHere')}</Button>}
          <Button size="sm" disabled={disabled} onClick={() => { navigate(row.id, 'fork') }}>{t('fork')}</Button>
        </div>
      </div>)}
      {rows.filter(row => (!forkOnly || row.role === 'user') && row.text.toLowerCase().includes(query.toLowerCase())).length === 0 && <p className={css.emptySmall}>{t('emptyResult')}</p>}
    </div>
  </>
}
