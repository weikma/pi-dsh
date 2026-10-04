/** Native guest navigation and a sandboxed iframe fallback share one browser toolbar. */
import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { Input, Tooltip, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconRightUpOutlineRegular, IconRefreshOutlineRegular, IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserUrl } from '../browser-policy.ts'
import type { T } from './i18n.ts'
import css from './WorkspacePanel.module.css'
import shell from './App.module.css'

declare global { interface HTMLElementTagNameMap { webview: WebviewTag } }
interface Navigation { url: string; back: boolean; forward: boolean; loading: boolean; error: string }
interface NativeNavigation { load(url: string): void; back(): void; forward(): void; reload(): void }
const initial: Navigation = { url: '', back: false, forward: false, loading: false, error: '' }

function NativeBrowser({ controls, onChange, t }: { controls: React.MutableRefObject<NativeNavigation | undefined>; onChange(value: Navigation): void; t: T }) {
  const box = useRef<HTMLDivElement>(null)
  const change = useRef(onChange); change.current = onChange
  const copy = useRef(t); copy.current = t
  useEffect(() => {
    const native = window.piDsh
    if (!native?.createBrowser || !native.closeBrowser || !box.current) return
    let disposed = false, ready = false, pending = ''
    let lease: string | undefined
    let failure = ''
    const element = document.createElement('webview')
    element.setAttribute('aria-label', t('browser'))
    const update = (): void => {
      if (!ready || disposed) return
      const url = element.getURL()
      change.current({ url: url === 'about:blank' ? '' : url, back: element.canGoBack(), forward: element.canGoForward(), loading: element.isLoading(), error: failure })
    }
    const load = (url: string): void => {
      pending = url
      if (!ready) return
      failure = ''
      void element.loadURL(url).catch(error => { if (!disposed && !(error instanceof Error && error.message.includes('ERR_ABORTED'))) { failure = copy.current('browserLoadFailed'); update() } })
    }
    controls.current = { load, back: () => { if (ready && element.canGoBack()) element.goBack() }, forward: () => { if (ready && element.canGoForward()) element.goForward() }, reload: () => { if (ready) { failure = ''; element.reload() } } }
    element.addEventListener('dom-ready', () => { const first = !ready; ready = true; if (first && pending) load(pending); update() })
    element.addEventListener('did-start-loading', () => { failure = ''; update() })
    for (const event of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) element.addEventListener(event, update)
    element.addEventListener('did-fail-load', event => {
      if (event.isMainFrame && event.errorCode !== -3) { failure = copy.current('browserLoadFailed'); update() }
    })
    void native.createBrowser().then(async value => {
      lease = value.id
      if (disposed) { await native.closeBrowser?.(value.id); return }
      element.setAttribute('partition', value.partition); element.setAttribute('src', 'about:blank')
      box.current?.append(element)
    }).catch(reason => { if (!disposed) change.current({ ...initial, error: reason instanceof Error ? reason.message : String(reason) }) })
    return () => {
      disposed = true; controls.current = undefined
      element.remove()
      if (lease) void native.closeBrowser?.(lease).catch(reason => { console.error('Browser close failed:', reason) })
    }
  }, [])
  return <div ref={box} className={css.browserContent} />
}

/** Web history records address-bar visits; cross-origin iframe navigation is owned by the website. */
export function BrowserTab({ active, t }: { cwd: string; active: boolean; t: T }) {
  const native = window.piDsh?.createBrowser !== undefined
  const [address, setAddress] = useState('')
  const [navigation, setNavigation] = useState(initial)
  const [history, setHistory] = useState<string[]>([])
  const [index, setIndex] = useState(-1)
  const [reload, setReload] = useState(0)
  const nativeControls = useRef<NativeNavigation>()
  const input = useRef<HTMLInputElement>(null)
  const lastUrl = useRef('')
  const url = native ? navigation.url : history[index] ?? ''
  useEffect(() => { if (active && !url) input.current?.focus() }, [active, url])
  const show = (value: Navigation): void => {
    setNavigation(value)
    // Loading and title events must not replace a URL currently being edited.
    if (value.url !== lastUrl.current) { lastUrl.current = value.url; setAddress(value.url) }
  }
  const navigate = (): void => {
    try {
      const destination = browserUrl(address, location.href)
      setNavigation(value => ({ ...value, error: '', loading: true })); setAddress(destination)
      if (native) nativeControls.current?.load(destination)
      else { const next = [...history.slice(0, index + 1), destination]; setHistory(next); setIndex(next.length - 1) }
    } catch (error) { void error; setNavigation(value => ({ ...value, error: t('browserInvalid'), loading: false })) }
  }
  const external = (): void => {
    if (!url) return
    if (window.piDsh) void window.piDsh.openExternal(url).catch(reason => { setNavigation(value => ({ ...value, error: reason instanceof Error ? reason.message : String(reason) })) })
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  return <div className={css.body}>
    <form className={`${css.toolbar} ${css.browserToolbar}`} onSubmit={event => { event.preventDefault(); navigate() }}>
      <Tooltip label={t('browserBack')} portal><button type="button" className={shell.iconButton} aria-label={t('browserBack')} disabled={native ? !navigation.back : index <= 0} onClick={() => { if (native) nativeControls.current?.back(); else { setIndex(index - 1); setAddress(history[index - 1] ?? '') } }}><IconChevronLeftOutlineRegular size={16} /></button></Tooltip>
      <Tooltip label={t('browserForward')} portal><button type="button" className={shell.iconButton} aria-label={t('browserForward')} disabled={native ? !navigation.forward : index >= history.length - 1} onClick={() => { if (native) nativeControls.current?.forward(); else { setIndex(index + 1); setAddress(history[index + 1] ?? '') } }}><IconChevronRightOutlineRegular size={16} /></button></Tooltip>
      <Tooltip label={t('browserReload')} portal><button type="button" className={shell.iconButton} aria-label={t('browserReload')} disabled={!url} onClick={() => { if (native) nativeControls.current?.reload(); else setReload(value => value + 1) }}><IconRefreshOutlineRegular size={16} /></button></Tooltip>
      <Input ref={input} className={css.browserAddress} aria-label={t('browserAddress')} placeholder={t('browserPlaceholder')} spellCheck={false} autoCapitalize="none" autoComplete="off" value={address} onChange={event => { setAddress(event.target.value) }} />
      <Tooltip label={t('browserGo')} portal><button type="submit" className={shell.iconButton} aria-label={t('browserGo')} disabled={!address.trim()}><IconRightUpOutlineRegular size={16} className={css.goIcon} /></button></Tooltip>
    </form>
    {navigation.error && <p className={css.notice} role="alert">{navigation.error}</p>}
    <div className={css.browserStage}>{native ? <NativeBrowser controls={nativeControls} onChange={show} t={t} /> : url ? <div className={css.browserContent}><iframe key={reload} title={t('browser')} src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" onLoad={() => { setNavigation(value => ({ ...value, loading: false })) }} /></div> : null}
    {!url && <div className={css.browserWelcome}><IconGlobeOutlineRegular size={48} /><p>{t('browserStart')}</p></div>}
    </div>
    {url && <div className={css.browserFooter}>{!native && <span>{t('browserEmbedHint')}</span>}<button type="button" onClick={external}><IconRightUpOutlineRegular size={14} />{t('browserExternal')}</button></div>}
  </div>
}
