import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, IconSkillOutlineRegular, IconPluginPinwheelOutlineRegular, IconDownloadOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketplaceKind, MarketplaceSort, MarketplacePage, MarketplacePackage, MarketplaceDetail, PackageResourceType } from '../bridge/marketplace-types.ts'
import type { PiPackage, ConfigurationScope } from '../bridge/agent-types.ts'
import { api } from './http.ts'
import { NativeSelect } from './NativeSelect.tsx'
import type { T } from './i18n.ts'
import css from './ExtensionsPanel.module.css'

export const resourceTypeKeys = { extension: 'marketTypeExtension', skill: 'marketTypeSkill', prompt: 'marketTypePrompt', theme: 'marketTypeTheme' } as const

/** Public metadata is read on demand; installation always uses the reviewed exact registry version. */
export function MarketplaceBrowser({ kind, scope, installed, blocked, operation, error, t, install, manage }: {
  kind: MarketplaceKind; scope: ConfigurationScope; installed: PiPackage[]; blocked: boolean; operation: string; error: string; t: T
  install(source: string): Promise<boolean>; manage(item: PiPackage): void
}) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState('')
  const [sort, setSort] = useState<MarketplaceSort>('downloads'), [page, setPage] = useState(1)
  const [data, setData] = useState<MarketplacePage | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0), [selected, setSelected] = useState<MarketplacePackage | null>(null)
  const [detail, setDetail] = useState<MarketplaceDetail | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailFailed, setDetailFailed] = useState(false)
  const [detailRetry, setDetailRetry] = useState(0)
  const mounted = useRef(true)
  const resultsHeading = useRef<HTMLDivElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setFailed(false)
    void api.marketplace({ kind, query: search, sort, page }, controller.signal, reload > 0).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [kind, search, sort, page, reload])
  useEffect(() => {
    setDetail(null); setDetailFailed(false)
    if (!selected) return
    const controller = new AbortController()
    setDetailLoading(true)
    void api.marketplaceDetail(selected.name, controller.signal).then(value => { if (!controller.signal.aborted) setDetail(value) })
      .catch(() => { if (!controller.signal.aborted) setDetailFailed(true) }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => { controller.abort() }
  }, [selected?.name, detailRetry])
  const existing = (name: string) => installed.find(item => item.name === name || item.source === `npm:${name}` || item.source.startsWith(`npm:${name}@`))
  const external = 'https://pi.dev/packages?' + new URLSearchParams({ type: kind, name: search, sort })
  const resourceTypes: PackageResourceType[] = [...new Set([...(selected?.types ?? []), ...(detail?.resources.map(item => item.type) ?? [])])]
  const Icon = kind === 'skill' ? IconSkillOutlineRegular : IconPluginPinwheelOutlineRegular
  return <>
    <form className={css.marketSearch} onSubmit={event => { event.preventDefault(); setPage(1); if (search === query.trim()) setReload(value => value + 1); else setSearch(query.trim()) }}>
      <Input aria-label={t(kind === 'skill' ? 'searchSkillsMarket' : 'searchExtensions')} placeholder={t('marketSearchHint')} value={query} maxLength={200} onChange={event => { setQuery(event.target.value) }} />
      <NativeSelect aria-label={t('marketSort')} value={sort} onChange={event => { const next = event.target.value; if (next === 'downloads' || next === 'recent' || next === 'name') { setSort(next); setPage(1) } }}>
        <option value="downloads">{t('marketPopular')}</option><option value="recent">{t('marketRecent')}</option><option value="name">{t('marketAlphabetical')}</option>
      </NativeSelect><Button type="submit" size="sm">{t('marketSearch')}</Button>
    </form>
    <div ref={resultsHeading} className={css.marketMeta}><span aria-live="polite">{data ? t('marketResults', { count: data.total }) : t('marketSource')}{loading && data ? ' · ' + t('loading') : ''}</span><a href={external} target="_blank" rel="noreferrer">{t('marketOpenOfficial')} ↗</a></div>
    {failed && <div className={css.queryError} role="alert"><p>{t('marketUnavailable')}</p><Button size="sm" onClick={() => { setReload(value => value + 1) }}>{t('retry')}</Button></div>}
    <div className={css.cards} aria-busy={loading} aria-label={t(kind === 'skill' ? 'skillMarketplace' : 'extensionMarketplace')}>
      {loading && data === null ? <div className={css.skeletonGrid} role="status" aria-label={t('loading')}>{[0, 1, 2, 3].map(key => <div className={css.skeleton} key={key}><span/><span/><span/></div>)}</div> : data?.packages.map(item => {
        const local = existing(item.name)
        return <article className={css.card} key={item.name}>
          <button type="button" className={css.cardLink} disabled={loading || !!operation} onClick={() => { setSelected(item) }}><span className={css.packageIcon} data-kind={kind}><Icon size={22}/></span><span className={css.cardIdentity}><span className={css.cardName}>{item.name}</span><span className={css.publisher}>{item.author || t('marketCommunity')}</span></span><IconChevronRightOutlineRegular size={16} className={css.cardChevron}/></button>
          <p>{item.description || t('marketNoDescription')}</p>
          <div className={css.badges}>{item.types.map(type => <span className={css.badge} key={type}>{t(resourceTypeKeys[type])}</span>)}</div>
          <div className={css.cardFooter}><span className={css.downloads}><IconDownloadOutlineRegular size={13}/>{t('marketDownloads', { count: new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(item.downloads) })}</span><Button size="sm" variant="outline" disabled={loading || !!operation} onClick={() => { if (local) manage(local); else setSelected(item) }}>{t(local ? 'manageExtension' : 'marketViewPackage')}</Button></div>
        </article>
      })}
    </div>
    {!loading && !failed && data?.packages.length === 0 && <div className={css.empty}><Icon size={28}/><p>{t('marketEmpty')}</p><Button onClick={() => { setQuery(''); setSearch(''); setPage(1) }}>{t('marketClearSearch')}</Button></div>}
    {data && <nav className={css.pagination} aria-label={t('marketPagination')}><Button size="sm" disabled={loading || page <= 1} onClick={() => { setPage(value => value - 1); resultsHeading.current?.scrollIntoView({ block: 'start' }) }}>{t('marketPrevious')}</Button><span>{t('marketPage', { page: data.page })}</span><Button size="sm" disabled={loading || failed || !data.hasNext} onClick={() => { setPage(value => value + 1); resultsHeading.current?.scrollIntoView({ block: 'start' }) }}>{t('marketNext')}</Button></nav>}
    <Modal open={selected !== null} title={selected?.name ?? ''} closeLabel={t('close')} className={css.detailModal} contentClassName={css.detailContent} onClose={() => { if (!operation) setSelected(null) }} footer={<><Button disabled={!!operation} onClick={() => { setSelected(null) }}>{t('close')}</Button><Button variant="primary" disabled={blocked || !detail || detailLoading || !!selected && !!existing(selected.name)} onClick={() => { if (detail) void install(`npm:${detail.name}@${detail.version}`).then(ok => { if (ok && mounted.current) setSelected(null) }) }}>{t(selected && existing(selected.name) ? 'packageInstalled' : 'marketInstallPackage')}</Button></>}>
      {selected && <><div className={css.detailHero}><span className={css.packageIcon} data-kind={kind}><Icon size={28}/></span><div><p>{detail?.description || selected.description}</p><span className={css.publisher}>{selected.author}</span></div></div>
        <div className={css.badges}>{resourceTypes.map(type => <span key={type} className={css.badge}>{t(resourceTypeKeys[type])}</span>)}</div>
        {detailLoading && <div className={css.detailLoading} role="status" aria-label={t('loading')}><span className={css.spinner}/></div>}
        {detailFailed && <div role="alert" className={css.queryError}><p>{t('marketDetailUnavailable')}</p><Button onClick={() => { setDetailRetry(value => value + 1) }}>{t('retry')}</Button></div>}
        {detail && <><dl className={css.facts} data-install><div><dt>{t('marketVersion')}</dt><dd>{detail.version}</dd></div><div><dt>{t('marketLicense')}</dt><dd>{detail.license || '—'}</dd></div><div><dt>{t('marketPiVersion')}</dt><dd>{detail.piRequirement || t('marketUnspecified')}</dd></div><div><dt>{t('marketInstallScope')}</dt><dd>{t(scope === 'user' ? 'userScope' : 'projectScope')}</dd></div></dl>
          <h3 className={css.detailHeading}>{t('extensionResources')}</h3><p className={css.description}>{t('marketWholePackageHint')}</p>
          {detail.resources.length > 0 ? detail.resources.map(resource => <div className={css.manifestGroup} key={resource.type}><span>{t(resourceTypeKeys[resource.type])}</span><div>{resource.paths.map(path => <code key={path}>{path}</code>)}</div></div>) : <p className={css.description}>{t('marketConventionalResources')}</p>}
          <code className={css.installCommand}>pi install npm:{detail.name}@{detail.version}</code>
        </>}
        <div className={css.detailLinks}><a href={selected.url} target="_blank" rel="noreferrer">{t('marketOpenOfficial')} ↗</a>{detail?.homepage && <a href={detail.homepage} target="_blank" rel="noreferrer">{t('extensionDocumentation')} ↗</a>}</div>
        <p className={css.description}>{t('extensionInstallHint')}</p>{error && <p role="alert" className={css.error}>{error}</p>}{operation && <p role="status" className={css.notice}>{operation}</p>}
      </>}
    </Modal>
  </>
}
