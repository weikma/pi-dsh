/** Pi-owned provider setup and model selection, independent of a project conversation. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Input, IconChevronDownOutlineRegular, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomProvider, ProviderAuthType, ProviderInventory, ProviderModel } from '../bridge/provider-types.ts'
import { providerCatalog, type ProviderCatalogEntry } from '../bridge/provider-catalog.ts'
import type { ProviderAuthAttempt } from '../bridge/provider-job.ts'
import { api, followProviderAuth } from './http.ts'
import { NativeSelect } from './NativeSelect.tsx'
import type { T } from './i18n.ts'
import css from './ProvidersPanel.module.css'

function ProviderModels({ provider, available, selected, disabled, t, choose }: {
  provider: ProviderCatalogEntry; available: readonly ProviderModel[]; selected?: { provider: string; id: string }; disabled: boolean; t: T; choose(model: ProviderModel): void
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const models = provider.models.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase()))
  const availableIds = new Set(available.filter(model => model.provider === provider.id).map(model => model.id))
  return <details className={css.providerDetails} open={expanded}>
    <summary className={css.rowHead} aria-label={t('providerShowModels', { name: provider.name })} onClick={event => { event.preventDefault(); setExpanded(value => !value) }}>
      <span className={css.identity}><span className={css.name}>{provider.name}</span><span className={css.metadata}>{provider.name !== provider.id && <>{provider.id} · </>}{t('providerModelCount', { count: provider.modelCount })}</span></span>
      <span className={css.providerStatus}><span className={provider.authStatus.configured || provider.modelSource === 'session' ? css.configured : css.metadata}>{t(provider.modelSource === 'session' ? 'providerAvailable' : provider.authStatus.configured ? 'providerConfigured' : 'providerUnconfigured')}</span><IconChevronDownOutlineRegular size={16} className={css.disclosureIcon} aria-hidden="true" /></span>
    </summary>
    {expanded && <div className={css.providerModels}>
      <p className={css.metadata}>{t(provider.modelSource === 'session' ? 'providerSessionModels' : 'providerCatalogModels')}</p>
      {provider.models.length > 8 && <Input aria-label={t('providerSearchNamedModels', { name: provider.name })} placeholder={t('providerSearchModels')} value={search} onChange={event => { setSearch(event.target.value) }} />}
      <div className={css.models} role="group" aria-label={t('providerShowModels', { name: provider.name })}>
        {models.map(model => {
          const usable = availableIds.has(model.id)
          const checked = selected?.provider === model.provider && selected.id === model.id
          return <button type="button" key={model.id} className={css.model} aria-pressed={checked} disabled={disabled || !usable} aria-label={t('providerChooseModel', { name: model.name })} onClick={() => { choose(model) }}>
            <span className={css.modelHeading}><span>{model.name}</span>{checked && <IconCheckOutlineRegular size={14} aria-label={t('providerSelectedModel')} />}</span>
            {model.name !== model.id && <span className={css.metadata}>{model.id}</span>}{!usable && <span className={css.metadata}>{t('providerModelUnavailable')}</span>}
          </button>
        })}
      </div>
      {models.length === 0 && <p className={css.detail}>{t(provider.models.length === 0 ? 'providerNoRegisteredModels' : 'providerNoModels')}</p>}
    </div>}
  </details>
}

/** Shared provider form; Pi receives keys through transient password prompts.
 * @param props - Secret-free catalog, localized labels, and parent-owned model/session refresh actions.
 * @returns Provider cards, native sign-in interaction, compatible endpoint form, and model catalog.
 */
export function ProvidersPanel({ inventory, sessionModels, loading, error, cwd, selected, t, refresh, changed, selectModel, feedback }: {
  inventory: ProviderInventory | null
  sessionModels?: readonly ProviderModel[]
  loading: boolean
  error: string
  cwd?: string
  selected?: { provider: string; id: string }
  t: T
  refresh(): Promise<void>
  changed(): Promise<void>
  selectModel(model: ProviderModel): Promise<void>
  feedback(message: string): void
}) {
  const [attempt, setAttempt] = useState<ProviderAuthAttempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [value, setValue] = useState('')
  const [logout, setLogout] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [custom, setCustom] = useState({ providerId: '', name: '', baseUrl: '', modelId: '', modelName: '', api: 'openai-completions' as NonNullable<CustomProvider['api']> })
  const activeAttempt = useRef<ProviderAuthAttempt | null>(null)
  const mounted = useRef(true)
  const attemptPanel = useRef<HTMLElement>(null)
  const completed = useRef(new Set<string>())
  activeAttempt.current = attempt
  const working = attempt?.status === 'working' || attempt?.status === 'waiting'
  const failure = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)

  useEffect(() => {
    if (attempt === null || !working) return
    return followProviderAuth(attempt.id, setAttempt)
  }, [attempt?.id, working])
  useEffect(() => { setValue('') }, [attempt?.prompt?.id])
  useEffect(() => { attemptPanel.current?.scrollIntoView?.({ block: 'nearest' }) }, [attempt?.id, attempt?.prompt?.id])
  useEffect(() => {
    if (attempt?.status !== 'complete' || completed.current.has(attempt.id)) return
    completed.current.add(attempt.id)
    feedback(t('providerAuthenticated'))
    void changed().catch(reason => { feedback(failure(reason)) })
  }, [attempt?.id, attempt?.status, changed, feedback, t])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const pending = activeAttempt.current
      if (pending?.status === 'working' || pending?.status === 'waiting') {
        void api.cancelProvider(pending.id).catch((_error: unknown) => { /* The Host may already have completed or closed this login. */ })
      }
    }
  }, [])

  const start = async (providerId: string, authType: ProviderAuthType) => {
    if (busy || working) return
    setBusy(true); setFormError(''); setValue('')
    try {
      const next = await api.loginProvider(providerId, authType, cwd)
      if (mounted.current) setAttempt(next)
      else await api.cancelProvider(next.id)
    }
    catch (reason) { setFormError(failure(reason)) }
    finally { setBusy(false) }
  }
  const reply = async (answer = value) => {
    if (busy || attempt?.prompt === undefined) return
    const prompt = attempt.prompt
    setBusy(true); setFormError(''); setValue('')
    try { setAttempt(await api.replyProvider(attempt.id, prompt.id, answer)) }
    catch (reason) { setFormError(failure(reason)) }
    finally { setBusy(false) }
  }
  const cancel = async () => {
    if (busy || attempt === null) return
    setBusy(true); setValue('')
    try { setAttempt(await api.cancelProvider(attempt.id)) }
    catch (reason) { setFormError(failure(reason)) }
    finally { setBusy(false) }
  }
  const signOut = async (providerId: string) => {
    setBusy(true); setFormError('')
    try { await api.logoutProvider(providerId, cwd); setLogout(null); feedback(t('providerSignedOut')); await changed() }
    catch (reason) { setFormError(failure(reason)) }
    finally { setBusy(false) }
  }
  const saveCustom = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || working) return
    setBusy(true); setFormError('')
    try {
      await api.customProvider({ providerId: custom.providerId.trim(), ...(custom.name.trim() ? { name: custom.name.trim() } : {}), baseUrl: custom.baseUrl.trim(), api: custom.api,
        models: [{ id: custom.modelId.trim(), ...(custom.modelName.trim() ? { name: custom.modelName.trim() } : {}) }] }, cwd)
      await refresh()
      const next = await api.loginProvider(custom.providerId.trim(), 'api_key', cwd)
      if (mounted.current) setAttempt(next)
      else await api.cancelProvider(next.id)
    } catch (reason) { setFormError(failure(reason)) }
    finally { setBusy(false) }
  }
  const openLink = async (url: string) => {
    try { if (window.piDsh) await window.piDsh.openExternal(url); else window.open(url, '_blank', 'noopener,noreferrer') }
    catch (reason) { feedback(failure(reason)) }
  }
  const disabled = busy || working
  const catalog = providerCatalog(inventory, sessionModels)
  const models = catalog.available.filter(model => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(search.toLowerCase()))
  const configuredProviders = catalog.providers.filter(provider => provider.authStatus.configured || provider.modelSource === 'session')
  const addProviders = catalog.providers.filter(provider => !provider.authStatus.configured && provider.modelSource !== 'session'
    && `${provider.name} ${provider.id}`.toLowerCase().includes(providerSearch.toLowerCase()))
  const providerCard = (provider: ProviderCatalogEntry) => <li key={provider.id} className={css.card}>
      <ProviderModels provider={provider} available={catalog.available} selected={selected} disabled={disabled} t={t} choose={model => { void selectModel(model).catch(reason => { feedback(failure(reason)) }) }} />
      {provider.authStatus.configured && provider.authStatus.label && <p className={css.detail}>{provider.authStatus.label}</p>}
      <div className={css.actions}>
        {provider.authTypes.includes('api_key') && <Button size="sm" variant="outline" disabled={disabled} onClick={() => { void start(provider.id, 'api_key') }}>{t('providerApiKey')}</Button>}
        {provider.authTypes.includes('oauth') && <Button size="sm" variant="primary" disabled={disabled} onClick={() => { void start(provider.id, 'oauth') }}>{t('providerSignIn')}</Button>}
        {provider.authStatus.configured && <Button size="sm" disabled={disabled} onClick={() => { setLogout(provider.id) }}>{t('providerSignOut')}</Button>}
        {provider.authTypes.length === 0 && <span className={css.metadata}>{t('providerKeyUnavailable')}</span>}
      </div>
      {logout === provider.id && <div className={css.inset}><p className={css.detail}>{t('providerSignOutConfirm')}</p><div className={css.actions}><Button size="sm" disabled={busy} onClick={() => { setLogout(null) }}>{t('cancel')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { void signOut(provider.id) }}>{t('confirm')}</Button></div></div>}
    </li>

  return <section className={css.section}>
    {inventory !== null && <div className={css.profile}><span>{t('providerProfile')}</span><code>{inventory.agentDir}</code></div>}
    <p className={css.detail}>{t('providerCatalogHint')}</p>
    {loading && inventory === null && <div className={css.center} role="status" aria-label={t('loading')}><span className={css.spinner} /></div>}
    {error !== '' && <div className={css.queryError}><p>{t('providerRetryLoad')}: {error}</p><Button size="sm" disabled={loading} onClick={() => { void refresh() }}>{t('retry')}</Button></div>}
    {configuredProviders.length > 0 && <><h3 className={css.title}>{t('providerConfiguredProviders')}</h3><ul className={css.rows} aria-label={t('providerConfiguredProviders')}>{configuredProviders.map(providerCard)}</ul></>}

    {attempt !== null && <section ref={attemptPanel} className={css.inset} aria-label={t('providerSignIn')}>
      <h3 className={css.title}>{attempt.providerId} · {t(attempt.status === 'complete' ? 'providerAuthenticated' : attempt.status === 'cancelled' ? 'providerCancelled' : attempt.status === 'waiting' ? 'providerWaiting' : 'providerWorking')}</h3>
      {attempt.message && <p className={css.detail}>{attempt.message}</p>}
      {attempt.instructions && <p className={css.detail}>{attempt.instructions}</p>}
      {attempt.authUrl && <><div className={css.actions}><Button size="sm" variant="primary" onClick={() => { void openLink(attempt.authUrl!) }}>{t('providerOpenLink')}</Button><Button size="sm" onClick={() => { void navigator.clipboard.writeText(attempt.authUrl!).then(() => { feedback(t('copied')) }).catch(reason => { feedback(failure(reason)) }) }}>{t('providerCopyLink')}</Button></div><code className={css.link}>{attempt.authUrl}</code></>}
      {attempt.userCode && <div className={css.profile}><span>{t('providerCode')}</span><code>{attempt.userCode}</code></div>}
      {attempt.prompt !== undefined && (attempt.prompt.type === 'select'
        ? <div className={css.options}><p className={css.detail}>{attempt.prompt.message}</p>{attempt.prompt.options?.map(option => <Button key={option.id} size="sm" disabled={busy} onClick={() => { void reply(option.id) }}>{option.label}{option.description ? ' · ' + option.description : ''}</Button>)}</div>
        : <form className={css.editor} onSubmit={event => { event.preventDefault(); void reply() }}>
          <label className={css.field}>{attempt.prompt.message}<Input autoFocus type={attempt.prompt.type === 'secret' ? 'password' : 'text'} autoComplete={attempt.prompt.type === 'secret' ? 'new-password' : 'off'} aria-label={attempt.prompt.message} placeholder={attempt.prompt.placeholder} value={value} disabled={busy} onChange={event => { setValue(event.target.value) }} /></label>
          {attempt.prompt.type === 'secret' && <p className={css.metadata}>{t('providerKeyHint')}</p>}
          <Button type="submit" variant="primary" disabled={busy || value.trim() === ''}>{t('providerContinue')}</Button>
        </form>)}
      {attempt.error && <p role="alert" className={css.error}>{attempt.error}</p>}
      <div className={css.actions}>{working ? <Button size="sm" disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button> : <><Button size="sm" onClick={() => { setAttempt(null); setValue('') }}>{t('close')}</Button>{attempt.status !== 'complete' && <Button size="sm" disabled={busy} onClick={() => { void start(attempt.providerId, attempt.authType) }}>{t('retry')}</Button>}</>}</div>
    </section>}
    {formError !== '' && <p className={css.error} role="alert">{formError}</p>}

    <details className={css.inset} open={configuredProviders.length === 0}><summary className={css.title}>{t('providerAdd')}</summary>
      <div className={css.editor}><Input aria-label={t('providerSearch')} placeholder={t('providerSearch')} value={providerSearch} onChange={event => { setProviderSearch(event.target.value) }} />
        <ul className={css.catalogRows} aria-label={t('providerAdd')}>{addProviders.map(providerCard)}</ul>
        {inventory !== null && addProviders.length === 0 && <p className={css.detail}>{t('providerNoProviders')}</p>}
      </div>
    </details>

    <details className={css.inset}><summary className={css.title}>{t('providerCustom')}</summary>
      <form className={css.editor} onSubmit={event => { void saveCustom(event) }}>
        <p className={css.detail}>{t('providerCustomHint')}</p>
        <label className={css.field}>{t('providerId')}<Input required aria-label={t('providerId')} value={custom.providerId} disabled={disabled} onChange={event => { setCustom({ ...custom, providerId: event.target.value }) }} /></label>
        <label className={css.field}>{t('providerName')}<Input aria-label={t('providerName')} value={custom.name} disabled={disabled} onChange={event => { setCustom({ ...custom, name: event.target.value }) }} /></label>
        <label className={css.field}>{t('providerBaseUrl')}<Input required type="url" aria-label={t('providerBaseUrl')} value={custom.baseUrl} disabled={disabled} onChange={event => { setCustom({ ...custom, baseUrl: event.target.value }) }} /></label>
        <label className={css.field}>{t('providerProtocol')}<NativeSelect aria-label={t('providerProtocol')} disabled={disabled} value={custom.api} onChange={event => { setCustom({ ...custom, api: event.target.value as NonNullable<CustomProvider['api']> }) }}>{(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const).map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}</NativeSelect></label>
        <label className={css.field}>{t('providerModelId')}<Input required aria-label={t('providerModelId')} value={custom.modelId} disabled={disabled} onChange={event => { setCustom({ ...custom, modelId: event.target.value }) }} /></label>
        <label className={css.field}>{t('providerModelName')}<Input aria-label={t('providerModelName')} value={custom.modelName} disabled={disabled} onChange={event => { setCustom({ ...custom, modelName: event.target.value }) }} /></label>
        <Button type="submit" variant="primary" disabled={disabled}>{t('providerCustomSave')}</Button>
      </form>
    </details>
    <h3 className={css.title}>{t('providerCatalog')}</h3>
    <Input aria-label={t('providerSearchModels')} placeholder={t('providerSearchModels')} value={search} onChange={event => { setSearch(event.target.value) }} />
    <div className={css.models}>{models.map(model => <button key={model.provider + '/' + model.id} type="button" className={css.model} aria-pressed={selected?.provider === model.provider && selected.id === model.id} aria-label={t('providerChooseModel', { name: model.name })} onClick={() => { void selectModel(model).catch(reason => { feedback(failure(reason)) }) }}><span>{model.name}</span><span className={css.metadata}>{model.provider} · {model.id}</span></button>)}{inventory !== null && models.length === 0 && <p className={css.detail}>{t('providerNoModels')}</p>}</div>
    <p className={css.metadata}>{t('providerTerminalFallback')}</p>
    {inventory?.limitationCodes?.includes('api_key_override') && <p className={css.metadata}>{t('providerKeyOverride')}</p>}
  </section>
}
