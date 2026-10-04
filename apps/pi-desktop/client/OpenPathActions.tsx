/** File and project opening share Host capabilities; downloads remain available in both carriers. */
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Tooltip, IconChevronDownOutlineRegular, type MenuEntry, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileActionRequest, LocalApplicationsView } from '../local-files-types.ts'
import { api } from './http.ts'
import type { T } from './i18n.ts'
import shell from './App.module.css'
import css from './OpenPathActions.module.css'

export function OpenPathActions({ cwd, path, directory = false, active = true, t, feedback }: {
  cwd: string; path: string; directory?: boolean; active?: boolean; t: T; feedback(message: string): void
}) {
  const [applications, setApplications] = useState<LocalApplicationsView>()
  const [lookupFailed, setLookupFailed] = useState(false)
  const [menu, setMenu] = useState(false)
  const [choosingEditor, setChoosingEditor] = useState(false)
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const request = useRef<AbortController>()
  const alive = useRef(true)
  const download = useRef<HTMLAnchorElement>(null)
  const load = async (): Promise<void> => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLookupFailed(false)
    try {
      const value = await api.localApplications(controller.signal)
      if (!controller.signal.aborted && alive.current) setApplications(value)
    } catch (error) { if (!controller.signal.aborted && alive.current) { void error; setLookupFailed(true) } }
  }
  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false; request.current?.abort() }
  }, [cwd])
  useEffect(() => { if (!active) setMenu(false) }, [active])
  const run = async (action: FileActionRequest): Promise<void> => {
    if (operation.current) return
    operation.current = true; setBusy(true); setMenu(false)
    try {
      const result = await api.openPath(action)
      if (alive.current) {
        if (result.status === 'opened') feedback(t('fileOpenRequested'))
        await load()
      }
    } catch (error) {
      if (alive.current) { void error; feedback(t('openApplicationFailed')); void load() }
    } finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  const available = applications?.available === true
  const editorChoices: MenuItem[] = applications?.applications.filter(app => app.kind === 'editor').map(app => ({ id: 'application:' + app.id, label: app.name })) ?? []
  if (applications?.canChooseEditor) editorChoices.push({ id: 'chooseEditor', label: t('browseApplications') })
  const items: MenuEntry[] = []
  if (available) {
    if (directory) {
      items.push({ id: 'reveal', label: t('openInFileManager') }, { type: 'separator', id: 'applications' })
      for (const kind of ['editor', 'terminal'] as const) {
        const choices = applications.applications.filter(app => app.kind === kind)
        if (choices.length) items.push({ type: 'label', id: kind, text: t(kind === 'editor' ? 'editorApplications' : 'terminalApplications') }, ...choices.map(app => ({ id: 'application:' + app.id, label: app.name })))
      }
      if (applications.canChooseEditor) items.push({ id: 'chooseEditor', label: t('browseApplications') })
    } else {
      if (editorChoices.length) items.push({ id: 'editors', label: t('chooseEditor') })
      items.push({ id: 'system', label: t('openWithSystem') }, { id: 'reveal', label: t('revealFile') })
    }
    items.push({ type: 'separator', id: 'local-actions' })
  }
  if (lookupFailed) items.push({ id: 'retry', label: t('retryApplications') })
  items.push({ id: 'copy', label: t('copyPath') })
  if (!directory) items.push({ id: 'download', label: t('downloadFile') })
  const select = (id: string): void => {
    if (id === 'editors') { setChoosingEditor(true); return }
    if (id === 'back') { setChoosingEditor(false); return }
    setMenu(false); setChoosingEditor(false)
    if (id === 'copy') { void navigator.clipboard.writeText(path).then(() => { feedback(t('copied')) }).catch(() => { feedback(t('copyFailed')) }); return }
    if (id === 'download') { download.current?.click(); return }
    if (id === 'retry') { void load(); return }
    if (id === 'editor' || id === 'chooseEditor' || id === 'system' || id === 'reveal') { void run({ cwd, path, action: id }); return }
    const application = applications?.applications.find(app => 'application:' + app.id === id)
    if (application) void run({ cwd, path, action: 'application', applicationId: application.id })
  }
  const canEdit = available && Boolean(applications.editorName || editorChoices.length)
  return <div className={css.actions}>
    {!directory && canEdit && <Button size="sm" disabled={busy} onClick={() => {
      if (applications.editorName || applications.canChooseEditor) select('editor')
      else { setChoosingEditor(true); setMenu(true) }
    }}>{t('openInEditor')}</Button>}
    <Menu portal align="end" open={menu} onClose={() => { setMenu(false); setChoosingEditor(false) }} items={choosingEditor ? [{ id: 'back', label: t('backToFileActions') }, ...editorChoices] : items} onSelect={select}
      anchor={directory ? <Button size="sm" disabled={busy} aria-label={t('openInApplication')} aria-haspopup="menu" aria-expanded={menu} onClick={() => { setChoosingEditor(false); setMenu(value => !value) }}>{t('openInApplication')}<IconChevronDownOutlineRegular size={12} /></Button>
        : <Tooltip label={t('fileActions')} portal><button type="button" className={shell.iconButton} disabled={busy} aria-label={t('fileActions')} aria-haspopup="menu" aria-expanded={menu} onClick={() => { setChoosingEditor(false); setMenu(value => !value) }}><IconChevronDownOutlineRegular size={14} /></button></Tooltip>} />
    {!directory && <a ref={download} className={css.download} href={'/api/file-download?' + new URLSearchParams({ cwd, path })} download tabIndex={-1} aria-hidden="true">{t('downloadFile')}</a>}
  </div>
}
