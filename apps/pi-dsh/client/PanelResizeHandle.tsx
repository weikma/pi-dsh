/** Accessible horizontal resize gestures with capture and a shield over embedded browser content. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import css from './App.module.css'

interface Props {
  side: 'left' | 'right'; label: string; controls: string; value: number; preferred: number; min: number; max: number
  change(value: number): void; commit(value: number): void; resizing(active: boolean): void
}

/** Pointer release saves once; Escape, lost capture and window blur restore the starting width. */
export function PanelResizeHandle(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const drag = useRef<{ pointer: number; x: number; width: number; preferred: number; value: number; element: HTMLDivElement } | null>(null)
  const [active, setActive] = useState(false)
  const finish = (save: boolean) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer)
    setActive(false)
    latest.current.resizing(false)
    if (save && current.value !== current.width) latest.current.commit(current.value)
    else latest.current.change(current.preferred)
  }
  const end = useRef(finish)
  end.current = finish
  useEffect(() => {
    const cancel = () => { end.current(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel() }
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true); end.current(false) }
  }, [])
  const clamp = (value: number) => Math.round(Math.max(props.min, Math.min(value, props.max)))
  const moved = (x: number) => {
    const current = drag.current
    if (!current) return
    const value = clamp(current.width + (x - current.x) * (props.side === 'left' ? 1 : -1))
    if (value !== current.value) { current.value = value; props.change(value) }
  }
  return <>
    <div role="separator" aria-label={props.label} aria-controls={props.controls} aria-orientation="vertical" aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      tabIndex={0} className={clsx(css.resizeHandle, props.side === 'left' ? css.sidebarResize : css.workspaceResize, active && css.resizeActive)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointer: event.pointerId, x: event.clientX, width: props.value, preferred: props.preferred, value: props.value, element: event.currentTarget }
        setActive(true); props.resizing(true)
      }}
      onPointerMove={event => { if (drag.current?.pointer === event.pointerId) moved(event.clientX) }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { moved(event.clientX); finish(true) } }}
      onPointerCancel={() => { finish(false) }} onLostPointerCapture={() => { finish(false) }}
      onKeyDown={event => {
        if (drag.current) return
        const direction = props.side === 'left' ? 1 : -1
        const value = event.key === 'Home' ? props.min : event.key === 'End' ? props.max : event.key === 'ArrowLeft' ? props.value - 16 * direction : event.key === 'ArrowRight' ? props.value + 16 * direction : null
        if (value === null) return
        event.preventDefault(); props.change(clamp(value)); props.commit(clamp(value))
      }} />
    {active && createPortal(<div className={css.resizeShield} aria-hidden="true" />, document.body)}
  </>
}
