/** Read-only tree and file tabs share the Host's project boundary checks. */
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Tooltip, PathLabel, FileTypeIcon, IconFolderOpenOutlineRegular, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type FilePreview } from './http.ts'
import type { T } from './i18n.ts'
import { FileContent } from './Conversation.tsx'
import { OfficePreview } from './OfficePreview.tsx'
import css from './WorkspacePanel.module.css'
import shell from './App.module.css'

type Directory = Extract<FilePreview, { kind: 'directory' }>
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Directory expansion never replaces the project tree; only files request new tabs. */
export function ProjectFiles({ cwd, refresh, t, open }: { cwd: string; refresh: number; t: T; open(path: string): void }) {
  const [folders, setFolders] = useState<Record<string, Directory>>({})
  const [expanded, setExpanded] = useState(new Set<string>())
  const [pending, setPending] = useState(new Set<string>())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const requests = useRef(new Map<string, AbortController>())
  const rootKey = '.'
  const load = async (path: string): Promise<void> => {
    requests.current.get(path)?.abort()
    const request = new AbortController(); requests.current.set(path, request)
    setPending(current => new Set(current).add(path)); setErrors(current => ({ ...current, [path]: '' }))
    try {
      const file = await api.file(null, path, cwd, request.signal)
      if (!request.signal.aborted) {
        if (file.kind !== 'directory') throw new Error(t('directoryChanged'))
        setFolders(current => ({ ...current, [path]: file }))
      }
    } catch (error) { if (!request.signal.aborted) setErrors(current => ({ ...current, [path]: message(error) })) }
    finally {
      if (requests.current.get(path) === request) {
        requests.current.delete(path); setPending(current => { const next = new Set(current); next.delete(path); return next })
      }
    }
  }
  useEffect(() => {
    setFolders(current => Object.fromEntries(Object.entries(current).filter(([path]) => path === rootKey || expanded.has(path))))
    void load(rootKey)
    for (const path of expanded) void load(path)
    return () => { for (const request of requests.current.values()) request.abort(); requests.current.clear() }
  }, [cwd, refresh, revision])
  const toggle = (path: string): void => {
    if (!expanded.has(path) && !folders[path]) void load(path)
    setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })
  }
  const filter = query.trim().toLocaleLowerCase()
  const matches = (entry: Directory['entries'][number]): boolean => entry.name.toLocaleLowerCase().includes(filter) || entry.kind === 'directory' && (folders[entry.path]?.entries.some(matches) ?? false)
  const tree = (path: string, depth: number) => {
    const directory = folders[path]
    const entries = directory?.entries.filter(matches) ?? []
    return <ul className={css.group} aria-label={path === rootKey ? t('workspaceFiles') : path}>
      {entries.map(entry => <li key={entry.path}>
        <button type="button" className={css.row} style={{ paddingLeft: 8 + depth * 18 }} aria-expanded={entry.kind === 'directory' ? expanded.has(entry.path) : undefined} onClick={() => { if (entry.kind === 'directory') toggle(entry.path); else open(entry.path) }}>
          <span className={css.chevron} data-expanded={expanded.has(entry.path)}>{entry.kind === 'directory' && <IconChevronDownOutlineRegular size={12} />}</span>
          {entry.kind === 'directory' ? <IconFolderOpenOutlineRegular size={16} /> : <FileTypeIcon path={entry.name} size={16} />}<span>{entry.name}</span>
        </button>
        {entry.kind === 'directory' && expanded.has(entry.path) && tree(entry.path, depth + 1)}
      </li>)}
      {pending.has(path) && !directory && <li className={css.notice} role="status">{t('loading')}</li>}
      {errors[path] && <li className={css.notice} role="alert">{errors[path]} <Button size="sm" onClick={() => { void load(path) }}>{t('retry')}</Button></li>}
      {directory && !pending.has(path) && !errors[path] && entries.length === 0 && <li className={css.notice}>{t(filter ? 'noMatchingFiles' : 'emptyDirectory')}</li>}
      {directory?.truncated && <li className={css.notice}>{t('directoryTruncated')}</li>}
    </ul>
  }
  return <div className={css.body}>
    <div className={css.toolbar}><PathLabel className={css.path} path={folders[rootKey]?.path ?? cwd} /><Tooltip label={t('refreshFiles')} portal><button type="button" className={shell.iconButton} disabled={pending.size > 0} aria-label={t('refreshFiles')} onClick={() => { setRevision(value => value + 1) }}><IconRefreshOutlineRegular size={16} /></button></Tooltip></div>
    <label className={css.search}><IconSearchOutlineRegular size={16} /><input type="search" aria-label={t('searchFiles')} placeholder={t('searchFiles')} value={query} onChange={event => { setQuery(event.target.value) }} /></label>
    <div className={css.tree}>{tree(rootKey, 0)}</div>
  </div>
}

/** One independently reloadable preview, retaining native editor and download actions. */
export function FilePreviewTab({ cwd, path, refresh, active, t, feedback, open }: { cwd: string; path: string; refresh: number; active: boolean; t: T; feedback(text: string): void; open(path: string): void }) {
  const [file, setFile] = useState<FilePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [menu, setMenu] = useState(false)
  useEffect(() => { if (!active) setMenu(false) }, [active])
  useEffect(() => {
    const request = new AbortController()
    setLoading(true); setError('')
    void api.file(null, path, cwd, request.signal).then(value => { if (!request.signal.aborted) setFile(value) })
      .catch(reason => { if (!request.signal.aborted) setError(message(reason)) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => { request.abort() }
  }, [cwd, path, refresh, revision])
  const native = window.piDesktop?.openFile
  const target = file?.path ?? path
  const nativeAction = (action: 'editor' | 'chooseEditor' | 'system' | 'reveal'): void => {
    setMenu(false)
    if (native) void native({ cwd, path: target, action }).catch(reason => { feedback(message(reason)) })
  }
  return <div className={css.body}>
    <div className={css.toolbar}><PathLabel path={target} className={css.path} />
      <Tooltip label={t('refreshFiles')} portal><button type="button" className={shell.iconButton} disabled={loading} aria-label={t('refreshFiles')} onClick={() => { setRevision(value => value + 1) }}><IconRefreshOutlineRegular size={16} /></button></Tooltip>
      {native ? <><Button size="sm" onClick={() => { nativeAction('editor') }}>{t('openInEditor')}</Button><Menu portal align="end" open={menu} onClose={() => { setMenu(false) }} anchor={<button type="button" className={shell.iconButton} aria-label={t('fileActions')} aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(value => !value) }}><IconChevronDownOutlineRegular size={14} /></button>}
        items={[{ id: 'chooseEditor', label: t('chooseEditor') }, { id: 'system', label: t('openWithSystem') }, { id: 'reveal', label: t('revealFile') }, { id: 'copy', label: t('copyPath') }]}
        onSelect={id => { if (id === 'copy') { setMenu(false); void navigator.clipboard.writeText(target).then(() => { feedback(t('copied')) }).catch(reason => { feedback(message(reason)) }) } else if (id === 'chooseEditor' || id === 'system' || id === 'reveal') nativeAction(id) }} /></> : <a href={'/api/file-download?' + new URLSearchParams({ cwd, path: target })} download>{t('downloadFile')}</a>}
    </div>
    {error && <p className={css.notice} role="alert">{error} <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></p>}
    <div className={`${css.content} ${file?.kind === 'spreadsheet' || file?.kind === 'document' ? css.richPreview : ''}`}>
      {loading ? <div className={shell.center}><div className={shell.spinner} role="status" aria-label={t('loading')} /></div>
        : file?.kind === 'file' ? <FileContent path={file.path} content={file.content} t={t} />
          : file?.kind === 'document' || file?.kind === 'spreadsheet' ? <OfficePreview file={file} t={t} feedback={feedback} />
            : file?.kind === 'image' ? <img className={shell.fileImage} src={file.url} alt={target.split(/[/\\]/).pop()} />
              : file?.kind === 'binary' ? <p className={css.notice}>{t('binaryPreview')}</p>
                : file?.kind === 'directory' ? <p className={css.notice}>{t('directoryChanged')} <Button size="sm" onClick={() => { open('.') }}>{t('workspaceFiles')}</Button></p> : null}
      {file && 'truncated' in file && file.truncated && <p className={css.notice}>{t('truncated')}</p>}
    </div>
  </div>
}
