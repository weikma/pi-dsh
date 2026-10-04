/** Cross-platform Electron carrier for the same local Pi Web application. */
import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, shell, ipcMain, dialog } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHost } from './server.ts'
import { readDesktopLoginShellEnvironment, resolveDesktopLoginShellConfig } from './login-shell-environment.ts'
import { openPiTerminal } from './pi-setup.ts'
import { loadRuntime } from './runtime/config.ts'
import { homedir } from 'node:os'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
import { FileEditor, nativeFileRequest } from './file-actions.ts'
import { isJsonObject } from './bridge/types.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const copy = {
  en: { name: 'Pi-DSH', quit: 'Quit Pi-DSH', open: 'Open Pi-DSH', browser: 'Open in Browser', about: 'About Pi-DSH', hide: 'Hide Pi-DSH', files: 'File', edit: 'Edit', view: 'View', window: 'Window', project: 'Select project directory', error: 'Pi-DSH could not start', active: 'Tasks or terminals are still running. Quit and stop them?', cancel: 'Keep Working', editor: 'Choose a file editor' },
  zh: { name: 'Pi-DSH', quit: '退出 Pi-DSH', open: '打开 Pi-DSH', browser: '在浏览器中打开', about: '关于 Pi-DSH', hide: '隐藏 Pi-DSH', files: '文件', edit: '编辑', view: '显示', window: '窗口', project: '选择项目目录', error: 'Pi-DSH 无法启动', active: '任务或终端仍在运行。是否退出并停止它们？', cancel: '继续工作', editor: '选择文件编辑器' },
}
const text = app.getLocale().startsWith('zh') ? copy.zh : copy.en
let window: BrowserWindow | undefined
let environmentStarting: Promise<void> | undefined
let tray: Tray | undefined
let host: Awaited<ReturnType<typeof startHost>> | undefined
let hostStarting: ReturnType<typeof startHost> | undefined
let url = process.env.PI_DESKTOP_UI_URL
let quitting = false
let stopped = false
let stopping = false
let startupComplete = false
const startup = new AbortController()
const icon = join(root, 'assets', process.platform === 'darwin' ? 'icon-macos.png' : process.platform === 'win32' ? 'icon-windows.ico' : 'icon-windows.png')

function show(): void {
  const current = window
  if (!current || current.isDestroyed()) return
  if (current.isMinimized()) current.restore()
  current.show(); current.focus()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.on('activate', show)
  const stopFromSignal = (): void => { quitting = true; app.quit() }
  process.once('SIGTERM', stopFromSignal)
  process.once('SIGINT', stopFromSignal)
  app.on('before-quit', event => {
    if (!quitting && host?.hasActiveTasks() && window) {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', message: text.active, buttons: [text.cancel, text.quit], defaultId: 0, cancelId: 0 })
      if (choice === 0) { event.preventDefault(); return }
    }
    quitting = true
    startup.abort()
    if (!stopped && (host || hostStarting || environmentStarting || stopping)) {
      event.preventDefault()
      if (stopping) return
      stopping = true
      const owned = host
      const pending = hostStarting
      host = undefined
      const environment = environmentStarting
      void Promise.allSettled([Promise.resolve(owned ?? pending).then(async acquired => { await acquired?.close() }), environment]).then(results => {
        for (const result of results) if (result.status === 'rejected') console.error(result.reason)
        stopped = true; app.quit()
      })
    }
  })
  app.on('window-all-closed', () => { if (startupComplete && process.platform !== 'darwin' && !tray) app.quit() })
  void app.whenReady().then(async () => {
    if (!url && app.isPackaged) {
      process.env.PI_DESKTOP_RUNTIME_CONFIG ??= join(app.getPath('userData'), 'runtime.json')
      process.env.PI_DESKTOP_BUNDLED_RUNTIME ??= join(process.resourcesPath, 'runtime')
      process.env.PI_DESKTOP_SESSION_EXTENSION = join(process.resourcesPath, 'pi-session-controls.mjs')
    }
    const environmentReady = readDesktopLoginShellEnvironment(process.env, resolveDesktopLoginShellConfig(process.env), { signal: startup.signal })
      .then(inherited => { if (!quitting) Object.assign(process.env, inherited.environment) })
      .finally(() => { environmentStarting = undefined })
    environmentStarting = environmentReady
    void environmentReady.catch(error => { console.error(error) })
    if (process.platform === 'darwin') app.dock?.setIcon(join(root, 'assets', 'icon-macos.png'))
    if (!url) {
      hostStarting = startHost({ port: 0, environmentReady, ...(app.isPackaged ? { officeScript: join(process.resourcesPath, 'office-preview.py'), providerWorker: join(process.resourcesPath, 'provider-worker.mjs') } : {}) })
      let acquired: Awaited<ReturnType<typeof startHost>>
      try { acquired = await hostStarting } finally { hostStarting = undefined }
      if (quitting) return
      host = acquired
      url = host.url
    }
    startupComplete = true
    const applicationUrl = url
    window = new BrowserWindow({
      width: 1280, height: 820, minWidth: 700, minHeight: 560, show: false, title: text.name,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' } : {}),
      ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT } } : {}),
      icon,
      webPreferences: { preload: join(root, 'dist', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: true },
    })
    window.once('ready-to-show', show)
    const applicationWindow = window
    const sendFullscreen = (): void => {
      if (!applicationWindow.isDestroyed()) applicationWindow.webContents.send('pi-desktop:fullscreen', applicationWindow.isFullScreen())
    }
    applicationWindow.on('enter-full-screen', sendFullscreen)
    applicationWindow.on('leave-full-screen', sendFullscreen)
    applicationWindow.webContents.on('did-finish-load', sendFullscreen)
    if (process.platform === 'darwin') {
      // AppKit reattaches vibrancy after restore; use an opaque fill during that gap.
      const applyBackdrop = (): void => {
        if (applicationWindow.isDestroyed()) return
        const visible = applicationWindow.isVisible() && !applicationWindow.isMinimized()
        applicationWindow.setVibrancy(visible ? 'sidebar' : null)
        applicationWindow.setBackgroundColor(visible ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb')
      }
      applicationWindow.on('minimize', applyBackdrop)
      applicationWindow.on('hide', applyBackdrop)
      applicationWindow.on('restore', applyBackdrop)
      applicationWindow.on('show', applyBackdrop)
    }
    applicationWindow.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
      const template: Electron.MenuItemConstructorOptions[] = isEditable ? [
        { role: 'undo', enabled: editFlags.canUndo }, { role: 'redo', enabled: editFlags.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut }, { role: 'copy', enabled: editFlags.canCopy }, { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' }, { role: 'selectAll', enabled: editFlags.canSelectAll },
      ] : selectionText ? [{ role: 'copy' }] : []
      if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: applicationWindow })
    })
    window.on('close', event => {
      if (!quitting && (process.platform === 'darwin' || tray !== undefined)) {
        event.preventDefault()
        if (applicationWindow.isFullScreen()) {
          applicationWindow.once('leave-full-screen', () => { if (!quitting && !applicationWindow.isDestroyed()) applicationWindow.hide() })
          applicationWindow.setFullScreen(false)
        } else applicationWindow.hide()
      }
    })
    window.webContents.setWindowOpenHandler(({ url: link }) => { if (/^https?:/.test(link)) void shell.openExternal(link); return { action: 'deny' } })
    window.webContents.on('will-navigate', (event, destination) => {
      if (new URL(destination).origin !== new URL(applicationUrl).origin) { event.preventDefault(); if (/^https?:/.test(destination)) void shell.openExternal(destination) }
    })
    const trusted = (event: Electron.IpcMainInvokeEvent): void => {
      if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin) throw new Error('Untrusted native bridge caller')
    }
    const browsers = new BrowserGuests(applicationWindow, applicationUrl)
    ipcMain.handle('pi-desktop:create-browser', event => { trusted(event); return browsers.create() })
    ipcMain.handle('pi-desktop:close-browser', (event, id: unknown) => { trusted(event); if (typeof id !== 'string') throw new Error('Browser identity required'); browsers.close(id) })
    ipcMain.handle('pi-desktop:unread-count', (event, count: unknown) => {
      trusted(event)
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Unread count must be a nonnegative integer')
      if (process.platform === 'darwin') app.setBadgeCount(count)
    })
    ipcMain.handle('pi-desktop:pick-directory', async event => {
      trusted(event)
      if (!window) return null
      show()
      const selected = await dialog.showOpenDialog(window, { title: text.project, properties: ['openDirectory', 'createDirectory'] })
      return selected.canceled ? null : selected.filePaths[0] ?? null
    })
    ipcMain.handle('pi-desktop:open-external', async (event, link: unknown) => {
      trusted(event)
      if (typeof link !== 'string' || !/^https?:/.test(link)) throw new Error('HTTP or HTTPS link required')
      await shell.openExternal(link)
    })
    ipcMain.handle('pi-desktop:open-pi-terminal', async (event, cwd: unknown) => {
      trusted(event)
      if (cwd !== undefined && typeof cwd !== 'string') throw new Error('Pi directory must be a path')
      await environmentReady
      await openPiTerminal(await loadRuntime(root, { installationHome: process.env.PI_DESKTOP_HOME ?? join(homedir(), '.pi-desktop') }), cwd, process.env.PI_DESKTOP_HOME ?? join(homedir(), '.pi-desktop'))
    })
    const fileEditor = new FileEditor(join(process.env.PI_DESKTOP_HOME ?? join(homedir(), '.pi-desktop'), 'editor.json'))
    ipcMain.handle('pi-desktop:open-file', async (event, input: unknown) => {
      trusted(event)
      const request = nativeFileRequest(input)
      const target = await fetch(new URL('/api/file-target', process.env.PI_DESKTOP_HOST_URL ?? applicationUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      const result: unknown = await target.json()
      if (!target.ok || !isJsonObject(result) || typeof result.path !== 'string' || typeof result.directory !== 'boolean') throw new Error('This file is unavailable in the selected project')
      if (request.action === 'reveal') { shell.showItemInFolder(result.path); return }
      if (result.directory) throw new Error('Select a file to open in an editor')
      if (request.action === 'system') { const error = await shell.openPath(result.path); if (error) throw new Error(error); return }
      let editor = request.action === 'chooseEditor' ? undefined : await fileEditor.selected()
      if (editor === undefined && window !== undefined) {
        const chosen = await dialog.showOpenDialog(window, { title: text.editor, defaultPath: process.platform === 'darwin' ? '/Applications' : undefined,
          properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: text.editor, extensions: ['exe'] }] } : {}) })
        if (chosen.canceled || chosen.filePaths[0] === undefined) return
        editor = chosen.filePaths[0]
        await fileEditor.choose(editor)
      }
      if (editor !== undefined) await fileEditor.open(editor, result.path)
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: text.name, submenu: [{ label: text.about, role: 'about' as const }, { type: 'separator' as const }, { label: text.hide, role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { label: text.quit, role: 'quit' as const }] }] : []),
      { label: text.files, submenu: [{ label: text.browser, click: () => { void shell.openExternal(applicationUrl) } }, { role: 'close' }] },
      { label: text.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: text.view, submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: text.window, submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' as const }] : [{ label: text.quit, role: 'quit' as const }])] },
    ]))
    if (process.platform === 'win32') {
      tray = new Tray(nativeImage.createFromPath(join(root, 'assets', 'tray.ico')))
      tray.setToolTip(text.name); tray.on('click', show)
      tray.setContextMenu(Menu.buildFromTemplate([{ label: text.open, click: show }, { label: text.quit, click: () => { app.quit() } }]))
    }
    await window.loadURL(applicationUrl)
  }).catch(error => {
    if (!quitting) { console.error(error); dialog.showErrorBox(text.error, error instanceof Error ? error.message : String(error)); app.quit() }
  })
}
import { BrowserGuests } from './browser-guests.ts'
