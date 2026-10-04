/** Pi message presentation using the original GUI's Markdown, code, and terminal atoms. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  MarkdownText, MarkdownDelegateProvider, TerminalBlock, ReadBlock, StateDot, TextShimmer,
  Button, writeClipboard, IconCopyOutlineRegular, IconSkillOutlineRegular,
  IconApiOutlineRegular, IconChevronDownOutlineRegular, IconEditOutlineRegular,
  languageForPath,
  Menu, Tooltip, IconBranchOutlineRegular,
  type MarkdownLabels, type ReadBlockLabels, type TerminalBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { plainAnsiText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PiSnapshot } from '../bridge/types.ts'
import { messagesOf, object, string, type ToolRecord, type MessageRecord } from './records.ts'
import { workRows, workDuration, type WorkRecord } from './work-records.ts'
import type { T } from './i18n.ts'
import css from './App.module.css'

/** Complete localized labels for the shared Markdown renderer.
 * @param t - Interface translation function.
 * @returns Labels used by Markdown fences and footnotes.
 */
export function markdownLabels(t: T): MarkdownLabels {
  return { code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } }, footnotes: t('footnotes') }
}

/** Complete localized chrome for file previews.
 * @param t - Interface translation function.
 * @returns Labels used by line-numbered file cards.
 */
export function readLabels(t: T): ReadBlockLabels {
  return { codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap'), copy: t('copy'), copied: t('copied'),
    collapse: t('collapse'), collapseAria: t('collapse'), expand: count => t('hiddenLines', { count }),
    expandAria: count => t('hiddenLines', { count }), window: (shown, total) => t('lineWindow', { shown, total }) }
}

function terminalLabels(t: T): TerminalBlockLabels {
  return { signal: value => `${t('signal')}: ${value}`, exitCode: value => `${t('exitCode')}: ${value}`,
    noExitCode: t('stopped'), running: t('toolRunning'), failed: t('toolError'), done: t('toolDone'),
    copy: t('copy'), copied: t('copied'), noOutput: t('noOutput'), collapse: t('collapse'), collapseAria: t('collapse'),
    expand: count => t('hiddenLines', { count }), expandAria: count => t('hiddenLines', { count }) }
}

function ToolCard({ tool, cwd, t, openFile }: { tool: ToolRecord; cwd: string; t: T; openFile: (path: string) => void }) {
  const path = string(tool.args.path)
  const command = string(tool.args.command)
  const summary = path || command || JSON.stringify(tool.args)
  const code = object(tool.details).exitCode
  return <details className={css.tool} data-tool={tool.name}>
    <summary className={css.toolHeader}>
      <span className={css.toolIcon}>{tool.name === 'edit' || tool.name === 'write' ? <IconEditOutlineRegular size={14} /> : <IconApiOutlineRegular size={14} />}</span>
      <TextShimmer active={tool.running}><span className={css.toolName}>{tool.name}</span></TextShimmer>
      <span className={css.toolSummary}>{summary}</span>
      <StateDot state={tool.error ? 'error' : tool.running ? 'ongoing' : 'done'} />
      <IconChevronDownOutlineRegular size={12} />
    </summary>
    <div className={css.toolBody}>
      {path !== '' && <button type="button" className={css.fileLink} onClick={() => { openFile(path) }}>{path}</button>}
      {tool.name === 'bash'
        ? <TerminalBlock command={command} cwd={cwd} output={tool.output} running={tool.running}
          exitCode={typeof code === 'number' ? code : undefined} labels={terminalLabels(t)} />
        : <>
          <span className={css.detailLabel}>{t('toolArguments')}</span><pre className={css.raw}>{JSON.stringify(tool.args, null, 2)}</pre>
          {tool.output !== '' && <><span className={css.detailLabel}>{t('toolOutput')}</span><pre className={css.raw}>{plainAnsiText(tool.output)}</pre></>}
        </>}
    </div>
  </details>
}

/** Refresh only the header; pending startup keeps its clock when native timing arrives. */
function WorkHeader({ work, t, open, contentsId, toggle }: { work: WorkRecord; t: T; open: boolean; contentsId: string; toggle(): void }) {
  const statusId = useId()
  const [now, setNow] = useState(Date.now)
  const clock = useRef({ startedAt: work.startedAt ?? now, active: work.active })
  if (!work.active || !clock.current.active) clock.current.startedAt = work.startedAt ?? Date.now()
  else if (work.startedAt !== undefined) clock.current.startedAt = Math.min(clock.current.startedAt, work.startedAt)
  clock.current.active = work.active
  useEffect(() => {
    if (!work.active) return
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [work.active])
  const elapsed = now - clock.current.startedAt
  if (work.active && elapsed < 1000) return null
  const duration = work.startedAt !== undefined && work.completedAt !== undefined ? workDuration(work.completedAt - work.startedAt) : undefined
  const label = work.active ? t('runningFor', { duration: workDuration(elapsed) }) : work.outcome === 'stopped' ? (duration ? t('stoppedAfter', { duration }) : t('stopped'))
    : work.outcome === 'error' ? (duration ? t('failedAfter', { duration }) : t('toolError'))
      : duration ? t('workedFor', { duration }) : t('worked')
  return <button type="button" className={css.workHeader} aria-labelledby={statusId} aria-expanded={open} aria-controls={contentsId} onClick={toggle}>
    <span id={statusId} role={work.active ? 'status' : undefined} aria-live="off"><TextShimmer active={work.active}>{label}</TextShimmer></span>
    <IconChevronDownOutlineRegular size={12} />
  </button>
}

/** A stable disclosure header owns progress; the final answer remains outside its contents. */
function WorkSection({ work, t, renderMessage }: { work: WorkRecord; t: T; renderMessage: (message: MessageRecord, actions?: boolean) => ReactNode }) {
  const contentsId = useId()
  const [disclosure, setDisclosure] = useState<{ active: boolean; open: boolean }>()
  const open = disclosure?.active === work.active ? disclosure.open : work.active
  const last = work.messages.findLast(message => message.role === 'assistant')
  const final = last && !last.blocks.some(block => block.type === 'tool') ? last : undefined
  return <section className={css.workSection} data-work-state={work.active ? 'working' : work.outcome}>
    <WorkHeader work={work} t={t} open={open} contentsId={contentsId} toggle={() => { setDisclosure({ active: work.active, open: !open }) }} />
    <div id={contentsId} className={css.workDetails} hidden={!open}>
      {work.messages.map(message => {
        const blocks = message === final ? message.blocks.filter(block => block.type === 'thinking') : message.blocks
        return blocks.length > 0 ? renderMessage({ ...message, blocks, error: undefined }, message !== final) : null
      })}
    </div>
    {final && (final.blocks.some(block => block.type !== 'thinking') || final.error !== undefined)
      && renderMessage({ ...final, blocks: final.blocks.filter(block => block.type !== 'thinking') })}
    {work.messages.filter(message => message !== final && message.error !== undefined).map(message => <p className={css.error} key={message.id}>{message.error}</p>)}
  </section>
}

/** Show the native message time in the viewer's local timezone, omitting unavailable dates. */
function MessageTime({ timestamp }: { timestamp?: number }) {
  if (timestamp === undefined) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return <time className={css.messageTime} dateTime={date.toISOString()}>{time}</time>
}

/** Scrollable transcript preserving Pi's message order and tool identities.
 * The shared Markdown renderer displays parseable formulas during streaming and defers TeX errors until settlement.
 * @param props - Authoritative snapshot, localized chrome, and navigation callbacks.
 * @returns Shared-design message and tool cards.
 */
export function Conversation({ snapshot, pending, awaitingResponse, t, openFile, openExternal, navigate, historyDisabled, feedback }: {
  snapshot: PiSnapshot | null; awaitingResponse?: boolean; pending?: { text: string; images: { id: string; data: string; mimeType: string }[] }; t: T; openFile: (path: string) => void; openExternal: (url: string) => void
  navigate(entryId: string, action: 'navigate' | 'fork'): void; historyDisabled: boolean; feedback(text: string): void
}) {
  const messages = useMemo(() => {
    const native = snapshot ? messagesOf(snapshot) : []
    if (!pending) return native
    const local: MessageRecord = { id: 'pending', role: 'user', streaming: false, blocks: [
      ...(pending.text ? [{ type: 'text' as const, text: pending.text }] : []),
      ...pending.images.map(image => ({ type: 'image' as const, url: `data:${image.mimeType};base64,${image.data}` })),
    ] }
    return [...native, local]
  }, [snapshot, pending])
  const labels = useMemo(() => markdownLabels(t), [t])
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [actions, setActions] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (following.current && scroller.current !== null) scroller.current.scrollTop = scroller.current.scrollHeight
    const el = scroller.current
    if (el !== null) setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight >= 72)
  }, [snapshot, pending])
  const latestAssistantId = messages.findLast(message => message.role === 'assistant')?.id
  const renderMessage = (message: MessageRecord, showActions = true) => <article data-pending-prompt={message.id === 'pending' || undefined} data-latest-reply={message.role === 'assistant' && message.id === latestAssistantId || undefined} className={message.role === 'user' ? css.userMessage : css.assistantMessage} key={message.id}>
          {message.blocks.map((block, index) => {
            switch (block.type) {
              case 'skill': return <div className={css.bubble} key={index}><details className={css.skillInvocation}><summary><IconSkillOutlineRegular size={16}/><span>/skill:{block.skill.name}</span><IconChevronDownOutlineRegular size={12}/></summary><code className={css.skillSource}>{block.skill.location}</code><pre className={css.skillContent}>{block.skill.content}</pre></details>{block.skill.prompt && <div className={css.skillPrompt}>{block.skill.prompt}</div>}</div>
              case 'text': return message.role === 'user'
                ? <div className={css.bubble} key={index}>{block.text}</div>
                : <div className={css.answer} key={index}><MarkdownText text={plainAnsiText(block.text)} streaming={message.streaming} labels={labels} /></div>
              case 'thinking': {
                const text = plainAnsiText(block.text).replace(/^\s*thinking:\s*/i, '')
                return <details className={css.thinking} key={index} open>
                  <summary><TextShimmer active={message.streaming}>{t('thinking')}</TextShimmer><IconChevronDownOutlineRegular size={12} /></summary>
                  {text.trim() ? <MarkdownText text={text} streaming={message.streaming} labels={labels} variant="compact" />
                    : !message.streaming && <p className={css.thinkingEmpty}>{t('thinkingUnavailable')}</p>}
                </details>
              }
              case 'summary': return <details className={css.thinking} key={index}>
                <summary>{t(block.kind === 'compaction' ? 'compactionSummary' : 'branchSummary')}<IconChevronDownOutlineRegular size={12} /></summary>
                <MarkdownText text={plainAnsiText(block.text)} labels={labels} variant="compact" /></details>
              case 'tool': return <ToolCard key={block.tool.id || index} tool={block.tool} cwd={string(snapshot?.state.cwd)} t={t} openFile={openFile} />
              case 'image': return <img className={css.messageImage} key={index} src={block.url} alt={t('image')} />
            }
          })}
          {message.error !== undefined && <p className={css.error}>{message.error}</p>}
          {showActions && message.id !== 'pending' && <div className={css.messageActions}>
            {message.blocks.some(block => block.type === 'text' || block.type === 'summary' || block.type === 'skill') && <Tooltip label={t('copyMessage')} portal side="top" delayMs={350}><button type="button" className={css.iconButton} aria-label={t('copyMessage')} onClick={() => {
              const text = message.blocks.flatMap(block => block.type === 'text' || block.type === 'summary' || block.type === 'skill' ? [block.text] : []).join('\n\n')
              void writeClipboard(text).then(ok => { feedback(t(ok ? 'copied' : 'copyFailed')) })
            }}><IconCopyOutlineRegular size={14} /></button></Tooltip>}
            {message.entryId !== undefined && (message.role === 'user' || message.role === 'assistant') && <Menu portal side="top" align={message.role === 'user' ? 'end' : 'start'} open={actions === message.id} onClose={() => { setActions(null) }}
              anchor={<Tooltip label={t('messageActions')} portal side="top" delayMs={350} disabled={actions === message.id}><button type="button" className={css.iconButton} aria-label={t('messageActions')} disabled={historyDisabled} aria-haspopup="menu" aria-expanded={actions === message.id} onClick={() => { setActions(actions === message.id ? null : message.id) }}><IconBranchOutlineRegular size={14} /></button></Tooltip>}
              items={[{ id: 'navigate', label: t('continueHere') }, { id: 'fork', label: t('fork') }]}
              onSelect={action => { setActions(null); if (message.entryId !== undefined && (action === 'navigate' || action === 'fork')) navigate(message.entryId, action) }} />}
            <MessageTime timestamp={message.timestamp} />
          </div>}
        </article>

  const active = !!pending || snapshot?.state.isStreaming === true || !!awaitingResponse && messages.at(-1)?.role === 'user'
  const rows = workRows(messages, active)
  return <div className={css.transcript} role="log" aria-label={t('conversation')} aria-live="off" tabIndex={0} ref={scroller} onScroll={() => {
    const el = scroller.current
    if (el !== null) { following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; setShowJump(!following.current) }
  }}>
    <MarkdownDelegateProvider openFile={openFile} openExternalLink={openExternal}>
      <div className={css.messageColumn}>
        {rows.map(row => row.type === 'message' ? renderMessage(row.message) : <WorkSection key={row.work.id} work={row.work} t={t} renderMessage={renderMessage} />)}
        {snapshot?.state.isCompacting && <div className={css.running} role="status"><TextShimmer active>{t('compacting')}</TextShimmer></div>}
        {Object.entries(snapshot?.statuses ?? {}).map(([key, text]) => <div className={css.status} key={key}>{plainAnsiText(text)}</div>)}
        {Object.entries(snapshot?.widgets ?? {}).map(([key, lines]) => <pre className={css.widget} key={key}>{plainAnsiText(lines.join('\n'))}</pre>)}
      </div>
    </MarkdownDelegateProvider>
    {showJump && <div className={css.jumpToBottom}><Button size="sm" icon={<IconChevronDownOutlineRegular size={14} />} onClick={() => {
      following.current = true; setShowJump(false)
      if (scroller.current !== null) scroller.current.scrollTop = scroller.current.scrollHeight
    }}>{t('backToBottom')}</Button></div>}
  </div>
}

/** A read-only file preview with the original GUI's line-numbered source card.
 * @param props - Host text file and localized renderer chrome.
 * @returns File preview content.
 */
export function FileContent({ path, content, t }: { path: string; content: string; t: T }) {
  const labels = useMemo(() => readLabels(t), [t])
  const lines = useMemo(() => content.split('\n').map((text, index) => ({ number: index + 1, text })), [content])
  return <ReadBlock label={path} lines={lines} totalLines={lines.length} labels={labels} lang={languageForPath(path)} maxLines={Infinity} />
}
