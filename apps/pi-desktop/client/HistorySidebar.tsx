/** Project-grouped navigation; only rename/fork call Pi, while organization stays in GUI preferences. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Input, Menu, Modal, Tooltip, IconFolderOpenOutlineRegular, IconChevronDownOutlineRegular, IconPlusOutlineRegular, IconPlusCircleOutlineRegular, IconSearchOutlineRegular, IconCloseOutlineRegular, IconEllipsisOutlineRegular, IconEditOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, IconArchiveOutlineRegular, IconUnarchiveOutlineRegular, IconBranchOutlineRegular, IconSlidersTwoOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PiSessionSummary } from '../bridge/types.ts'
import type { GuiPreferences, Project } from './http.ts'
import type { translate } from './i18n.ts'
import css from './HistorySidebar.module.css'

type Navigation = Pick<GuiPreferences, 'collapsedProjects' | 'pinnedSessions' | 'archivedSessions'>
interface Props {
  projects: Project[]
  sessions: PiSessionSummary[]
  pendingChat?: { cwd: string; name: string }
  loading: boolean
  active: boolean
  cwd: string
  selectedId?: string
  unreadChats?: ReadonlySet<string>
  navigation: Navigation
  searchRequest: number
  t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => string
  locale: 'en' | 'zh'
  addProject: () => void
  newChat: (cwd: string) => void
  openChat: (session: PiSessionSummary) => void
  saveNavigation: (value: Navigation) => Promise<void>
  projectAction: (project: Project, action: 'rename' | 'remove', name?: string) => Promise<void>
  sessionAction: (session: PiSessionSummary, action: 'rename' | 'fork', name?: string) => Promise<void>
  feedback: (text: string) => void
}

/** Shared Desktop/Web project rows, inline search, hover controls and accessible menus. */
export function HistorySidebar(props: Props) {
  const { projects, sessions, cwd, selectedId, navigation, t, locale } = props
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ kind: 'project'; value: Project; remove?: boolean } | { kind: 'session'; value: PiSessionSummary } | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const search = useRef<HTMLInputElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (!props.active) setMenu(null) }, [props.active])
  useEffect(() => { if (props.searchRequest > 0) { setSearching(true); setQuery(''); setArchived(false) } }, [props.searchRequest])
  useEffect(() => { if (searching) search.current?.focus() }, [searching, props.searchRequest])
  const closeSearch = () => { setSearching(false); setQuery(''); requestAnimationFrame(() => { searchButton.current?.focus() }) }
  const report = (reason: unknown) => { props.feedback(reason instanceof Error ? reason.message : String(reason)) }
  const toggle = (key: keyof Navigation, value: string) => {
    const previous = navigation[key] ?? []
    void props.saveNavigation({ [key]: previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value] }).catch(report)
  }
  const openEdit = (value: NonNullable<typeof edit>) => { setMenu(null); setEdit(value); setName(value.value.name); setError('') }
  const save = async () => {
    if (edit === null || pending.current || (!('remove' in edit && edit.remove) && !name.trim())) return
    pending.current = true; setSaving(true); setError('')
    try {
      if (edit.kind === 'project') await props.projectAction(edit.value, edit.remove ? 'remove' : 'rename', name.trim())
      else await props.sessionAction(edit.value, 'rename', name.trim())
      setEdit(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { pending.current = false; setSaving(false) }
  }
  const action = (label: string, icon: ReactNode, run: () => void, extra = '') => <Tooltip label={label} portal side="top" delayMs={350}><button type="button" className={clsx(css.iconButton, extra)} aria-label={label} onClick={run}>{icon}</button></Tooltip>
  const queryText = query.trim().toLocaleLowerCase()
  return <div className={css.browser}>
    <div className={css.heading}>
      {searching ? <Input ref={search} className={css.search} aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch() } }} /> : <span className={css.headingTitle}>{t(archived ? 'archivedChats' : 'projects')}</span>}
      {searching ? action(t('closeSearch'), <IconCloseOutlineRegular size={14} />, closeSearch) : <Tooltip label={t('search')} portal side="bottom" delayMs={350}><button ref={searchButton} type="button" className={css.iconButton} aria-label={t('search')} onClick={() => { setSearching(true) }}><IconSearchOutlineRegular size={16} /></button></Tooltip>}
      <Menu open={menu === 'view'} onClose={() => { setMenu(null) }} portal align="end" dense anchor={action(t('viewOptions'), <IconSlidersTwoOutlineRegular size={16} />, () => { setMenu(menu === 'view' ? null : 'view') })} selectedIds={[archived ? 'archived' : 'active']} items={[{ id: 'active', label: t('activeChats') }, { id: 'archived', label: t('archivedChats') }]} onSelect={id => { setArchived(id === 'archived'); setMenu(null) }} />
      {action(t('addProject'), <IconPlusOutlineRegular size={16} />, props.addProject)}
    </div>
    <div className={css.groups} aria-label={t('chatHistory')}>
      {projects.map(project => {
        const pending = !archived && props.pendingChat?.cwd === project.cwd && `${props.pendingChat.name} ${project.name}`.toLocaleLowerCase().includes(queryText) ? props.pendingChat : undefined
        const group = sessions.filter(session => session.cwd === project.cwd && (navigation.archivedSessions?.includes(session.path) ?? false) === archived && `${session.name} ${project.name}`.toLocaleLowerCase().includes(queryText))
          .sort((a, b) => Number(navigation.pinnedSessions?.includes(b.path) ?? false) - Number(navigation.pinnedSessions?.includes(a.path) ?? false))
        const expanded = queryText !== '' || !(navigation.collapsedProjects?.includes(project.cwd) ?? false)
        if (queryText !== '' && group.length === 0 && !pending) return null
        return <section key={project.cwd} className={css.group} aria-label={project.name}>
          <div className={clsx(css.projectRow, project.cwd === cwd && css.currentProject)}>
            <button type="button" className={css.projectButton} aria-label={project.name} aria-expanded={expanded} onClick={() => { toggle('collapsedProjects', project.cwd) }}>
              <span className={css.leading}><IconFolderOpenOutlineRegular size={16} className={css.folder} /><IconChevronDownOutlineRegular size={14} className={clsx(css.chevron, !expanded && css.closed)} /></span><span className={css.title}>{project.name}</span>
            </button>
            <div className={clsx(css.actions, menu === 'project:' + project.cwd && css.actionsOpen)}>
              <Menu open={menu === 'project:' + project.cwd} onClose={() => { setMenu(null) }} portal align="end" dense anchor={action(t('projectActions', { name: project.name }), <IconEllipsisOutlineRegular size={16} />, () => { setMenu(menu === 'project:' + project.cwd ? null : 'project:' + project.cwd) })} items={[{ id: 'rename', label: t('renameProject'), icon: <IconEditOutlineRegular size={14} /> }, { id: 'remove', label: t('removeProject') }]} onSelect={id => { openEdit({ kind: 'project', value: project, remove: id === 'remove' }) }} />
              {action(t('newChatInProject', { name: project.name }), <IconPlusCircleOutlineRegular size={16} />, () => { props.newChat(project.cwd) })}
            </div>
          </div>
          <div className={clsx(css.disclosure, !expanded && css.disclosureClosed)} aria-hidden={!expanded} {...{ inert: expanded ? undefined : '' }}>
          <div className={css.chats}>
            {pending && <div className={clsx(css.chatRow, css.selected)}><div className={css.chatButton} aria-current="page"><span className={css.title}>{pending.name}</span></div></div>}
            {group.map(session => {
              const pinned = navigation.pinnedSessions?.includes(session.path) ?? false
              return <div key={session.path} className={clsx(css.chatRow, session.id === selectedId && css.selected)}>
                <button type="button" className={css.chatButton} aria-current={session.id === selectedId ? 'page' : undefined} onClick={() => { props.openChat(session) }}>
                  {pinned && <IconPinFillRegular className={css.pin} size={12} />}<span className={css.title}>{session.name || t('untitled')}</span>
                  {props.unreadChats?.has(session.id) && <Tooltip label={t('unreadReply')} portal side="top"><span className={css.unread} role="img" aria-label={t('unreadReply')} /></Tooltip>}
                </button>
                <small className={css.date}>{new Date(session.modified).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' })}</small>
                <div className={clsx(css.actions, css.chatActions, menu === session.path && css.actionsOpen)}>
                  <Menu open={menu === session.path} onClose={() => { setMenu(null) }} portal align="end" dense anchor={action(t('chatActions', { name: session.name || t('untitled') }), <IconEllipsisOutlineRegular size={16} />, () => { setMenu(menu === session.path ? null : session.path) })} items={[{ id: 'pin', label: t(pinned ? 'unpinChat' : 'pinChat'), icon: pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} /> }, { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular size={14} /> }, { id: 'fork', label: t('fork'), icon: <IconBranchOutlineRegular size={14} /> }, { id: 'archive', label: t(archived ? 'unarchiveChat' : 'archiveChat'), icon: archived ? <IconUnarchiveOutlineRegular size={14} /> : <IconArchiveOutlineRegular size={14} /> }]} onSelect={id => {
                    setMenu(null)
                    if (id === 'pin') toggle('pinnedSessions', session.path)
                    else if (id === 'rename') openEdit({ kind: 'session', value: session })
                    else if (id === 'archive') toggle('archivedSessions', session.path)
                    else void props.sessionAction(session, 'fork').catch(report)
                  }} />
                  {action(t(pinned ? 'unpinChat' : 'pinChat'), pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />, () => { toggle('pinnedSessions', session.path) })}
                  {action(t(archived ? 'unarchiveChat' : 'archiveChat'), archived ? <IconUnarchiveOutlineRegular size={14} /> : <IconArchiveOutlineRegular size={14} />, () => { toggle('archivedSessions', session.path) })}
                </div>
              </div>
            })}
            {group.length === 0 && !pending && props.loading && <div className={css.skeletons} role="status" aria-label={t('loading')}><span /><span /><span /></div>}
            {group.length === 0 && !pending && !props.loading && <p className={css.empty}>{t('noSessions')}</p>}
          </div>
          </div>
        </section>
      })}
      {projects.length === 0 && <p className={css.empty}>{t('noProjects')}</p>}
      {queryText !== '' && !(props.pendingChat && !archived && projects.some(project => project.cwd === props.pendingChat?.cwd && `${props.pendingChat.name} ${project.name}`.toLocaleLowerCase().includes(queryText))) && !sessions.some(session => projects.some(project => project.cwd === session.cwd && `${session.name} ${project.name}`.toLocaleLowerCase().includes(queryText)) && (navigation.archivedSessions?.includes(session.path) ?? false) === archived) && <p className={css.empty}>{t('noSearchResults')}</p>}
    </div>
    <Modal open={edit !== null} title={edit?.kind === 'project' ? t(edit.remove ? 'removeProject' : 'renameProject') : t('rename')} closeLabel={t('close')} backdropBlur={false} onClose={() => { if (!saving) setEdit(null) }} footer={<><Button disabled={saving} onClick={() => { setEdit(null) }}>{t('cancel')}</Button><Button variant="primary" disabled={saving || (!(edit?.kind === 'project' && edit.remove) && name.trim() === '')} onClick={() => { void save() }}>{t(edit?.kind === 'project' && edit.remove ? 'removeProject' : 'save')}</Button></>}>
      {edit?.kind === 'project' && edit.remove ? <p className={css.explanation}>{t('removeProjectDetail', { name: edit.value.name })}</p> : <form onSubmit={event => { event.preventDefault(); void save() }}><Input data-modal-autofocus aria-label={t('resourceName')} value={name} onChange={event => { setName(event.target.value) }} disabled={saving} /></form>}
      {error && <p role="alert" className={css.explanation}>{error}</p>}
    </Modal>
  </div>
}
