/** Full settings workspace backed by native Pi configuration and retained GUI primitives. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Tooltip, IconChevronLeftOutlineRegular, IconSettingsOutlineRegular, IconApiOutlineRegular, IconFolderOpenOutlineRegular, IconCodeOutlineRegular, IconSkillOutlineRegular, IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentConfigurationAction, AgentConfigurationView, AgentPreferences, AgentResource, ConfigurationScope, ResourceDocument, ResourceKind } from '../bridge/agent-types.ts'
import type { ProviderInventory, ProviderModel } from '../bridge/provider-types.ts'
import { api } from './http.ts'
import { ProvidersPanel } from './ProvidersPanel.tsx'
import { NativeSelect } from './NativeSelect.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { ExtensionsPanel } from './ExtensionsPanel.tsx'
import type { T, Locale } from './i18n.ts'
import { CODE_FONT_RANGE, UI_FONT_RANGE, LIGHT_CODE_THEMES, DARK_CODE_THEMES, type TextAppearance } from '../appearance.ts'
import css from './SettingsPanel.module.css'

type Section = 'general' | 'appearance' | 'models' | 'agent' | ResourceKind | 'mcp' | 'runtime' | 'shortcuts'
const sectionKeys = { general: 'generalSettings', appearance: 'appearance', models: 'modelSetup', agent: 'agentSettings', skills: 'skillsSettings', prompts: 'commandsSettings', instructions: 'instructionsSettings', extensions: 'extensionsSettings', mcp: 'mcpSettings', runtime: 'runtime', shortcuts: 'shortcutsSettings' } as const

const CODE_THEME_LABELS = { 'github-light': 'codeThemeGithubLight', 'github-dark': 'codeThemeGithubDark', 'light-plus': 'codeThemeLightPlus', 'dark-plus': 'codeThemeDarkPlus', 'solarized-light': 'codeThemeSolarizedLight', 'solarized-dark': 'codeThemeSolarizedDark', nord: 'codeThemeNord' } as const

function FontSize({ label, value, range, change }: { label: string; value: number; range: { min: number; max: number }; change(value: number): void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const number = Number(draft)
    if (draft.trim() !== '' && Number.isInteger(number) && number >= range.min && number <= range.max) change(number)
    else setDraft(String(value))
  }
  return <div className={css.fontSize}><Input type="number" aria-label={label} min={range.min} max={range.max} step={1} value={draft} onChange={event => { const next = event.target.value; setDraft(next); const number = Number(next); if (next !== '' && Number.isInteger(number) && number >= range.min && number <= range.max) change(number) }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><span aria-hidden>px</span></div>
}

function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className={css.row}><div className={css.rowText}><div className={css.rowTitle}>{title}</div>{detail && <p>{detail}</p>}</div><div className={css.control}>{children}</div></div>
}
function Toggle({ label, checked, disabled, change }: { label: string; checked: boolean; disabled?: boolean; change(value: boolean): void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} aria-disabled={disabled || undefined} className={css.toggle} onClick={() => { if (!disabled) change(!checked) }}><span /></button>
}

/** Settings keep writes scoped to Pi's selected agent directory or the selected registered project. */
export function SettingsPanel({ t, close, locale, setLocale, appearance, setAppearance, textAppearance, setTextAppearance, cwd, runtimeContent, inventory, inventoryLoading, inventoryError, sessionModels, refreshInventory, providerChanged, feedback, reload, reloadDisabled, selectSessionModel, modelActions, initialSection = 'general' }: {
  t: T; close(): void; locale: Locale; setLocale(value: Locale): void; appearance: 'light' | 'dark' | 'system'; setAppearance(value: 'light' | 'dark' | 'system'): void
  textAppearance: TextAppearance; setTextAppearance(value: TextAppearance): void
  cwd: string; runtimeContent: ReactNode; inventory: ProviderInventory | null; inventoryLoading: boolean; inventoryError: string; sessionModels?: readonly ProviderModel[]
  refreshInventory(): Promise<void>; providerChanged(): Promise<void>; feedback(message: string): void; reload(): Promise<void>; reloadDisabled: boolean
  selectSessionModel?(model: ProviderModel): Promise<void>
  modelActions?: ReactNode
  initialSection?: 'general' | 'models' | 'extensions' | 'skills'
}) {
  const [section, setSection] = useState<Section>(initialSection)
  const [view, setView] = useState<AgentConfigurationView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<ConfigurationScope>('user')
  const [document, setDocument] = useState<ResourceDocument | null>(null)
  const [edited, setEdited] = useState('')
  const [creating, setCreating] = useState(false)
  const [resourceDraft, setResourceDraft] = useState({ name: '', description: '', content: '' })
  const [mcpDraft, setMcpDraft] = useState({ name: '', transport: 'http', url: '', command: '', args: '[]' })
  const [modelOpen, setModelOpen] = useState(false)
  const [changed, setChanged] = useState(false)
  const [trustPrompt, setTrustPrompt] = useState(false)
  const [leaving, setLeaving] = useState<Section | 'close' | null>(null)
  const revision = useRef(0)
  const pending = useRef(false)
  const editorRevision = useRef(0)
  const contentRef = useRef<HTMLElement>(null)
  const failure = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
  const refresh = async () => {
    const current = ++revision.current
    setLoading(true); setError('')
    try { const value = await api.agentConfiguration(cwd || undefined); if (revision.current === current) setView(value) }
    catch (reason) { if (revision.current === current) setError(failure(reason)) }
    finally { if (revision.current === current) setLoading(false) }
  }
  useEffect(() => { void refresh(); return () => { revision.current++ } }, [cwd])
  useEffect(() => { if (section === 'models') void refreshInventory() }, [section])
  const update = async (action: AgentConfigurationAction) => {
    if (pending.current || loading) return false
    pending.current = true; setBusy(true); setError('')
    try {
      const value = await api.updateAgentConfiguration(action, cwd || undefined)
      setView(value); setChanged(true); feedback(t('settingsSaved')); return true
    } catch (reason) { setError(failure(reason)); return false }
    finally { pending.current = false; setBusy(false) }
  }
  const navigate = (next: Section) => { editorRevision.current++; setSection(next); setSearch(''); setCreating(false); setDocument(null); if(view) setError(''); contentRef.current?.scrollTo?.({ top: 0 }) }
  const dirty = document !== null && edited !== document.content || creating && (resourceDraft.name !== '' || resourceDraft.description !== '' || resourceDraft.content !== '' || mcpDraft.name !== '' || mcpDraft.url !== '' || mcpDraft.command !== '')
  const select = (next: Section) => { if (busy) return; if (dirty) setLeaving(next); else navigate(next) }
  const requestClose = () => { if (busy) return; if (dirty) setLeaving('close'); else close() }
  const preference = (values: Partial<AgentPreferences>) => { void update({ action: 'preferences', values }) }
  const chooseModel = async (model: ProviderModel) => {
    if (await update({ action: 'preferences', values: { defaultProvider: model.provider, defaultModel: model.id } })) { setModelOpen(false); await refreshInventory() }
  }
  const edit = async (item: AgentResource) => {
    const current = ++editorRevision.current
    setBusy(true); setError('')
    try { const value = await api.resourceDocument(item.id, cwd || undefined); if(current === editorRevision.current) { setDocument(value); setEdited(value.content) } }
    catch (reason) { if(current === editorRevision.current) setError(failure(reason)) }
    finally { setBusy(false) }
  }
  const nativeSetup = async () => {
    try {
      if (window.piDesktop?.openPiTerminal) await window.piDesktop.openPiTerminal(cwd || undefined)
      else { const setup = await api.piSetup(cwd || undefined); await navigator.clipboard.writeText(setup.commandLine); feedback(t('copied')) }
    } catch (reason) { setError(failure(reason)) }
  }
  const currentResource = view?.resources.find(item => item.id === document?.id)
  const resourceSection = section === 'skills' || section === 'prompts' || section === 'instructions'
  const visibleResources = view?.resources.filter(item => item.kind === section && item.scope === scope && `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())) ?? []
  const nativeSection = section === 'agent' || resourceSection || section === 'mcp' || section === 'models' || section === 'extensions'
  const nativeReady = view !== null
  const scopeControl = <NativeSelect aria-label={t('configurationScope')} value={scope} disabled={busy || dirty} onChange={event => { setScope(event.target.value === 'project' ? 'project' : 'user'); setDocument(null); setCreating(false) }}><option value="user">{t('userScope')}</option><option value="project" disabled={!cwd}>{t('projectScope')}</option></NativeSelect>
  const resourcePanel = nativeReady && <>
        <p className={css.subtitle}>{t(section === 'instructions' ? 'instructionsHint' : section === 'skills' ? 'skillsHint' : 'commandsHint')}</p>
        <div className={css.toolbar}>{scopeControl}<Input aria-label={t('searchResources')} placeholder={t('searchResources')} value={search} onChange={event => { setSearch(event.target.value) }} /><Button size="sm" disabled={busy || loading} onClick={() => { void refresh() }}>{t('refresh')}</Button>{(section === 'skills' || section === 'prompts') && <Button size="sm" variant="primary" disabled={busy || loading || creating || document !== null || scope === 'project' && !view?.projectTrusted} onClick={() => { setCreating(true); setResourceDraft({name:'',description:'',content:''}); setDocument(null) }}>{t('createResource')}</Button>}</div>
        {creating && (section === 'skills' || section === 'prompts') ? <form className={css.editor} onSubmit={event => { event.preventDefault(); void update({action:'create',kind:section,scope,...resourceDraft}).then(ok => { if(ok) setCreating(false) }) }}>
          <label>{t('resourceName')}<Input required pattern="[a-z][a-z0-9-]{0,63}" aria-label={t('resourceName')} placeholder="my-command" value={resourceDraft.name} onChange={event => { setResourceDraft({...resourceDraft,name:event.target.value}) }} /></label>
          <label>{t('resourceDescription')}<Input required aria-label={t('resourceDescription')} value={resourceDraft.description} onChange={event => { setResourceDraft({...resourceDraft,description:event.target.value}) }} /></label>
          <label>{t('resourceContent')}<textarea required aria-label={t('resourceContent')} value={resourceDraft.content} onChange={event => { setResourceDraft({...resourceDraft,content:event.target.value}) }} /></label><div className={css.actions}><Button disabled={busy || loading} onClick={() => { setCreating(false) }}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy || loading}>{t('save')}</Button></div>
        </form> : document ? <form className={css.editor} onSubmit={event => { event.preventDefault(); void update({action:'write',resourceId:document.id,content:edited,revision:document.revision}).then(ok => { if(ok) setDocument(null) }) }}>
          <code className={css.path}>{document.path}</code><label>{t('resourceContent')}<textarea aria-label={t('resourceContent')} readOnly={!currentResource?.editable} value={edited} onChange={event => { setEdited(event.target.value) }} /></label><div className={css.actions}><Button disabled={busy || loading} onClick={() => { setDocument(null) }}>{t('cancel')}</Button>{currentResource?.editable && <Button type="submit" variant="primary" disabled={busy || edited === document.content}>{t('save')}</Button>}</div>
        </form> : <div className={css.group}>{visibleResources.length === 0 && <div className={css.empty}><IconFolderOpenOutlineRegular size={24}/><p>{t('noResources')}</p></div>}{visibleResources.map(item => <div className={css.resource} key={item.id}><div className={css.resourceText}><button type="button" disabled={busy || item.kind === 'extensions'} onClick={() => { void edit(item) }}>{item.name}</button>{item.description && <p>{item.description}</p>}<code>{section === 'skills' ? '/skill:' + item.name + ' · ' + (view?.packages.find(pkg => pkg.id === item.packageId)?.name ?? t(item.scope === 'user' ? 'userScope' : 'projectScope')) : item.path}</code></div>{item.kind !== 'instructions' && <Toggle label={t('enableResource',{name:item.name})} checked={item.enabled} disabled={busy || loading} change={enabled => { void update({action:'toggle',resourceId:item.id,enabled}) }} />}{item.kind === 'instructions' && <Button size="sm" disabled={busy || loading} onClick={() => { void edit(item) }}>{t(item.editable ? 'editResource' : 'viewResource')}</Button>}</div>)}</div>}
      </>
  return <Modal open headless title={t('settings')} onClose={requestClose} backdropBlur={false} className={css.workspace}>
    <aside className={css.sidebar}><Button disabled={busy} data-modal-autofocus icon={<IconChevronLeftOutlineRegular size={16} />} onClick={requestClose}>{t('backToChat')}</Button>
      <nav aria-label={t('settingsSections')}>
        <p className={css.navGroup}>{t('settingsBasics')}</p>
        {(['general', 'appearance', 'models', 'agent'] as const).map(key => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { select(key) }}><IconSettingsOutlineRegular size={16} />{t(sectionKeys[key])}</button>)}
        <p className={css.navGroup}>{t('settingsCapabilities')}</p>
        {(['instructions', 'skills', 'prompts', 'mcp', 'extensions'] as const).map(key => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { select(key) }}>{key === 'skills' ? <IconSkillOutlineRegular size={16}/> : key === 'extensions' ? <IconPluginPinwheelOutlineRegular size={16}/> : <IconFolderOpenOutlineRegular size={16}/>} {t(sectionKeys[key])}</button>)}
        <p className={css.navGroup}>{t('settingsApplication')}</p>
        {(['shortcuts', 'runtime'] as const).map(key => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { select(key) }}><IconCodeOutlineRegular size={16} />{t(sectionKeys[key])}</button>)}
      </nav><span className={css.version}>{t('about')}</span>
    </aside>
    <main className={css.content} ref={contentRef}><div className={css.page}>
      <header className={css.heading}><h1>{t(sectionKeys[section])}</h1><div className={css.actions}>{nativeSection && <Tooltip label={t('configurationApplyHint')} portal side="bottom" align="end" delayMs={350} maxWidth={280}><Button size="sm" variant={changed ? 'primary' : 'ghost'} disabled={reloadDisabled || busy || loading} onClick={() => { setBusy(true); void reload().then(() => { setChanged(false); feedback(t('configurationReloaded')) }).catch(reason => { setError(failure(reason)) }).finally(() => { setBusy(false) }) }}>{t('configurationReload')}</Button></Tooltip>}<Button size="sm" disabled={busy} onClick={requestClose} aria-label={t('close')}>{t('close')}</Button></div></header>
      {nativeSection && section !== 'extensions' && section !== 'skills' && <p className={css.subtitle}>{t('nativeSettingsHint')}</p>}
      {nativeSection && error && <div role="alert" className={css.notice}>{error}<Button size="sm" disabled={loading || busy} onClick={() => { void refresh() }}>{t('retry')}</Button></div>}
      {nativeSection && loading && view === null && <div className={css.center} role="status" aria-label={t('loading')}><span className={css.spinner} /></div>}
      {(resourceSection || section === 'mcp' || section === 'extensions') && scope === 'project' && cwd && view && !view.projectTrusted && <div className={css.notice}><span>{t('projectTrustHint')}</span><Button size="sm" disabled={busy || loading} onClick={() => { setTrustPrompt(true) }}>{t('reviewProjectTrust')}</Button></div>}
      {section === 'extensions' && view && <ExtensionsPanel key="extensions" view={view} scope={scope} scopeControl={scopeControl} busy={busy || loading} error={error} t={t} update={update} refresh={refresh} nativeSetup={nativeSetup}/>}

      {section === 'general' && <><p className={css.subtitle}>{t('generalSettingsHint')}</p><div className={css.group}><Row title={t('language')} detail={t('languageHint')}><NativeSelect aria-label={t('language')} value={locale} onChange={event => { setLocale(event.target.value === 'zh' ? 'zh' : 'en') }}><option value="en">English</option><option value="zh">中文</option></NativeSelect></Row></div><div className={css.group}><Row title={t('agentSettings')} detail={t('agentSettingsHint')}><Button onClick={() => { select('agent') }}>{t('configure')}</Button></Row><Row title={t('modelSetup')} detail={t('defaultModelHint')}><Button onClick={() => { select('models') }}>{t('configure')}</Button></Row></div></>}
      {section === 'appearance' && <>
        <h2>{t('interfaceSettings')}</h2><p className={css.subtitle}>{t('interfaceSettingsHint')}</p>
        <div className={css.group}>
          <Row title={t('appTheme')} detail={t('appearanceHint')}><NativeSelect aria-label={t('appTheme')} value={appearance} onChange={event => { const value = event.target.value; if (value === 'light' || value === 'dark' || value === 'system') setAppearance(value) }}>{(['light', 'dark', 'system'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</NativeSelect></Row>
          <Row title={t('uiFontSize')} detail={t('uiFontSizeHint')}><FontSize label={t('uiFontSize')} value={textAppearance.uiFontSize} range={UI_FONT_RANGE} change={uiFontSize => { setTextAppearance({ ...textAppearance, uiFontSize }) }} /></Row>
        </div>
        <h2>{t('codeSettings')}</h2><p className={css.subtitle}>{t('codeSettingsHint')}</p>
        <div className={css.group}>
          <Row title={t('lightCodeTheme')} detail={t('lightCodeThemeHint')}><NativeSelect aria-label={t('lightCodeTheme')} value={textAppearance.lightCodeTheme} onChange={event => { const value = LIGHT_CODE_THEMES.find(theme => theme === event.target.value); if (value !== undefined) setTextAppearance({ ...textAppearance, lightCodeTheme: value }) }}>{LIGHT_CODE_THEMES.map(value => <option key={value} value={value}>{value === 'css-variables' ? t('defaultCodeTheme') : t(CODE_THEME_LABELS[value])}</option>)}</NativeSelect></Row>
          <Row title={t('darkCodeTheme')} detail={t('darkCodeThemeHint')}><NativeSelect aria-label={t('darkCodeTheme')} value={textAppearance.darkCodeTheme} onChange={event => { const value = DARK_CODE_THEMES.find(theme => theme === event.target.value); if (value !== undefined) setTextAppearance({ ...textAppearance, darkCodeTheme: value }) }}>{DARK_CODE_THEMES.map(value => <option key={value} value={value}>{value === 'css-variables' ? t('defaultCodeTheme') : t(CODE_THEME_LABELS[value])}</option>)}</NativeSelect></Row>
          <Row title={t('codeLineNumbers')} detail={t('codeLineNumbersHint')}><Toggle label={t('codeLineNumbers')} checked={textAppearance.codeLineNumbers} change={codeLineNumbers => { setTextAppearance({ ...textAppearance, codeLineNumbers }) }} /></Row>
          <Row title={t('codeWrapLines')} detail={t('codeWrapLinesHint')}><Toggle label={t('codeWrapLines')} checked={textAppearance.codeWrapLines} change={codeWrapLines => { setTextAppearance({ ...textAppearance, codeWrapLines }) }} /></Row>
          <Row title={t('codeFontSize')} detail={t('codeFontSizeHint')}><FontSize label={t('codeFontSize')} value={textAppearance.codeFontSize} range={CODE_FONT_RANGE} change={codeFontSize => { setTextAppearance({ ...textAppearance, codeFontSize }) }} /></Row>
        </div>
      </>}
      {section === 'agent' && nativeReady && view && <>
        <p className={css.subtitle}>{t('agentUserDefaultsHint')}</p>
        {view.overridden.length > 0 && <p className={css.notice}>{t('projectOverridesHint')}</p>}
        <h2>{t('reasoningAndContext')}</h2><div className={css.group}>
          <Row title={t('thinkingLevel')} detail={t('defaultThinkingHint')}><NativeSelect aria-label={t('thinkingLevel')} disabled={busy || loading} value={view.preferences.thinking} onChange={event => { preference({ thinking: event.target.value }) }}>{(['off','minimal','low','medium','high','xhigh','max'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</NativeSelect></Row>
          {(['compaction', 'retry', 'autoResize', 'blockImages', 'skillCommands'] as const).map(key => <Row key={key} title={t(key === 'retry' ? 'autoRetry' : key)} detail={t(`${key}Hint`)}><Toggle label={t(key === 'retry' ? 'autoRetry' : key)} checked={view.preferences[key]} disabled={busy || loading} change={value => { preference({ [key]: value }) }} /></Row>)}
        </div><h2>{t('messageDelivery')}</h2><div className={css.group}>{(['steering', 'followUp'] as const).map(key => <Row key={key} title={t(key === 'steering' ? 'steer' : 'followUp')} detail={t(key === 'steering' ? 'steeringDeliveryHint' : 'followUpDeliveryHint')}><NativeSelect aria-label={t(key === 'steering' ? 'steer' : 'followUp')} value={view.preferences[key]} disabled={busy || loading} onChange={event => { preference({ [key]: event.target.value === 'all' ? 'all' : 'one-at-a-time' }) }}><option value="one-at-a-time">{t('oneAtATime')}</option><option value="all">{t('allTogether')}</option></NativeSelect></Row>)}</div>
      </>}
      {section === 'models' && <>
        {modelActions}
        {view && <div className={css.group}><Row title={t('defaultModel')} detail={t('defaultModelHint')}><ModelPicker open={modelOpen} models={sessionModels ?? inventory?.models ?? []} selected={{provider:view.preferences.defaultProvider,id:view.preferences.defaultModel}} label={view.preferences.defaultModel || t('noModel')} disabled={busy || inventoryLoading} t={t} toggle={() => { setModelOpen(!modelOpen) }} close={() => { setModelOpen(false) }} select={model => { void chooseModel(model) }} /></Row></div>}
        <ProvidersPanel sessionModels={sessionModels} inventory={inventory} loading={inventoryLoading} error={inventoryError} cwd={cwd || undefined} selected={view ? { provider:view.preferences.defaultProvider,id:view.preferences.defaultModel } : undefined} t={t} refresh={refreshInventory} changed={providerChanged} selectModel={selectSessionModel ?? chooseModel} feedback={feedback} />
      </>}
      {section === 'skills' && view && <ExtensionsPanel key="skills" kind="skill" view={view} scope={scope} scopeControl={scopeControl} busy={busy || loading} error={error} t={t} update={update} refresh={refresh} nativeSetup={nativeSetup} resourceContent={resourcePanel}/>}
      {resourceSection && section !== 'skills' && resourcePanel}
      {section === 'mcp' && nativeReady && <>
        <p className={css.subtitle}>{t('mcpHint')}</p><p className={css.subtitle}>{t('mcpOverrideHint')}</p><div className={css.toolbar}>{scopeControl}<Input aria-label={t('searchResources')} placeholder={t('searchResources')} value={search} onChange={event => { setSearch(event.target.value) }} /><Button size="sm" disabled={busy || loading} onClick={() => { void refresh() }}>{t('refresh')}</Button><Button variant="primary" size="sm" disabled={busy || loading || creating || scope === 'project' && !view?.projectTrusted} onClick={() => { setCreating(true) }}>{t('addMcp')}</Button></div>
        {creating ? <form className={css.editor} onSubmit={event => { event.preventDefault(); let args: unknown; try { args = JSON.parse(mcpDraft.args) } catch { setError(t('mcpArgsError')); return }; if(!Array.isArray(args) || !args.every((item): item is string => typeof item === 'string')) { setError(t('mcpArgsError')); return }; void update({action:'mcp',name:mcpDraft.name,scope,enabled:true,...mcpDraft.transport === 'http' ? {url:mcpDraft.url} : {command:mcpDraft.command,args}}).then(ok => { if(ok) { setCreating(false); setMcpDraft({name:'',transport:'http',url:'',command:'',args:'[]'}) } }) }}>
          <label>{t('resourceName')}<Input required pattern="[a-zA-Z0-9_-]+" aria-label={t('resourceName')} value={mcpDraft.name} onChange={event => { setMcpDraft({...mcpDraft,name:event.target.value}) }} /></label>
          <label>{t('mcpTransport')}<NativeSelect aria-label={t('mcpTransport')} value={mcpDraft.transport} onChange={event => { setMcpDraft({...mcpDraft,transport:event.target.value}) }}><option value="http">HTTP</option><option value="stdio">stdio</option></NativeSelect></label>
          {mcpDraft.transport === 'http' ? <label>{t('mcpUrl')}<Input required type="url" aria-label={t('mcpUrl')} value={mcpDraft.url} onChange={event => { setMcpDraft({...mcpDraft,url:event.target.value}) }}/></label> : <><label>{t('executable')}<Input required aria-label={t('executable')} value={mcpDraft.command} onChange={event => { setMcpDraft({...mcpDraft,command:event.target.value}) }}/></label><label>{t('mcpArguments')}<Input aria-label={t('mcpArguments')} value={mcpDraft.args} onChange={event => { setMcpDraft({...mcpDraft,args:event.target.value}) }}/></label></>}
          <p className={css.subtitle}>{t('mcpAuthHint')}</p><div className={css.actions}><Button disabled={busy || loading} onClick={() => { setCreating(false) }}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy || loading}>{t('save')}</Button></div>
        </form> : <div className={css.group}>{view?.mcp.filter(item => item.scope === scope && item.name.toLowerCase().includes(search.toLowerCase())).map(item => <div className={css.resource} key={item.scope+item.name}><div className={css.resourceText}><span>{item.name}</span><p>{item.endpoint}</p><span className={css.metadata}>{t(item.enabled ? 'mcpConfigured' : 'mcpDisabled')}</span></div><NativeSelect aria-label={t('mcpExposure',{name:item.name})} value={item.exposure} disabled={busy || loading} onChange={event => { void update({action:'mcp',name:item.name,scope:item.scope,exposure:event.target.value}) }}>{['codemode','codemode-deferred','deferred','direct','hidden'].map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect><Toggle label={t('enableResource',{name:item.name})} checked={item.enabled} disabled={busy || loading} change={enabled => { void update({action:'mcp',name:item.name,scope:item.scope,enabled}) }} /></div>)}{!view?.mcp.some(item => item.scope === scope && item.name.toLowerCase().includes(search.toLowerCase())) && <div className={css.empty}><IconApiOutlineRegular size={24}/><p>{t('noMcp')}</p></div>}</div>}
      </>}
      {section === 'mcp' && <div className={css.group}><Row title={t('nativePiCommand')} detail={t('mcpNativeSetupHint')}><Button size="sm" onClick={() => { void nativeSetup() }}>{t(window.piDesktop?.openPiTerminal ? 'openPiTerminal' : 'copyPiCommand')}</Button></Row></div>}
      {section === 'runtime' && runtimeContent}
      {section === 'shortcuts' && <><p className={css.subtitle}>{t('shortcutsHint')}</p><div className={css.group}><Row title={t('send')}><kbd>Enter</kbd></Row><Row title={t('newLine')}><kbd>Shift + Enter</kbd></Row><Row title={t('sidebar')}><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + B</kbd></Row><Row title={t('files')}><kbd>{navigator.platform.includes('Mac') ? '⌘ + ⌥' : 'Ctrl + Alt'} + B</kbd></Row><Row title={t('close')}><kbd>Esc</kbd></Row></div></>}
    </div></main>
    {trustPrompt && <Modal open title={t('reviewProjectTrust')} closeLabel={t('close')} onClose={() => { setTrustPrompt(false) }} footer={<><Button onClick={() => { setTrustPrompt(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={busy || loading} onClick={() => { void update({action:'trust',scope:'project',trusted:true}).then(ok => { if(ok) setTrustPrompt(false) }) }}>{t('trustProject')}</Button></>}><p className={css.subtitle}>{t('trustProjectHint')}</p><code className={css.path}>{cwd}</code></Modal>}
    {leaving !== null && <Modal open title={t('unsavedChanges')} closeLabel={t('close')} onClose={() => { setLeaving(null) }} footer={<><Button onClick={() => { setLeaving(null) }}>{t('keepEditing')}</Button><Button variant="primary" onClick={() => { const next = leaving; setLeaving(null); if(next === 'close') close(); else navigate(next) }}>{t('discardChanges')}</Button></>}><p className={css.subtitle}>{t('unsavedChangesHint')}</p></Modal>}
  </Modal>
}
