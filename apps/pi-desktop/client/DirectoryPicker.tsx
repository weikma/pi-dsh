/** Browse Host folders while preserving the caller's unsent conversation draft. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Tooltip, IconChevronUpOutlineRegular, IconChevronRightOutlineRegular, IconFolderOpenOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { api } from './http.ts'
import type { DirectoryListing } from '../local-files-types.ts'
import type { T } from './i18n.ts'
import css from './DirectoryPicker.module.css'
import shell from './App.module.css'

export function DirectoryPicker({ initialPath, hint, error, t, close, select }: {
  initialPath: string; hint?: string; error: string; t: T; close(): void; select(path: string): Promise<void>
}) {
  const [path, setPath] = useState(initialPath)
  const [listing, setListing] = useState<DirectoryListing>()
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState(false)
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState(false)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [folderError, setFolderError] = useState('')
  const [creating, setCreating] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const request = useRef<AbortController>()
  const alive = useRef(true)
  const selectingRef = useRef(false), creatingRef = useRef(false)
  const edited = useRef(false)
  const navigate = async (next?: string, initial = false): Promise<void> => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    if (!initial) { edited.current = false; setPath(next ?? ''); setQuery(''); setNewFolder(null); setFolderError('') }
    setLoading(true); setFailure(false)
    try {
      const value = await api.directories(next || undefined, controller.signal)
      if (controller.signal.aborted || !alive.current) return
      setListing(value)
      if (!edited.current) setPath(value.path)
    } catch (error) {
      if (!controller.signal.aborted && alive.current) { void error; setFailure(true) }
    } finally { if (!controller.signal.aborted && alive.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    void navigate(initialPath, true)
    return () => { alive.current = false; request.current?.abort() }
  }, [])
  const choose = async (): Promise<void> => {
    if (selectingRef.current || creatingRef.current || !path.trim()) return
    selectingRef.current = true; setSelecting(true)
    try { await select(path.trim()) }
    finally { selectingRef.current = false; if (alive.current) setSelecting(false) }
  }
  const create = async (): Promise<void> => {
    if (!listing || !newFolder?.trim() || creatingRef.current) return
    creatingRef.current = true; setCreating(true); setFolderError('')
    try {
      const result = await api.createDirectory(listing.path, newFolder)
      if (alive.current) await navigate(result.path)
    } catch (error) { if (alive.current) { void error; setFolderError(t('createFolderFailed')) } }
    finally { creatingRef.current = false; if (alive.current) setCreating(false) }
  }
  const entries = listing?.entries.filter(entry => (hidden || !entry.hidden) && entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []
  const current = listing !== undefined && listing.path === path && !loading && !failure
  const busy = creating || selecting
  return <Modal open title={t('addProject')} closeLabel={t('close')} backdropBlur={false} className={css.modal} onClose={() => { if (!busy) close() }}
    footer={<><Button disabled={busy} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !path.trim()} onClick={() => { void choose() }}>{t('openProject')}</Button></>}>
    {hint && <p className={shell.setupText}>{hint}</p>}
    <form className={css.path} onSubmit={event => { event.preventDefault(); void navigate(path) }}>
      <Input data-modal-autofocus aria-label={t('projectPath')} placeholder={t('directoryPlaceholder')} value={path} disabled={busy} onChange={event => { edited.current = true; setPath(event.target.value) }} />
      <Button disabled={busy || !path.trim()} type="submit">{t('browseDirectory')}</Button>
    </form>
    <div className={css.toolbar}>
      <Tooltip label={t('parentDirectory')} portal><button type="button" className={shell.iconButton} aria-label={t('parentDirectory')} disabled={busy || !listing?.parent || loading} onClick={() => { void navigate(listing?.parent ?? undefined) }}><IconChevronUpOutlineRegular size={16} /></button></Tooltip>
      <Button size="sm" disabled={busy} onClick={() => { void navigate(listing?.home) }}>{t('homeDirectory')}</Button>
      <span className={css.spacer} />
      <Button size="sm" disabled={busy || !current} onClick={() => { setNewFolder(''); setFolderError('') }}><IconPlusOutlineRegular size={14} />{t('newFolder')}</Button>
    </div>
    {newFolder !== null && <form className={css.path} onSubmit={event => { event.preventDefault(); void create() }}>
      <Input autoFocus aria-label={t('folderName')} placeholder={t('folderName')} value={newFolder} disabled={busy} onChange={event => { setNewFolder(event.target.value) }} />
      <Button type="submit" disabled={busy || !newFolder.trim()}>{t('createFolder')}</Button>
      <Button disabled={busy} onClick={() => { setNewFolder(null); setFolderError('') }}>{t('cancel')}</Button>
    </form>}
    {folderError && <p className={css.error} role="alert">{folderError}</p>}
    <Input type="search" aria-label={t('searchFolders')} placeholder={t('searchFolders')} value={query} disabled={busy} onChange={event => { setQuery(event.target.value) }} />
    <div className={css.folders} aria-busy={loading}>
      {loading && !listing ? <div className={shell.center}><div className={shell.spinner} role="status" aria-label={t('loading')} /></div>
        : failure ? <p className={css.notice} role="alert">{t('directoryBrowseFailed')} <Button size="sm" onClick={() => { void navigate(path) }}>{t('retry')}</Button></p>
          : <ul aria-label={t('folders')}>{entries.map(entry => <li key={entry.path}><button type="button" disabled={busy || loading} onClick={() => { void navigate(entry.path) }}>
            <IconFolderOpenOutlineRegular size={16} /><span>{entry.name}</span><IconChevronRightOutlineRegular size={14} />
          </button></li>)}</ul>}
      {!loading && !failure && entries.length === 0 && <p className={css.notice}>{t('noMatchingFolders')}</p>}
    </div>
    <div className={css.options}><label><input type="checkbox" checked={hidden} onChange={event => { setHidden(event.target.checked) }} />{t('showHiddenFolders')}</label>{listing?.truncated && <span>{t('directoryTruncated')}</span>}</div>
    {error && <p className={css.error} role="alert">{error}</p>}
  </Modal>
}
