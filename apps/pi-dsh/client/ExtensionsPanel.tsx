/** Pi package discovery and lifecycle; unfamiliar resources use the same native management path. */
import { useId, useState, type ReactNode } from 'react'
import { Button, Input, Modal, IconPluginPinwheelOutlineRegular, IconPlusOutlineRegular, IconSkillOutlineRegular, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { extensionCatalog, installedDefaultAlternatives, type CatalogExtension } from '../bridge/extension-catalog.ts'
import type { AgentConfigurationAction, AgentConfigurationView, ConfigurationScope, PiPackage } from '../bridge/agent-types.ts'
import type { T } from './i18n.ts'
import { MarketplaceBrowser } from './MarketplaceBrowser.tsx'
import type { MarketplaceKind } from '../bridge/marketplace-types.ts'
import { PiLogo } from './PiLogo.tsx'
import css from './ExtensionsPanel.module.css'

const categoryKeys = { rpc: 'extensionRpc', tools: 'extensionTools', browser: 'extensionBrowser', alternative: 'extensionAlternative', terminal: 'extensionTerminal' } as const

/** Installations require an explicit action; merely opening or searching this catalogue never executes packages. */
export function ExtensionsPanel({ view, scope, scopeControl, busy, error, t, update, refresh, nativeSetup, kind = 'extension', resourceContent }: {
  view: AgentConfigurationView; scope: ConfigurationScope; busy: boolean; error: string; t: T
  scopeControl: ReactNode
  kind?: MarketplaceKind
  resourceContent?: ReactNode
  update(action: AgentConfigurationAction): Promise<boolean>; refresh(): Promise<void>; nativeSetup(): Promise<void>
}) {
  const installForm = useId()
  const [tab, setTab] = useState<'featured' | 'market' | 'installed'>(kind === 'skill' ? 'market' : 'featured')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [source, setSource] = useState('')
  const [selected, setSelected] = useState<CatalogExtension | PiPackage | null>(null)
  const [removing, setRemoving] = useState<PiPackage | null>(null)
  const [operation, setOperation] = useState('')
  const installed = view.packages.filter(item => item.scope === scope)
  const skillPackages = installed.filter(item => view.resources.some(resource => resource.packageId === item.id && resource.kind === 'skills'))
  const visibleInstalled = kind === 'skill' ? skillPackages : installed
  const addLabel = kind === 'skill' ? 'addSkillPackage' : 'addExtension'
  const searchLabel = kind === 'skill' ? 'searchSkillsMarket' : 'searchExtensions'
  const resourceKinds = (item: PiPackage) => [...new Set(view.resources.filter(resource => resource.packageId === item.id).map(resource => resource.kind))]
  const kindLabels = { extensions: 'marketTypeExtension', skills: 'marketTypeSkill', prompts: 'marketTypePrompt', instructions: 'instructionsSettings' } as const
  const catalogNames = { extensionSubagents: 'extensionNameSubagents', extensionWebAccess: 'extensionNameWebAccess', extensionQuestions: 'extensionNameQuestions', extensionTodos: 'extensionNameTodos', extensionPlannotator: 'extensionNamePlannotator', extensionMcpAdapter: 'extensionNameMcp', extensionLens: 'extensionNameLens', extensionShell: 'extensionNameShell', extensionContext: 'extensionNameContext', extensionObservability: 'extensionNameObservability' } as const
  const description = (item: PiPackage) => { const known = extensionCatalog.find(entry => entry.name === item.name); return known ? t(known.key) : item.description || item.source }
  const matches = (name: string, description: string) => `${name} ${description}`.toLowerCase().includes(query.trim().toLowerCase())
  const findInstalled = (item: CatalogExtension) => installed.find(value => value.name === item.name || value.source === `npm:${item.name}` || value.source.startsWith(`npm:${item.name}@`))
  const alternativeMessage = (source: string) => {
    const alternatives = installedDefaultAlternatives(source, view)
    return alternatives.length ? t('extensionAlternativeHint', { name: [...new Set(alternatives.map(item => item.name))].join(', ') }) : ''
  }
  const availableDefaults = extensionCatalog.filter(item => item.recommended && !findInstalled(item) && !alternativeMessage(item.name))
  const blocked = busy || operation !== '' || !view.packageManagement || scope === 'project' && !view.projectTrusted
  const run = async (label: string, action: AgentConfigurationAction) => {
    setOperation(label)
    try { return await update(action) } finally { setOperation('') }
  }
  const install = async (item: CatalogExtension) => run(t('installingExtension', { name: item.name }), { action: 'package', operation: 'install', scope, source: `npm:${item.name}@${item.version}` })
  const installDefaults = async () => {
    for (const item of availableDefaults) {
      if (!await install(item)) return
    }
    setTab('installed')
  }
  const card = (item: CatalogExtension) => {
    const existing = findInstalled(item)
    const alternative = alternativeMessage(item.name)
    return <article className={css.card} key={item.name}>
      <button type="button" className={css.cardLink} onClick={() => { setSelected(existing ?? item) }}><span className={css.packageIcon}><IconPluginPinwheelOutlineRegular size={22}/></span><span className={css.cardIdentity}><span className={css.cardName}>{t(catalogNames[item.key])}</span><span className={css.publisher}>{item.name}</span></span>{existing && <IconCheckOutlineRegular size={16} className={css.installedCheck}/>}</button>
      <p>{t(item.key)}</p>{alternative && <p className={css.alternative}>{alternative}</p>}<div className={css.cardFooter}><span className={css.badge}>{t(categoryKeys[item.category])}</span><Button size="sm" variant={existing ? 'ghost' : 'outline'} disabled={blocked} onClick={() => { if (existing) setSelected(existing); else void install(item) }}>{t(existing ? 'manageExtension' : 'installExtension')}</Button></div>
    </article>
  }
  return <>
    <div className={css.hero}><div className={css.heroCopy}><span className={css.eyebrow}>{t('marketBrand')}</span><h2>{t(kind === 'skill' ? 'skillMarketHeading' : 'extensionMarketHeading')}</h2><p>{t(kind === 'skill' ? 'skillMarketHint' : 'extensionCenterHint')}</p></div><div className={css.heroMark}><PiLogo size={48}/></div></div>
    <div className={css.toolbar}><div className={css.tabs} role="tablist" aria-label={t(kind === 'skill' ? 'skillsSettings' : 'extensionsSettings')}>{(kind === 'skill' ? ['market', 'installed'] as const : ['featured', 'market', 'installed'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={installForm + '-panel'} id={installForm + '-' + value} onClick={() => { setTab(value) }} onKeyDown={event => {
      const tabs = kind === 'skill' ? ['market', 'installed'] as const : ['featured', 'market', 'installed'] as const
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); const index = tabs.findIndex(item => item === value), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      setTab(tabs[next]!); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }}>{t(value === 'featured' ? 'featuredExtensions' : value === 'market' ? 'marketDiscover' : 'installedExtensions')}{value === 'installed' && <span>{kind === 'skill' ? view.resources.filter(item => item.kind === 'skills' && item.scope === scope).length : installed.length}</span>}</button>)}</div><div className={css.toolbarActions}>{!(kind === 'skill' && tab === 'installed') && scopeControl}<Button size="sm" icon={<IconPlusOutlineRegular size={14}/>} disabled={blocked} onClick={() => { setAdding(true) }}>{t(addLabel)}</Button></div></div>
    {tab !== 'market' && !(kind === 'skill' && tab === 'installed') && <div className={css.search}><Input aria-label={t(searchLabel)} placeholder={t(searchLabel)} value={query} onChange={event => { setQuery(event.target.value) }}/><Button size="sm" disabled={busy || operation !== ''} onClick={() => { void refresh() }}>{t('refresh')}</Button></div>}
    {operation && <div role="status" aria-live="polite" className={css.notice}>{operation}</div>}
    {!view.packageManagement && <p className={css.notice}>{t('extensionManagementUnavailable')}</p>}
    <div role="tabpanel" id={installForm + '-panel'} aria-labelledby={installForm + '-' + tab}>
    {tab === 'market' ? <MarketplaceBrowser kind={kind} scope={scope} installed={installed} blocked={blocked} operation={operation} error={error} t={t} manage={setSelected} install={source => run(t('installingExtension', { name: source }), { action: 'package', operation: 'install', scope, source })}/> : tab === 'featured' ? <>
      <div className={css.sectionTitle}><div><h2>{t('defaultExtensions')}</h2><p>{t('defaultExtensionsHint')}</p></div><Button size="sm" variant="primary" disabled={blocked || availableDefaults.length === 0} onClick={() => { void installDefaults() }}>{t('installDefaultExtensions')}</Button></div>
      <div className={css.cards}>{extensionCatalog.filter(item => item.recommended && matches(item.name, t(item.key))).map(card)}</div>
      <h2>{t('moreExtensions')}</h2><div className={css.cards}>{extensionCatalog.filter(item => !item.recommended && matches(item.name, t(item.key))).map(card)}</div>
      {!extensionCatalog.some(item => matches(item.name, t(item.key))) && <p className={css.empty}>{t('noSearchResults')}</p>}
      <p className={css.description}>{t('extensionCatalogHint')} <a href="https://pi.dev/packages" target="_blank" rel="noreferrer">{t('browsePiPackages')}</a></p>
    </> : <>
      {kind === 'skill' && resourceContent}
      {kind === 'skill' && visibleInstalled.length > 0 && <h2>{t('skillSourcePackages')}</h2>}
      {visibleInstalled.filter(item => matches(item.name, description(item))).map(item => <article className={css.installed} key={item.id}><span className={css.packageIcon} data-kind={kind}>{kind === 'skill' ? <IconSkillOutlineRegular size={22}/> : <IconPluginPinwheelOutlineRegular size={22}/>}</span><div><button type="button" className={css.name} onClick={() => { setSelected(item) }}>{item.name}</button><p>{description(item)}</p><div className={css.badges}><span className={css.version}>{item.version || t(item.installed ? 'packageInstalled' : 'packageMissing')}</span>{resourceKinds(item).map(resource => <span className={css.badge} key={resource}>{t(kindLabels[resource])}</span>)}</div></div><Button size="sm" disabled={blocked} onClick={() => { setSelected(item) }}>{t('manageExtension')}</Button></article>)}
      {kind === 'extension' && installed.length === 0 && <div className={css.empty}>{t('noInstalledExtensions')}<Button onClick={() => { setTab('market') }}>{t('marketDiscover')}</Button></div>}
      {kind === 'extension' && <>
      <h2>{t('localExtensions')}</h2>
      {view.resources.filter(item => item.kind === 'extensions' && item.scope === scope && !item.packageId && matches(item.name, item.description)).map(item => <div className={css.resource} key={item.id}><div><span>{item.name}</span>{item.path !== item.name && <code>{item.path}</code>}</div><button type="button" role="switch" aria-checked={item.enabled} aria-label={t('enableResource', { name: item.name })} className={css.toggle} disabled={busy || operation !== ''} onClick={() => { void run(t('settingsSaved'), { action: 'toggle', resourceId: item.id, enabled: !item.enabled }) }}><span/></button></div>)}
      </>}
    </>}
    </div>
    <p className={css.protocol}>{t(kind === 'skill' ? 'skillProtocolHint' : 'extensionProtocolHint')} <button className={css.link} type="button" disabled={busy} onClick={() => { void nativeSetup() }}>{t(window.piDsh?.openPiTerminal ? 'openPiTerminal' : 'copyPiCommand')}</button></p>
    <Modal className={css.formModal} contentClassName={css.detailContent} open={adding} title={t(addLabel)} closeLabel={t('close')} onClose={() => { if (!busy && !operation) setAdding(false) }} footer={<><Button disabled={busy || operation !== ''} onClick={() => { setAdding(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={blocked || !source.trim()} type="submit" form={installForm}>{t('installExtension')}</Button></>}><form id={installForm} onSubmit={event => { event.preventDefault(); if(!blocked && source.trim()) void run(t('installingExtension', {name:source}), { action:'package', operation:'install', scope, source }).then(ok => { if(ok) { setAdding(false); setSource(''); setTab('installed') } }) }}><p className={css.description}>{t('extensionSourceHint')}</p><Input data-modal-autofocus aria-label={t('extensionSource')} value={source} placeholder="npm:package@version" onChange={event => { setSource(event.target.value) }}/></form><p className={css.description}>{t('marketWholePackageHint')}</p><p className={css.description}>{t('extensionInstallHint')}</p>{error && <p role="alert" className={css.error}>{error}</p>}{operation && <p role="status">{operation}</p>}</Modal>
    <Modal open={selected !== null} title={selected?.name ?? ''} closeLabel={t('close')} className={css.detailModal} contentClassName={css.detailContent} onClose={() => { if (!busy && !operation) setSelected(null) }}>
      {selected && ('id' in selected ? <>
        <p className={css.description}>{description(selected)}</p><code className={css.installCommand}>{selected.source}</code><dl className={css.facts}><div><dt>{t('marketVersion')}</dt><dd>{selected.version || '—'}</dd></div><div><dt>{t('configurationScope')}</dt><dd>{t(selected.scope === 'user' ? 'userScope' : 'projectScope')}</dd></div><div><dt>{t('extensionResources')}</dt><dd>{view.resources.filter(item => item.packageId === selected.id).length}</dd></div></dl><p className={css.description}>{t('extensionUpdateHint')}</p>
        <div className={css.detailActions}><Button disabled={blocked} onClick={() => { void run(t('updatingExtension',{name:selected.name}), {action:'package',operation:'update',packageId:selected.id}).then(ok => { if(ok) setSelected(null) }) }}>{t('updateExtension')}</Button><Button disabled={blocked} onClick={() => { setRemoving(selected) }}>{t('removeExtension')}</Button></div>
        <h3 className={css.detailHeading}>{t('extensionResources')}</h3>{view.resources.filter(item => item.packageId === selected.id).map(item => <div className={css.resource} key={item.id}><div><span>{item.name}</span><code>{t(kindLabels[item.kind])}{item.kind === 'skills' ? ' · /skill:' + item.name : ''}</code></div><button type="button" role="switch" aria-label={t('enableResource',{name:item.name})} aria-checked={item.enabled} className={css.toggle} disabled={busy || operation !== ''} onClick={() => { void run(t('settingsSaved'), {action:'toggle',resourceId:item.id,enabled:!item.enabled}) }}><span/></button></div>)}<p className={css.description}>{t('configurationApplyHint')}</p>
      </> : <><p className={css.description}>{t(selected.key)}</p><span className={css.badge}>{t(categoryKeys[selected.category])}</span><p className={css.description}>{t('extensionPinnedVersion',{version:selected.version})}</p><a href={selected.url} target="_blank" rel="noreferrer">{t('extensionDocumentation')}</a><p className={css.description}>{t('extensionInstallHint')}</p>{alternativeMessage(selected.name) && <p className={css.alternative}>{alternativeMessage(selected.name)}</p>}<Button variant="primary" disabled={blocked || findInstalled(selected) !== undefined} onClick={() => { void install(selected).then(ok => { if(ok) {setSelected(null);setTab('installed')} }) }}>{t(findInstalled(selected) ? 'packageInstalled' : 'installExtension')}</Button></>)}
      {error && <p role="alert" className={css.error}>{error}</p>}{operation && <p role="status">{operation}</p>}
    </Modal>
    <Modal className={css.formModal} contentClassName={css.detailContent} open={removing !== null} title={t('removeExtension')} closeLabel={t('close')} onClose={() => { if(!busy && !operation) setRemoving(null) }} footer={<><Button disabled={busy || operation !== ''} onClick={() => { setRemoving(null) }}>{t('cancel')}</Button><Button disabled={blocked || !removing} onClick={() => { if(removing) void run(t('removingExtension',{name:removing.name}),{action:'package',operation:'remove',packageId:removing.id}).then(ok => { if(ok) {setRemoving(null);setSelected(null)} }) }}>{t('removeExtension')}</Button></>}><p className={css.description}>{t('removeExtensionHint',{name:removing?.name ?? ''})}</p>{error && <p role="alert" className={css.error}>{error}</p>}{operation && <p role="status">{operation}</p>}</Modal>
  </>
}
