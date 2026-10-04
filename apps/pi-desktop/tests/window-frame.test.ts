/** Native drag geometry is recollected after collapse, fullscreen and overlay changes. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { installWindowDragRecall } from '../client/window-drag.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from '../windows-layout.ts'

async function frameFixture(native = true) {
  const packageName = 'jsdom'
  const { JSDOM }: { JSDOM: new (html: string) => { window: Window & typeof globalThis } } = await import(packageName)
  const dom = new JSDOM(`<html ${native ? 'data-platform="darwin" data-desktop' : 'data-platform="web"'}><body><div id="root"><header data-window-drag><button>Toggle</button></header><main><textarea></textarea></main></div></body></html>`)
  const original = new Map(['Element', 'MutationObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'MutationObserver', { value: dom.window.MutationObserver, writable: true, configurable: true })
  const document = dom.window.document
  const row = document.querySelector('header')!
  let left = 280
  Object.defineProperty(row, 'getBoundingClientRect', { value: () => ({ x: left, y: 0, width: 700 - left, height: 52 }) })
  const frames = new Set<() => void>()
  const boxes = new Map<Element, () => void>()
  const stop = installWindowDragRecall({ document,
    scheduleFrame(callback) { frames.add(callback); return () => { frames.delete(callback) } },
    watchBox(element, changed) { boxes.set(element, changed); return () => { boxes.delete(element) } },
  })
  return { document, row, frames, boxes,
    move(value: number) { left = value; boxes.get(row)?.() },
    frame() { const scheduled = [...frames]; frames.clear(); for (const callback of scheduled) callback() },
    async mutations() { await Promise.resolve(); await Promise.resolve() },
    dispose() {
      stop()
      dom.window.close()
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

test('native chrome moves and unmounts pulse drag recollection without keeping observers alive', async () => {
  const fixture = await frameFixture()
  try {
    fixture.frame()
    assert.ok(fixture.document.body.hasAttribute('data-window-drag-recall'))
    fixture.frame()
    assert.equal(fixture.document.body.hasAttribute('data-window-drag-recall'), false)
    fixture.move(0)
    fixture.frame()
    assert.ok(fixture.document.body.hasAttribute('data-window-drag-recall'))
    fixture.frame()
    assert.equal(fixture.document.body.hasAttribute('data-window-drag-recall'), false)
    fixture.row.remove()
    await fixture.mutations()
    fixture.frame()
    assert.ok(fixture.document.body.hasAttribute('data-window-drag-recall'))
    fixture.frame()
    assert.equal(fixture.boxes.size, 0)
  } finally { fixture.dispose() }
  assert.equal(fixture.frames.size, 0)
})

test('fullscreen changes remeasure native chrome while ordinary Web installs no drag observer', async () => {
  const native = await frameFixture()
  try {
    native.frame(); native.frame()
    native.document.documentElement.setAttribute('data-fullscreen', '')
    await native.mutations()
    assert.equal(native.frames.size, 1)
    native.frame()
  } finally { native.dispose() }
  const web = await frameFixture(false)
  try { assert.equal(web.frames.size, 0); assert.equal(web.boxes.size, 0) }
  finally { web.dispose() }
})

test('macOS collapse hides the rail and reserves native-control clearance, including portalled interactive surfaces', async () => {
  const [frame, base] = await Promise.all([
    readFile(new URL('../client/App.module.css', import.meta.url), 'utf8'),
    readFile(new URL('../client/base.css', import.meta.url), 'utf8'),
  ])
  assert.match(frame, /darwin[^\n]*\.collapsed\s*\{[^}]*--pi-sidebar-width:\s*0px;[^}]*--dsh-frame-leading-clearance:\s*160px;/)
  assert.match(frame, /\.sidebar\s*\{[^}]*overflow:\s*hidden;/)
  assert.match(frame, /\.collapsed\s+\.sidebarInner\s*\{[^}]*visibility:\s*hidden;/)
  assert.match(frame, /data-fullscreen[^\n]*\.collapsed\s*\{[^}]*--dsh-frame-leading-clearance:\s*84px;/)
  assert.match(frame, /data-fullscreen[^\n]*\.leadingSeat\s*\{\s*left:\s*12px;/)
  assert.match(base, /html\[data-desktop\]\s+body\s*>\s*:not\(#root\)/)
  assert.match(base, /textarea[^}]*\[role='dialog'\][^}]*-webkit-app-region:\s*no-drag;/s)
})

test('Windows caption clears every column, viewport preview and overlay, then clears fullscreen', async () => {
  const [frame, base, main, preload] = await Promise.all([
    readFile(new URL('../client/App.module.css', import.meta.url), 'utf8'),
    readFile(new URL('../client/base.css', import.meta.url), 'utf8'),
    readFile(new URL('../main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../preload.ts', import.meta.url), 'utf8'),
  ])
  assert.equal(WINDOWS_TITLEBAR_HEIGHT, 40)
  assert.match(main, /titleBarOverlay:\s*\{\s*height:\s*WINDOWS_TITLEBAR_HEIGHT/)
  assert.match(preload, /process\.platform === 'win32'[\s\S]*dataset\.windowsTitlebar = ''[\s\S]*setProperty\('--dsh-windows-titlebar-height', `\$\{WINDOWS_TITLEBAR_HEIGHT\}px`\)/)
  assert.match(frame, /html\[data-windows-titlebar\][^\n]*\.app\s*\{\s*padding-top:\s*var\(--dsh-frame-chrome-top\);\s*grid-template-rows:\s*minmax\(0, 1fr\)/)
  assert.match(frame, /html\[data-windows-titlebar\][^\n]*\.app::before\s*\{[^}]*height:\s*var\(--dsh-frame-chrome-top\);[^}]*-webkit-app-region:\s*drag;/)
  assert.match(frame, /\.preview\s*\{[^}]*top:\s*var\(--dsh-frame-chrome-top, 0px\);/)
  assert.match(base, /html\[data-windows-titlebar\]\s*\{[^}]*--dsh-frame-chrome-top:\s*var\(--dsh-windows-titlebar-height\);/)
  assert.match(base, /html\[data-windows-titlebar\]\[data-fullscreen\]\s*\{[^}]*--dsh-frame-overlay-top:\s*20px;[^}]*--dsh-frame-chrome-top:\s*0px;/)
})

test('hidden navigation leaves the main in its nonzero track, with preview placement explicit at both widths', async () => {
  const frame = await readFile(new URL('../client/App.module.css', import.meta.url), 'utf8')
  assert.match(frame, /(?:^|\n)\.main\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/)
  assert.match(frame, /(?:^|\n)\.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/)
  assert.match(frame, /(?:^|\n)\.preview\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/)
  assert.match(frame, /\.app\s*\{[^}]*grid-template-columns:\s*var\(--pi-sidebar-width\) minmax\(0, 1fr\) 0px;/)
  assert.match(frame, /\.app\.withPreview\s*\{\s*grid-template-columns:\s*var\(--pi-sidebar-width\) minmax\(0, 1fr\) var\(--pi-workspace-width, 420px\);/)
  // The narrow preview uses the entire positioned frame, not column three's grid area.
  assert.match(frame, /@media \(max-width: 1024px\)\s*\{\s*\.preview\s*\{[^}]*position:\s*absolute;[^}]*grid-column:\s*auto;[^}]*grid-row:\s*auto;[^}]*top:\s*var\(--dsh-frame-chrome-top, 0px\);/)
})
