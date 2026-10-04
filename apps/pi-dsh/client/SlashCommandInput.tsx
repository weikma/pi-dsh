/** Composer-owned listbox using Harness's menu surface, full-width rows and retained editor focus. */
import { Fragment, useEffect, useLayoutEffect, useId, useRef, useState, type RefObject, type MutableRefObject } from 'react'
import clsx from 'clsx'
import { MenuSurface, useAnchoredMaxHeight, IconDatabaseOutlineRegular, IconThinkOutlineRegular, IconCompactOutlineRegular, IconBranchOutlineRegular, IconInfoOutlineRegular, IconEditOutlineRegular, IconNewChatOutlineRegular, IconSearchOutlineRegular, IconSettingsOutlineRegular, IconCopyOutlineRegular, IconDownloadOutlineRegular, IconSkillOutlineRegular, IconListPenOutlineRegular, IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlashCommand, SlashIcon } from './slash-commands.ts'
import type { translate } from './i18n.ts'
import css from './SlashCommandInput.module.css'

export const slashIcons = { model: IconDatabaseOutlineRegular, thinking: IconThinkOutlineRegular, compact: IconCompactOutlineRegular, branch: IconBranchOutlineRegular, info: IconInfoOutlineRegular, edit: IconEditOutlineRegular, new: IconNewChatOutlineRegular, search: IconSearchOutlineRegular, settings: IconSettingsOutlineRegular, copy: IconCopyOutlineRegular, export: IconDownloadOutlineRegular, skill: IconSkillOutlineRegular, prompt: IconListPenOutlineRegular, pi: IconCodeOutlineRegular } satisfies Record<SlashIcon, typeof IconCodeOutlineRegular>

interface Props {
  inputRef: RefObject<HTMLTextAreaElement>
  selectionRef: MutableRefObject<SlashCommand | null>
  className: string
  value: string
  placeholder: string
  label: string
  commands: readonly SlashCommand[]
  t: (key: Parameters<typeof translate>[1]) => string
  change: (value: string) => void
  dismiss: () => void
  complete: (command: SlashCommand) => void
  choose: (command: SlashCommand, submitExactNative?: boolean) => void
  submit: () => void
}

/** Arrow/mouse selection leaves focus in the textarea; Tab completes and Enter chooses. IME keeps its keys. */
export function SlashCommandInput({ inputRef, selectionRef, className, value, placeholder, label, commands, t, change, dismiss, complete, choose, submit }: Props) {
  const id = useId()
  const surface = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState<{ query: string; name: string } | null>(null)
  const [overflow, setOverflow] = useState(false)
  const [composing, setComposing] = useState(false)
  const open = commands.length > 0 && !composing
  const selected = commands.find(command => highlight?.query === value && command.name === highlight.name) ?? commands[0]
  useLayoutEffect(() => { selectionRef.current = open ? selected ?? null : null; return () => { selectionRef.current = null } }, [open, selected, selectionRef])
  const index = commands.findIndex(command => command.name === selected?.name)
  const [topMargin, setTopMargin] = useState(60)
  useLayoutEffect(() => {
    if (!open) return
    // Measure the visible header: Windows reserves a separate caption strip; fullscreen can remove it.
    const fit = () => { setTopMargin((inputRef.current?.closest('main')?.querySelector('header')?.getBoundingClientRect().bottom ?? 52) + 8) }
    fit(); window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [open, inputRef])
  const maxHeight = useAnchoredMaxHeight(surface, 400, commands, topMargin)
  const optionId = (name: string) => id + '-' + name
  const updateOverflow = () => { const element = viewport.current; setOverflow(element !== null && element.scrollTop + element.clientHeight < element.scrollHeight - 1) }
  useEffect(() => {
    if (!open || selected === undefined) return
    const option = document.getElementById(optionId(selected.name))
    option?.scrollIntoView?.({ block: 'nearest' })
    updateOverflow()
  }, [open, selected?.name, value, maxHeight])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || surface.current?.closest('form')?.contains(event.target)) return
      dismiss()
    }
    const frameFocus = () => { if (document.activeElement instanceof HTMLIFrameElement) dismiss() }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', frameFocus)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', frameFocus) }
  }, [open, dismiss])
  return <>
    {open && <MenuSurface ref={surface} className={css.menu} style={{ maxHeight }} data-overflow-below={overflow || undefined}>
      <div ref={viewport} id={id} className={css.viewport} role="listbox" aria-label={t('slashSuggestions')} onScroll={updateOverflow}>
        {commands.map((command, i) => {
          const Icon = slashIcons[command.icon]
          return <Fragment key={command.name}>
            {command.group !== commands[i - 1]?.group && <div role="presentation" className={css.group}>{t(command.group)}</div>}
            <button type="button" role="option" tabIndex={-1} id={optionId(command.name)} aria-selected={command.name === selected?.name} aria-label={`${command.label} /${command.name} ${command.description}`} data-command={command.name}
              className={clsx(css.item, command.name === selected?.name && css.active)}
              onMouseDown={event => { event.preventDefault() }} onMouseMove={() => { if (command.name !== selected?.name) setHighlight({ query: value, name: command.name }) }} onClick={() => { choose(command) }}>
              <span className={css.icon} aria-hidden><Icon size={14} /></span><span className={css.name}>{command.label}</span>{command.label.toLocaleLowerCase() !== command.name.toLocaleLowerCase() && <span className={css.alias}>/{command.name}</span>}<span className={css.description}>{command.description}</span>
            </button>
          </Fragment>
        })}
      </div>
      <div className={css.hint}>{t('slashKeyboardHint')}</div>
    </MenuSurface>}
    <textarea ref={inputRef} className={className} aria-label={label} placeholder={placeholder} value={value} aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && selected !== undefined ? optionId(selected.name) : undefined}
      onChange={event => { change(event.target.value) }} onCompositionStart={() => { setComposing(true) }} onCompositionEnd={() => { setComposing(false) }}
      onKeyDown={event => {
        if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (open && selected !== undefined) {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return }
          if (event.key === 'Tab' && event.shiftKey) { dismiss(); return }
          if (!event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault(); const next = commands[(index + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length]
            if (next !== undefined) setHighlight({ query: value, name: next.name })
            return
          }
          if (event.key === 'Tab') { event.preventDefault(); complete(selected); return }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); choose(selected, true); return }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
      }} />
  </>
}
