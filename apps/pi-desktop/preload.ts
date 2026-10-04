/** Restricted native controls; model execution and files stay on the local Host. */
import { contextBridge, ipcRenderer } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

const markPlatform = (): void => {
  document.documentElement.dataset.platform = process.platform
  document.documentElement.dataset.desktop = ''
  if (process.platform === 'win32') {
    document.documentElement.dataset.windowsTitlebar = ''
    document.documentElement.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT}px`)
  }
}
if (document.documentElement) markPlatform()
else window.addEventListener('DOMContentLoaded', markPlatform, { once: true })
ipcRenderer.on('pi-desktop:fullscreen', (_event, fullscreen: unknown) => {
  if (typeof fullscreen === 'boolean') document.documentElement.toggleAttribute('data-fullscreen', fullscreen)
})
ipcRenderer.on('pi-desktop:panel-shortcut', (_event, files: unknown) => {
  if (typeof files === 'boolean') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: process.platform === 'darwin', ctrlKey: process.platform !== 'darwin', altKey: files, bubbles: true, cancelable: true }))
})
contextBridge.exposeInMainWorld('piDesktop', {
  platform: process.platform,
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('pi-desktop:pick-directory'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('pi-desktop:open-external', url),
  openPiTerminal: (cwd?: string): Promise<void> => ipcRenderer.invoke('pi-desktop:open-pi-terminal', cwd),
  openFile: (request: unknown): Promise<void> => ipcRenderer.invoke('pi-desktop:open-file', request),
  createBrowser: (): Promise<{ id: string; partition: string }> => ipcRenderer.invoke('pi-desktop:create-browser'),
  closeBrowser: (id: string): Promise<void> => ipcRenderer.invoke('pi-desktop:close-browser', id),
  ...(process.platform === 'darwin' ? { setUnreadCount: (count: number): Promise<void> => ipcRenderer.invoke('pi-desktop:unread-count', count) } : {}),
})
