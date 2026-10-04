/** Native Pi questions occupy the composer while the transcript remains available. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, plainAnsiText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PiCommand, PiUIRequest } from '../bridge/types.ts'
import type { T } from './i18n.ts'
import css from './ExtensionDialog.module.css'

type Respond = (command: PiCommand) => Promise<void>
interface CustomRow { source: PiUIRequest; value: string }
const optionText = (option: string, index: number) => plainAnsiText(option).replace(new RegExp(`^${index + 1}[.)]\\s+`), '')
// These are presentation hints, not an extension management API. Other strings retain native selection.
const customLabels = new Set(['Type something.', '输入内容'])
function customIndex(request: PiUIRequest): number {
  const index = (request.options?.length ?? 0) - 1
  return request.method === 'select' && index >= 0 && customLabels.has(optionText(request.options![index]!, index)) ? index : -1
}
function followsCustomInput(request: PiUIRequest, source: PiUIRequest): boolean {
  const question = plainAnsiText(source.title ?? '').split('\n\n--- ')[0]
  return request.method === 'input' && question !== '' && ['Type your answer:', '输入你的回答：'].some(label => plainAnsiText(request.title ?? '') === question + '\n\n' + label)
}

/** Compose consecutive native select/input requests without guessing or automatically answering them.
 * Entering a recognized custom row commits that native selection. A matching subsequent input stays
 * in the row; unrelated requests render normally. Pi owns cancellation and every submitted value.
 */
export function ExtensionDialog({ request, t, respond, children, sessionId }: { sessionId?: string | null; request?: PiUIRequest; t: T; respond: Respond; children?: ReactNode }) {
  const custom = useRef<CustomRow | null>(null)
  const owner = useRef(sessionId)
  if (owner.current !== sessionId) { custom.current = null; owner.current = sessionId }
  if (!request) return children
  const continuation = custom.current && followsCustomInput(request, custom.current.source) ? custom.current : null
  if (custom.current && request.id !== custom.current.source.id && !continuation) custom.current = null
  return <QuestionPanel key={request.id} request={request} t={t} respond={respond} continuation={continuation}
    remember={(source, value) => { custom.current = { source, value } }} forget={() => { custom.current = null }} />
}

function QuestionPanel({ request, t, respond, continuation, remember, forget }: { forget(): void; request: PiUIRequest; t: T; respond: Respond; continuation: CustomRow | null; remember(source: PiUIRequest, value: string): void }) {
  const [value, setValue] = useState(continuation?.value ?? request.prefill ?? '')
  const [selected, setSelected] = useState<number | null>(continuation ? customIndex(continuation.source) : null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const panel = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const confirm = request.method === 'confirm'
  const select = request.method === 'select'
  const source = continuation?.source ?? request
  const custom = customIndex(source)
  const title = plainAnsiText(source.title ?? t('extensionRequest'))
  const answer = async (fields: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { await respond({ type: 'extension_ui_response', id: request.id, ...fields }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); inFlight.current = false; setBusy(false) }
  }
  useLayoutEffect(() => {
    const field = input.current
    if (!field) return
    const resize = () => { field.style.height = 'auto'; field.style.height = `${Math.min(120, Math.max(36, field.scrollHeight + 2))}px` }
    resize()
    let width = field.clientWidth
    // Observe width only so changing height does not create a resize feedback loop.
    const observer = new ResizeObserver(() => { if (field.clientWidth !== width) { width = field.clientWidth; resize() } })
    observer.observe(field)
    return () => { observer.disconnect() }
  }, [value])
  useEffect(() => {
    const frame = requestAnimationFrame(() => { panel.current?.querySelector<HTMLElement>('[data-question-autofocus]')?.focus() })
    return () => { cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => {
    if (request.timeout === undefined) return
    const timer = window.setTimeout(() => { void answer({ cancelled: true }) }, request.timeout)
    return () => { window.clearTimeout(timer) }
  }, [request.id])
  const enterCustom = () => {
    setSelected(custom)
    input.current?.focus()
    if (select) { remember(request, value); void answer({ value: request.options![custom]! }) }
  }
  const submit = () => {
    if (select) {
      if (selected === custom && custom >= 0) enterCustom()
      else if (selected !== null && request.options?.[selected] !== undefined) void answer({ value: request.options[selected] })
    } else void answer(confirm ? { confirmed: true } : { value })
  }
  const edit = (text: string) => { setValue(text); if (select && selected === custom) remember(request, text) }
  return <section ref={panel} className={css.panel} aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void answer({ cancelled: true }) } }}>
    <header className={css.header}><span className={css.badge}>{t('question')}</span><h2 id={titleId}>{title}</h2></header>
    <div className={css.content}>
      {request.message && <p className={css.message}>{plainAnsiText(request.message)}</p>}
      {select || continuation
        ? <div className={css.options} role="radiogroup" aria-label={t('chooseAnswer')}>{source.options?.map((option, index) => {
          const text = optionText(option, index), split = text.indexOf(' — '), isCustom = index === custom
          return <div className={css.option} key={index} data-custom={isCustom || undefined} data-selected={selected === index || undefined}>
            <label className={css.choice}>
              <input type="radio" name={`pi-answer-${request.id}`} value={index} checked={selected === index} disabled={busy || !!continuation} data-question-autofocus={index === 0 && !continuation || undefined}
                onChange={() => { if (isCustom) enterCustom(); else { forget(); setSelected(index) } }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (isCustom) enterCustom(); else if (selected === index) submit(); else { forget(); setSelected(index) } } }} />
              <span className={css.ordinal} aria-hidden>{index + 1}.</span>
              <span className={css.optionText}><span>{isCustom ? t('customAnswer') : split < 0 ? text : text.slice(0, split)}</span>{!isCustom && split >= 0 && <span className={css.description}>{text.slice(split + 3)}</span>}</span>
            </label>
            {isCustom && <textarea ref={input} className={css.customInput} aria-label={t('customAnswer')} placeholder={t('customAnswerPlaceholder')} rows={1}
              data-question-autofocus={!!continuation || undefined} value={value} disabled={!!continuation && busy}
              onFocus={() => { if (select && !inFlight.current) enterCustom() }} onChange={event => { edit(event.target.value) }}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />}
          </div>
        })}</div>
        : !confirm && (request.method === 'editor'
          ? <textarea className={css.editor} data-question-autofocus aria-label={title} value={value} disabled={busy} onChange={event => { setValue(event.target.value) }} />
          : <Input data-question-autofocus aria-label={title} placeholder={request.placeholder && plainAnsiText(request.placeholder)} value={value} disabled={busy} onChange={event => { setValue(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />)}
      {error !== '' && <p className={css.error} role="alert">{plainAnsiText(error)}</p>}
    </div>
    <footer className={css.footer}><span className={css.hint}>{t(continuation ? 'customAnswerHint' : 'answerHint')}</span><div className={css.actions}>
      <Button disabled={busy} onClick={() => { void answer(confirm ? { confirmed: false } : { cancelled: true }) }}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || select && selected === null} onClick={submit}>{t('submitAnswer')}</Button>
    </div></footer>
  </section>
}
