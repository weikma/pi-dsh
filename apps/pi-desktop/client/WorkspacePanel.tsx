/** Project-scoped tabs reuse the retained docking surface and preserve live terminal/browser bodies. */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DockController, DockLayout, findTabPane, type DockLabels, type TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { Button, Tooltip, FileTypeIcon, IconCloseOutlineRegular, IconFolderOpenOutlineRegular, IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Project } from './http.ts'
import type { T } from './i18n.ts'
import { ProjectFiles, FilePreviewTab } from './WorkspaceFiles.tsx'
import { BrowserTab } from './BrowserTab.tsx'
import css from './WorkspacePanel.module.css'
import shell from './App.module.css'

interface Props {
  visible: boolean; interactive: boolean; cwd: string; projects: Project[]; request: { cwd: string; path: string; revision: number } | null
  refresh: number; t: T; shortcutKeys: string[]; close(): void; chooseProject(): void; feedback(text: string): void
}

/** The original sidebar guide's compass, shared by the welcome panel and its tab. */
function Compass({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" /><path d="M10.61 5.39 8.99 8.99 5.39 10.61 7.01 7.01Z" fill="currentColor" /></svg>
}
/** Terminal prompt glyph from the retained terminal sidebar presentation. */
export function TerminalIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 4 4 4-4 4m5.5 0H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const keepMounted = () => true
const TerminalTab = lazy(async () => ({ default: (await import('./TerminalTab.tsx')).TerminalTab }))

/** Keep previously visited projects alive until they are removed or the GUI closes. */
export function WorkspacePanel(props: Props) {
  const [visited, setVisited] = useState<string[]>([])
  useEffect(() => {
    if (props.visible) setVisited(current => current.includes(props.cwd) ? current : [...current, props.cwd])
  }, [props.cwd, props.visible])
  const roots = visited.filter(cwd => cwd === '' || props.projects.some(project => project.cwd === cwd))
  return <aside id="pi-workspace-panel" className={shell.preview} aria-label={props.t('workspacePanel')} aria-hidden={!props.visible} {...{ inert: props.visible ? undefined : '' }}>
    <div className={shell.previewInner}>{roots.map(cwd => <ProjectPanel key={cwd} {...props} cwd={cwd} selected={cwd === props.cwd} />)}</div>
  </aside>
}

function ProjectPanel(props: Props & { selected: boolean }) {
  const { cwd, selected, t, visible, interactive } = props
  const [controller] = useState(() => {
    const guide = (id: TabRecord['id']): TabRecord => ({ id, kind: 'guide', contentId: id, title: '' })
    const value = new DockController({ makeInitialTab: guide, makePaneTab: guide })
    value.setExpanded(true)
    return value
  })
  const { state } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const wasVisible = useRef(false)
  const hasTabs = Object.keys(state.tabs).length > 0
  useLayoutEffect(() => {
    const shown = selected && visible
    if (shown && !hasTabs) {
      if (wasVisible.current) props.close()
      else controller.addTab(controller.activeDockPaneId())
    }
    wasVisible.current = shown
  }, [selected, visible, hasTabs, controller, props.close])
  const openFile = (path: string): void => { controller.openContent(path === '.' ? { kind: 'files', contentId: cwd, title: '' } : { kind: 'file', contentId: path, title: path.split(/[/\\]/).pop() || path }) }
  useEffect(() => {
    if (!props.request || props.request.cwd !== cwd) return
    if (props.request.path === '.') controller.openContent({ kind: 'files', contentId: cwd, title: '' })
    else openFile(props.request.path)
  }, [props.request, cwd, controller])
  const labels: DockLabels = {
    emptyPane: t('newTab'), splitPane: t('splitPanel'), splitPaneDisabled: t('splitPanel'), splitPaneNarrow: t('splitPanel'),
    closeTab: t('closeTab'), addTab: t('newTab'), dockFloat: t('dockPanel'), closeFloat: t('closeTab'),
    dropZone: { center: t('moveTab'), top: t('moveTab'), bottom: t('moveTab'), left: t('moveTab'), right: t('moveTab') },
  }
  const title = (tab: TabRecord) => {
    switch (tab.kind) {
      case 'guide': return <><Compass />{t('newTab')}</>
      case 'files': return <><IconFolderOpenOutlineRegular size={16} />{t('files')}</>
      case 'terminal': return <><TerminalIcon />{t('terminal')}</>
      case 'browser': return <><IconGlobeOutlineRegular size={16} />{t('browser')}</>
      default: return <><FileTypeIcon path={tab.contentId} size={16} />{tab.title}</>
    }
  }
  const body = (tab: TabRecord) => {
    const pane = findTabPane(state, tab.id)
    const active = selected && visible && interactive && (pane?.host === 'float' || pane?.activeTabId === tab.id)
    switch (tab.kind) {
      case 'files': return <ProjectFiles cwd={cwd} refresh={props.refresh} t={t} open={openFile} />
      case 'file': return <FilePreviewTab cwd={cwd} path={tab.contentId} refresh={props.refresh} active={active} t={t} feedback={props.feedback} open={openFile} />
      case 'terminal': return <Suspense fallback={<p className={css.notice}>{t('terminalStarting')}</p>}><TerminalTab cwd={cwd} active={active} t={t} /></Suspense>
      case 'browser': return <BrowserTab cwd={cwd} active={active} t={t} />
      default: return <div className={css.guide}><Compass size={56} /><div className={css.choices}>
        {(['files', 'terminal', 'browser'] as const).map(kind => <button type="button" key={kind} className={css.choice} disabled={!cwd && kind !== 'browser'} onClick={() => {
          controller.openContent({ kind, contentId: kind === 'files' ? cwd : crypto.randomUUID(), title: '', paneId: pane?.id })
          controller.closeTab(tab.id)
        }}>
          {kind === 'files' ? <IconFolderOpenOutlineRegular size={22} /> : kind === 'terminal' ? <TerminalIcon size={22} /> : <IconGlobeOutlineRegular size={22} />}
          <span><strong>{t(kind === 'files' ? 'workspaceFiles' : kind)}</strong><small>{t(kind === 'files' ? 'workspaceFilesHint' : kind === 'terminal' ? 'terminalHint' : 'browserHint')}</small></span>
        </button>)}
        {!cwd && <Button onClick={props.chooseProject}>{t('chooseProject')}</Button>}
      </div></div>
    }
  }
  return <div className={css.project} hidden={!selected}>
    {hasTabs && <DockLayout state={state} canSplit={false} hideSplitWhenBlocked active={selected && visible} keepMounted={keepMounted} intents={controller} labels={labels} renderTab={body} renderTabTitle={title}
      chrome={<Tooltip label={t('close')} shortcutKeys={props.shortcutKeys} portal><button type="button" className={shell.iconButton} aria-label={t('close')} onClick={props.close}><IconCloseOutlineRegular size={16} /></button></Tooltip>} />}
  </div>
}
