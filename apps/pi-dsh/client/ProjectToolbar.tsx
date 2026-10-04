import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Menu, MenuItemButton, Modal, Tooltip, IconFolderOpenOutlineRegular, IconCloseOutlineRegular, IconChevronDownOutlineRegular, IconGitBranchOutlineRegular, IconPlusOutlineRegular, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type Project } from './http.ts'
import type { GitIssue, ProjectGitState } from '../git-types.ts'
import type { T } from './i18n.ts'
import { GitGraph } from './GitGraph.tsx'
import css from './ProjectToolbar.module.css'

function issueText(issue: GitIssue, t: T): string {
  switch (issue) {
    case 'invalid-name': return t('gitInvalidName')
    case 'changes-overwritten': return t('gitChangesOverwritten')
    case 'conflicts': return t('gitConflicts')
    case 'operation': return t('gitOperationInProgress')
    case 'exists': return t('gitBranchExists')
    case 'missing': return t('gitBranchMissing')
    case 'worktree': return t('gitOtherWorktree')
    case 'stale': return t('gitStale')
    case 'busy': return t('gitBusy')
    case 'failed': return t('gitChangeFailed')
  }
}

/** Draft project selection preserves its input; Git changes affect the selected local working tree. */
export function ProjectToolbar({ cwd, projects, disabled, t, locale, select, browse, changed, busyChanged, feedback }: {
  cwd: string; projects: Project[]; disabled: boolean; t: T; locale: 'en' | 'zh'
  select(cwd: string): void; browse(): void; changed(): void; busyChanged(busy: boolean): void; feedback(message: string): void
}) {
  const [menu, setMenu] = useState<'project' | 'branch' | null>(null)
  const [query, setQuery] = useState('')
  const [git, setGit] = useState<ProjectGitState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [creating, setCreating] = useState(false)
  const [graph, setGraph] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [formError, setFormError] = useState('')
  const [changing, setChanging] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const revision = useRef(0), request = useRef<AbortController>()
  const currentCwd = useRef(cwd); currentCwd.current = cwd
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    const version = ++revision.current
    request.current?.abort()
    if (!cwd) { setGit(null); setLoading(false); setLoadError(''); return }
    const controller = new AbortController(); request.current = controller
    setLoading(true); setLoadError('')
    try { const state = await api.projectGit(cwd, controller.signal); if (version === revision.current) setGit(state) }
    catch (error) { if (version === revision.current && !controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error)) }
    finally { if (version === revision.current) setLoading(false) }
  }, [cwd])
  useEffect(() => {
    setGit(null); setMenu(null); setCreating(false); setGraph(false); setQuery('')
    void refresh()
    const focused = () => { void refresh() }
    window.addEventListener('focus', focused)
    return () => { ++revision.current; request.current?.abort(); window.removeEventListener('focus', focused) }
  }, [refresh])
  useEffect(() => {
    if (!menu) { setQuery(''); return }
    const frame = requestAnimationFrame(() => { search.current?.focus() })
    return () => { cancelAnimationFrame(frame) }
  }, [menu])
  const close = () => { setMenu(null) }
  const choose = (path: string) => { close(); select(path) }
  const project = projects.find(project => project.cwd === cwd)
  const name = project?.name ?? cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
  const needle = query.trim().toLocaleLowerCase()
  const filteredProjects = projects.filter(project => `${project.name} ${project.cwd}`.toLocaleLowerCase().includes(needle))
  const repository = git?.kind === 'repository' ? git : undefined
  const branches = repository?.branches.filter(branch => branch.name.toLocaleLowerCase().includes(needle)) ?? []
  const changeBranch = async (action: 'switch' | 'create', branch: string) => {
    if (!repository || pending.current) return
    const selectedCwd = cwd
    pending.current = true; setChanging(true); busyChanged(true); setFormError('')
    try {
      const result = await api.changeGitBranch(selectedCwd, action, branch, repository.revision)
      if (result.ok) {
        feedback(t('gitSwitched', { branch: result.state.branch ?? result.state.head?.slice(0, 7) ?? '' }))
        if (currentCwd.current === selectedCwd) { setGit(result.state); setCreating(false); close(); changed() }
      } else {
        const message = issueText(result.issue, t)
        if (action === 'create' && currentCwd.current === selectedCwd) setFormError(message)
        else feedback(message)
        if (currentCwd.current === selectedCwd) void refresh()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (action === 'create' && currentCwd.current === selectedCwd) setFormError(message)
      else feedback(message)
    } finally { pending.current = false; setChanging(false); busyChanged(false) }
  }
  const searchInput = (label: string) => <div className={css.search}><Input ref={search} aria-label={label} placeholder={label} value={query} onChange={event => { setQuery(event.target.value) }} onKeyDown={event => { if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) event.stopPropagation() }} /></div>
  return <div className={css.toolbar} role="group" aria-label={t('projectAndBranch')}>
    <div className={css.project} data-selected={cwd ? '' : undefined}>
      {cwd && <Tooltip label={t('clearProjectSelection')} portal side="top"><button type="button" className={css.clear} aria-label={t('clearProjectSelection')} disabled={disabled || changing} onClick={() => { choose('') }}><IconCloseOutlineRegular size={14} /></button></Tooltip>}
      <Menu open={menu === 'project'} portal side="top" align="start" onClose={close} listClassName={css.projectMenu}
        anchor={<Tooltip label={cwd || t('chooseProject')} portal side="top" disabled={menu === 'project'}><button type="button" className={css.trigger} aria-label={t('chooseProject')} aria-haspopup="menu" aria-expanded={menu === 'project'} disabled={disabled || changing} onClick={() => { setMenu(menu === 'project' ? null : 'project') }}><IconFolderOpenOutlineRegular className={css.folder} size={16} /><span>{cwd ? name : t('chooseProject')}</span><IconChevronDownOutlineRegular size={12} /></button></Tooltip>}>
        {searchInput(t('searchProjects'))}
        {filteredProjects.map(project => <MenuItemButton key={project.cwd} icon={<IconFolderOpenOutlineRegular size={16} />} onSelect={() => { choose(project.cwd) }}><span className={css.projectOption}><span>{project.name}<small>{project.cwd}</small></span>{project.cwd === cwd && <IconCheckOutlineRegular size={14} />}</span></MenuItemButton>)}
        {filteredProjects.length === 0 && <p className={css.empty}>{t('noMatchingProjects')}</p>}
        <MenuItemButton separatorBefore icon={<IconFolderOpenOutlineRegular size={16} />} onSelect={() => { close(); browse() }}>{t('openFolder')}</MenuItemButton>
        {cwd && <MenuItemButton icon={<IconCloseOutlineRegular size={14} />} onSelect={() => { choose('') }}>{t('clearProjectSelection')}</MenuItemButton>}
      </Menu>
    </div>
    {(repository || loadError) && <Menu open={menu === 'branch'} portal side="top" align="start" onClose={close} listClassName={css.branchMenu}
      anchor={<Tooltip label={t('switchGitBranch')} portal side="top" disabled={menu === 'branch'}><button type="button" className={css.trigger} aria-label={t('switchGitBranch')} aria-haspopup="menu" aria-expanded={menu === 'branch'} disabled={disabled || changing} onClick={() => { setMenu(menu === 'branch' ? null : 'branch'); if (menu !== 'branch') void refresh() }}><IconGitBranchOutlineRegular size={16} /><span>{repository?.branch ?? (repository?.head ? t('gitDetached', { commit: repository.head.slice(0, 7) }) : 'Git')}</span><IconChevronDownOutlineRegular size={12} /></button></Tooltip>}>
      {searchInput(t('searchBranches'))}
      {loadError ? <div className={css.loadError}><p>{loadError}</p><Button size="sm" onClick={() => { void refresh() }}>{t('retry')}</Button></div> : loading && !repository ? <div className={css.loading} role="status" aria-label={t('loading')}><span /></div> : <>
        {branches.map(branch => <MenuItemButton key={branch.name} disabled={changing || !branch.current && branch.worktree !== null} onSelect={() => { if (branch.current) close(); else void changeBranch('switch', branch.name) }}><span className={css.branchOption}><span>{branch.name}{branch.current && <small>{t(repository?.changedFiles ? 'gitChangedFiles' : 'gitClean', { count: repository?.changedFiles ?? 0 })}</small>}{!branch.current && branch.worktree !== null && <small>{t('gitOtherWorktree')}</small>}</span>{branch.current && <IconCheckOutlineRegular size={14} />}</span></MenuItemButton>)}
        {branches.length === 0 && <p className={css.empty}>{repository?.head === null ? t('gitNoCommits') : t('noMatchingBranches')}</p>}
      </>}
      <MenuItemButton separatorBefore icon={<IconPlusOutlineRegular size={16} />} disabled={!repository || changing} onSelect={() => { close(); setBranchName(''); setFormError(''); setCreating(true) }}>{t('createBranch')}</MenuItemButton>
      <MenuItemButton icon={<IconGitBranchOutlineRegular size={16} />} disabled={!repository || changing} onSelect={() => { close(); setGraph(true) }}>{t('gitGraph')}</MenuItemButton>
    </Menu>}
    <Modal open={creating} title={t('createBranchTitle')} description={t('createBranchDescription')} closeLabel={t('close')} onClose={() => { if (!changing) setCreating(false) }} footer={<><Button disabled={changing} onClick={() => { setCreating(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={changing || !branchName.trim()} onClick={() => { void changeBranch('create', branchName.trim()) }}>{t('createBranchSubmit')}</Button></>}>
      <form className={css.createForm} onSubmit={event => { event.preventDefault(); if (branchName.trim()) void changeBranch('create', branchName.trim()) }}><label>{t('branchName')}<Input data-modal-autofocus aria-label={t('branchName')} value={branchName} onChange={event => { setBranchName(event.target.value) }} disabled={changing} /></label>{formError && <p role="alert">{formError}</p>}</form>
    </Modal>
    <GitGraph open={graph} cwd={cwd} t={t} locale={locale} close={() => { setGraph(false) }} feedback={feedback} />
  </div>
}
