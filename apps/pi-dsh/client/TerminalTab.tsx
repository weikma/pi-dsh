/** A retained xterm presentation connected to one Host-owned interactive shell. */
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { isJsonObject } from '../bridge/types.ts'
import type { TerminalId } from '../terminal-types.ts'
import { api } from './http.ts'
import type { T } from './i18n.ts'
import { TerminalTheme } from './terminal-theme.ts'
import css from './WorkspacePanel.module.css'

/** Shell process lifetime follows the tab, while visibility only affects sizing and focus. */
export function TerminalTab({ cwd, active, t }: { cwd: string; active: boolean; t: T }) {
  const container = useRef<HTMLDivElement>(null)
  const live = useRef(active); live.current = active
  const controller = useRef<{ fit(): void; focus(): void }>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'starting' | 'connected' | 'disconnected' | 'exited' | 'failed'>('starting')
  const [revision, setRevision] = useState(0)
  const [exitCode, setExitCode] = useState(0)
  useEffect(() => {
    const element = container.current
    if (!element) return
    setStatus('starting'); setError('')
    let disposed = false
    let id: TerminalId | undefined
    let stream: EventSource | undefined
    let connected = false
    let sending = Promise.resolve()
    const terminal = new Terminal({ cols: 80, rows: 24, cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', scrollback: 2000, minimumContrastRatio: 4.5, screenReaderMode: true, allowProposedApi: true })
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element)
    const colors = new TerminalTheme(terminal)
    const updateTheme = (): void => { const style = getComputedStyle(element); colors.update(style.backgroundColor, style.color) }
    updateTheme()
    const themeObserver = new MutationObserver(updateTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    const report = (reason: unknown): void => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) }
    const send = (operation: () => Promise<unknown>): void => { sending = sending.then(operation).then(() => {}, report) }
    const resize = (): void => {
      if (!live.current || !connected || !id || element.clientWidth < 20 || element.clientHeight < 20) return
      const size = fit.proposeDimensions()
      if (!size) return
      const cols = Math.max(2, Math.min(500, size.cols)), rows = Math.max(1, Math.min(300, size.rows))
      if (cols === terminal.cols && rows === terminal.rows) return
      terminal.resize(cols, rows)
      const target = id; send(() => api.resizeTerminal(target, cols, rows))
    }
    controller.current = { fit: resize, focus: () => { if (connected) terminal.focus() } }
    const observer = new ResizeObserver(resize); observer.observe(element)
    const data = terminal.onData(value => {
      if (connected && id) { const target = id; send(() => api.writeTerminal(target, value)) }
    })
    void api.createTerminal(cwd).then(async info => {
      id = info.id
      if (disposed) { await api.closeTerminal(info.id); return }
      stream = new EventSource(`/api/terminals/${encodeURIComponent(info.id)}/events`)
      stream.onerror = () => { connected = false; setStatus(stream?.readyState === EventSource.CLOSED ? 'failed' : 'disconnected') }
      stream.onmessage = event => {
        let frame: unknown
        try { frame = JSON.parse(event.data) } catch (reason) { report(reason); return }
        if (!isJsonObject(frame)) return
        if (frame.type === 'screen' && typeof frame.data === 'string' && typeof frame.cols === 'number' && Number.isInteger(frame.cols) && frame.cols >= 2 && frame.cols <= 500 && typeof frame.rows === 'number' && Number.isInteger(frame.rows) && frame.rows >= 1 && frame.rows <= 300) {
          terminal.reset(); terminal.resize(frame.cols, frame.rows)
          terminal.write(frame.data, () => {
            if (disposed) return
            connected = true; setStatus('connected'); setError(''); resize()
            if (live.current) terminal.focus()
          })
        } else if (frame.type === 'output' && typeof frame.data === 'string') terminal.write(frame.data)
        else if (frame.type === 'exit' && typeof frame.code === 'number') {
          connected = false; setStatus('exited'); setExitCode(frame.code); stream?.close()
        }
      }
    }).catch(reason => { report(reason); if (!disposed) setStatus('failed') })
    return () => {
      disposed = true; connected = false; controller.current = undefined
      stream?.close(); observer.disconnect(); themeObserver.disconnect(); data.dispose(); colors.dispose(); terminal.dispose()
      if (id) void api.closeTerminal(id).catch(reason => { console.error('Terminal close failed:', reason) })
    }
  }, [cwd, revision])
  useEffect(() => { if (active) { controller.current?.fit(); controller.current?.focus() } }, [active])
  return <div className={css.body}>
    {error && <p role="alert" className={css.notice}>{error}</p>}
    {status !== 'connected' && <p role="status" className={css.notice}>{status === 'starting' ? t('terminalStarting') : status === 'disconnected' ? t('disconnected') : status === 'failed' ? t('terminalUnavailable') : t('terminalExited', { code: exitCode })}{(status === 'failed' || status === 'exited') && <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('terminalRestart')}</Button>}</p>}
    <div ref={container} className={css.terminal} aria-label={t('terminal')} />
  </div>
}
