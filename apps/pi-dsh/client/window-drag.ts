/** Recollect Electron's macOS drag rectangles after native chrome moves or disappears. */
const ROW = '[data-window-drag]'
const RECALL = 'data-window-drag-recall'
const MOTION = ['transitionstart', 'transitionend', 'animationstart', 'animationend'] as const

/** Document and deterministic frame/box observers for one native window. */
export interface WindowDragOptions {
  document: Document
  scheduleFrame?: (callback: () => void) => () => void
  watchBox?: (row: Element, changed: () => void) => () => void
}

/**
 * Pulse app-region styles when chrome geometry changes; ordinary Web installs nothing.
 * @param options - Owned document and optional frame/resize observation seams.
 * @returns Disposer for observers, queued frames and the recall attribute.
 */
export function installWindowDragRecall(options: WindowDragOptions): () => void {
  const doc = options.document
  if (doc.documentElement.dataset.platform !== 'darwin' || !doc.documentElement.hasAttribute('data-desktop')) return () => {}
  const scheduleFrame = options.scheduleFrame ?? (callback => {
    const frame = requestAnimationFrame(callback)
    return () => { cancelAnimationFrame(frame) }
  })
  const watchBox = options.watchBox ?? ((row, changed) => {
    if (typeof ResizeObserver !== 'function') return () => {}
    const observer = new ResizeObserver(changed)
    observer.observe(row)
    return () => { observer.disconnect() }
  })
  let geometry = new Map<Element, string>()
  const boxes = new Map<Element, () => void>()
  let cancel: (() => void) | undefined
  let scheduled = false
  let disposed = false
  let grace = 0

  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    cancel = scheduleFrame(() => {
      scheduled = false
      cancel = undefined
      if (disposed) return
      measure()
    })
  }
  const arm = (): void => { grace = 2; schedule() }
  const measure = (): void => {
    // Reading each rectangle flushes the cleared style before the next pulse.
    doc.body.removeAttribute(RECALL)
    const rows = [...doc.querySelectorAll(ROW)]
    for (const [row, stop] of boxes) {
      if (rows.includes(row)) continue
      stop(); boxes.delete(row)
    }
    for (const row of rows) if (!boxes.has(row)) boxes.set(row, watchBox(row, arm))
    const next = new Map(rows.map(row => {
      const rect = row.getBoundingClientRect()
      return [row, `${rect.x},${rect.y},${rect.width},${rect.height}`] as const
    }))
    const moved = next.size !== geometry.size || rows.some(row => next.get(row) !== geometry.get(row))
    geometry = next
    if (moved) { doc.body.setAttribute(RECALL, ''); grace = 0; schedule() }
    else if (grace > 0) { grace -= 1; schedule() }
  }
  const element = (value: Node): Element | null => value instanceof Element ? value : value.parentElement
  const touches = (record: MutationRecord): boolean => {
    if (record.attributeName === RECALL) return false
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node instanceof Element && (node.matches(ROW) || node.querySelector(ROW))) return true
    }
    const target = element(record.target)
    if (!target) return false
    if (record.type === 'childList') return [...geometry.keys()].some(row => target.contains(row))
    return target.closest(ROW) !== null || target.querySelector(ROW) !== null
  }
  const observer = new MutationObserver(records => { if (records.some(touches)) arm() })
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  const motion = (event: Event): void => {
    if (event.target instanceof Element && (event.target.closest(ROW) || event.target.querySelector(ROW))) arm()
  }
  for (const event of MOTION) doc.addEventListener(event, motion, true)
  doc.defaultView?.addEventListener('resize', arm)
  arm()
  return () => {
    disposed = true
    observer.disconnect()
    for (const event of MOTION) doc.removeEventListener(event, motion, true)
    doc.defaultView?.removeEventListener('resize', arm)
    cancel?.()
    for (const stop of boxes.values()) stop()
    boxes.clear(); geometry.clear()
    doc.body.removeAttribute(RECALL)
  }
}
