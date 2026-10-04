/** Desktop browser guests have independent storage and no native application bridge. */
import { randomUUID } from 'node:crypto'
import { session, type BrowserWindow, type WebContents } from 'electron'
import { browserUrl } from './browser-policy.ts'

interface Guest { partition: string; contents?: WebContents }

/** Leases bind renderer-created webviews to main-owned, restricted Electron sessions. */
export class BrowserGuests {
  private readonly guests = new Map<string, Guest>()
  constructor(private readonly window: BrowserWindow, private readonly applicationUrl: string) {
    window.webContents.on('will-attach-webview', (event, preferences, params) => {
      const guest = [...this.guests.values()].find(value => value.partition === params.partition)
      if (!guest || guest.contents || params.src !== 'about:blank') { event.preventDefault(); return }
      delete preferences.preload
      Object.assign(preferences, { nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true, navigateOnDragDrop: false })
    })
    window.webContents.on('did-attach-webview', (_event, contents) => {
      const guest = [...this.guests.values()].find(value => session.fromPartition(value.partition) === contents.session)
      if (!guest || guest.contents) { contents.close({ waitForBeforeUnload: false }); return }
      guest.contents = contents
      const allowed = (url: string): boolean => { try { browserUrl(url, applicationUrl); return true } catch (error) { void error; return false } }
      contents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
      contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
      contents.setWindowOpenHandler(({ url }) => {
        if (allowed(url)) void contents.loadURL(url).catch(error => { void error /* did-fail-load reports navigation errors in the guest toolbar. */ })
        return { action: 'deny' }
      })
      contents.on('will-prevent-unload', event => { event.preventDefault() })
      contents.on('before-input-event', (event, input) => {
        const modifier = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
        if (input.type === 'keyDown' && !input.isAutoRepeat && !input.shift && modifier && input.code === 'KeyB') {
          event.preventDefault(); window.webContents.send('pi-desktop:panel-shortcut', input.alt)
        }
      })
    })
    window.webContents.on('render-process-gone', () => { this.closeAll() })
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) this.closeAll() })
    window.once('closed', () => { this.closeAll() })
  }

  create(): { id: string; partition: string } {
    if (this.guests.size >= 16) throw new Error('Close a browser tab before opening another')
    const id = randomUUID(), partition = `pi-browser-${id}`
    const isolated = session.fromPartition(partition)
    isolated.setPermissionRequestHandler((_contents, _permission, accept) => { accept(false) })
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => { event.preventDefault() })
    isolated.webRequest.onBeforeRequest((request, finish) => {
      let cancel = false
      try {
        const url = new URL(request.url), own = new URL(this.applicationUrl)
        cancel = url.protocol === 'file:' || url.origin === own.origin || ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(url.hostname) && url.port === own.port
        if (request.resourceType === 'mainFrame' && request.url !== 'about:blank') browserUrl(request.url, this.applicationUrl)
      } catch (error) { void error; cancel = true }
      finish({ cancel })
    })
    this.guests.set(id, { partition })
    return { id, partition }
  }

  close(id: string): void {
    const guest = this.guests.get(id)
    if (!guest) return
    if (guest.contents && !guest.contents.isDestroyed()) guest.contents.close({ waitForBeforeUnload: false })
    this.guests.delete(id)
  }
  closeAll(): void { for (const id of this.guests.keys()) this.close(id) }
}
