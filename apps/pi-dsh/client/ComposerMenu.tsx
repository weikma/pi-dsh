/** Composer actions and project path references, with no hidden file-content expansion. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import clsx from 'clsx'
import { MenuSurface, Input, Button, FileTypeIcon, useAnchoredMaxHeight, IconChevronLeftOutlineRegular, IconFolderOpenOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type FilePreview } from './http.ts'
import { matchSlashCommands, type SlashCommand } from './slash-commands.ts'
import { slashIcons } from './SlashCommandInput.tsx'
import type { T } from './i18n.ts'
import css from './SlashCommandInput.module.css'
import own from './ComposerMenu.module.css'

/** The selected path stays visible in the draft, using Pi TUI's @path completion convention. */
export function fileReference(path: string): string {
  return '@' + (/\s|["\\]/u.test(path) ? JSON.stringify(path) : path)
}

export function ComposerMenu({ anchor, cwd, commands, suggestedNames, t, close, chooseProject, attachImages, reference, chooseCommand }: {
  anchor: RefObject<HTMLButtonElement>; cwd: string; commands: SlashCommand[]; suggestedNames: string[]; t: T
  close(focus?: boolean): void; chooseProject(): void; attachImages(): void; reference(path: string): void; chooseCommand(command: SlashCommand): void
}) {
  const [page, setPage] = useState<'actions' | 'files'>('actions')
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [directory, setDirectory] = useState<Extract<FilePreview, { kind: 'directory' }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const surface = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const id = useId()
  const folder = query.includes('/') ? query.slice(0, query.lastIndexOf('/') + 1) : ''
  const needle = query.slice(folder.length).toLocaleLowerCase()
  const [topMargin, setTopMargin] = useState(60)
  useLayoutEffect(() => {
    const fit = () => { setTopMargin((anchor.current?.closest('main')?.querySelector('header')?.getBoundingClientRect().bottom ?? 52) + 8) }
    fit(); window.addEventListener('resize', fit)
    input.current?.focus()
    return () => { window.removeEventListener('resize', fit) }
  }, [anchor])
  const maxHeight = useAnchoredMaxHeight(surface, 400, [page, query, directory, loading], topMargin)
  useEffect(() => {
    mounted.current = true
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !surface.current?.contains(event.target) && !anchor.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { mounted.current = false; document.removeEventListener('pointerdown', outside, true) }
  }, [anchor, close])
  useEffect(() => {
    if (page !== 'files') return
    const controller = new AbortController()
    setLoading(true); setError(''); setDirectory(null)
    void api.file(null, folder || '.', cwd, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        if (value.kind !== 'directory') throw new Error(t('referenceFolderRequired'))
        setDirectory(value)
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [page, folder, cwd, retry, t])
  const change = (value: string) => { setQuery(value); setHighlight(0) }
  const selectPath = async (path: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const target = await api.fileTarget(cwd, path)
      if (!mounted.current) return
      if (target.directory) { change(target.path.slice(target.root.length + 1).replaceAll('\\', '/') + '/'); return }
      reference(fileReference(target.path.slice(target.root.length + 1).replaceAll("\\", "/")))
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const matches = page === 'actions' ? matchSlashCommands(commands, query.replace(/^\//u, ''), suggestedNames) : []
  const actions = [
    { id: 'file', label: t('referenceFiles'), description: t('referenceFilesHint'), run: () => { if (!cwd) { close(false); chooseProject() } else { setPage('files'); change(''); input.current?.focus() } } },
    { id: 'images', label: t('addImage'), description: t('attachImagesHint'), run: attachImages },
  ].filter(item => !query || `${item.label} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const rows = page === 'files'
    ? (directory?.entries ?? []).filter(item => item.name.toLocaleLowerCase().includes(needle)).map(item => ({ id: item.path, label: item.name, description: item.kind === 'directory' ? t('referenceFolder') : '', icon: item.kind === 'directory' ? <IconFolderOpenOutlineRegular size={14}/> : <FileTypeIcon path={item.name} size={14}/>, run: () => { void selectPath(item.path) } }))
    : [...actions.map(item => ({ ...item, icon: item.id === 'file' ? <IconFolderOpenOutlineRegular size={14}/> : <IconPlusOutlineRegular size={14}/> })), ...matches.map(command => { const Icon = slashIcons[command.icon]; return { id: '/' + command.name, label: command.label, description: '/' + command.name + ' · ' + command.description, icon: <Icon size={14}/>, run: () => { chooseCommand(command) } } })]
  const selected = Math.min(highlight, Math.max(0, rows.length - 1))
  useEffect(() => { document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' }) }, [selected, id])
  return <MenuSurface ref={surface} className={css.menu} style={{ maxHeight }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <div className={own.header}>
      {page === 'files' && <button type="button" className={own.back} aria-label={t('composerBack')} onClick={() => { setPage('actions'); change(''); setError(''); input.current?.focus() }}><IconChevronLeftOutlineRegular size={14}/></button>}
      <Input ref={input} aria-label={t(page === 'files' ? 'referenceSearch' : 'composerSearch')} placeholder={t(page === 'files' ? 'referenceSearch' : 'composerSearch')} value={query} role="combobox" aria-expanded aria-controls={id} aria-activedescendant={rows.length ? `${id}-${selected}` : undefined} onChange={event => { change(event.target.value) }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) { event.preventDefault(); setHighlight((selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length) }
        if (event.key === 'Enter') { event.preventDefault(); if (!busy && !loading) rows[selected]?.run() }
      }}/>
    </div>
    {page === 'files' && <div className={own.path}><span>{folder || t('projectRoot')}</span>{folder && <button type="button" onClick={() => { change(folder.replace(/[^/]+\/$/u, '')) }}>{t('parentDirectory')}</button>}</div>}
    {error && <div role="alert" className={own.notice}>{error}<Button size="sm" disabled={loading} onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div>}
    <div className={css.viewport} id={id} role="listbox" aria-label={t(page === 'files' ? 'referenceFiles' : 'composerActions')}>
      {loading ? <div className={own.loading} role="status" aria-label={t('loading')}/> : rows.map((row, index) => <button type="button" role="option" tabIndex={-1} disabled={busy} key={row.id} id={`${id}-${index}`} aria-selected={selected === index} aria-label={`${row.label} ${row.description}`.trim()} className={clsx(css.item, selected === index && css.active)} onMouseDown={event => { event.preventDefault() }} onMouseMove={() => { setHighlight(index) }} onClick={row.run}>
        <span className={css.icon}>{row.icon}</span><span className={css.name}>{row.label}</span><span className={css.description}>{row.description}</span>
      </button>)}
      {!loading && !error && !rows.length && <p className={own.empty}>{t('composerNoMatches')}</p>}
    </div>
    <div className={css.hint}>{page === 'files' ? t(directory?.truncated ? 'truncated' : 'referenceHint') : t('composerKeyboardHint')}</div>
  </MenuSurface>
}
