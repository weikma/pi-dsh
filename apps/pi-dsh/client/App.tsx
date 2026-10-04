/** Shared Desktop/Web shell; Pi owns execution, queues, tools, and session files. */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import clsx from 'clsx'
import {
  Button, Input, Menu, Modal, Toast, Tooltip, CodeAppearanceProvider,
  IconPanelLeftOutlineRegular, IconPlusOutlineRegular,
  IconSettingsOutlineRegular, IconPluginPinwheelOutlineRegular, IconFolderOpenOutlineRegular, IconChevronDownOutlineRegular,
  IconCloseOutlineRegular, IconSendOutlineRegular, IconStopFillRegular, IconBranchOutlineRegular,
  IconCompactOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isJsonObject, type JsonObject, type PiCommand, type PiSessionSummary, type PiSnapshot } from '../bridge/types.ts'
import { userMessageTitle } from '../bridge/skill-presentation.ts'
import type { ProviderInventory, ProviderModel } from '../bridge/provider-types.ts'
import type { LastModel } from '../last-model.ts'
import { api, follow, PiApiError, type GuiPreferences, type Project, type RuntimeConfig } from './http.ts'
import { Conversation } from './Conversation.tsx'
import { ExtensionDialog } from './ExtensionDialog.tsx'
import { PiLogo } from './PiLogo.tsx'
import { installWindowDragRecall } from './window-drag.ts'
import { PanelResizeHandle } from './PanelResizeHandle.tsx'
import { DEFAULT_PANEL_WIDTHS, PANEL_MINIMUM, panelLayout, type PanelWidths } from '../panel-layout.ts'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { SessionTree } from './SessionTree.tsx'
import { panelShortcut, shortcutPlatform } from './shortcuts.ts'
import type {} from './native.ts'
import { ContextUsage } from './ContextUsage.tsx'
import { ComposerMenu } from './ComposerMenu.tsx'
import { SlashCommandInput } from './SlashCommandInput.tsx'
import { slashCatalog, matchSlashCommands, type SlashCommand } from './slash-commands.ts'
import { ProjectToolbar } from './ProjectToolbar.tsx'
import { HistorySidebar } from './HistorySidebar.tsx'
import { useUnreadChats } from './useUnreadChats.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { DirectoryPicker } from './DirectoryPicker.tsx'
import { queuesOf, string } from './records.ts'
import { translate, type Locale } from './i18n.ts'
import { DEFAULT_TEXT_APPEARANCE, readTextAppearance, type TextAppearance } from '../appearance.ts'
import css from './App.module.css'

interface ImageDraft { id: string; name: string; data: string; mimeType: string }
type Appearance = NonNullable<GuiPreferences['appearance']>
const displayPath = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path
const failureText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)

/** GUI shell with Pi-authoritative state and Host-persisted presentation preferences. */
export function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('pi-dsh-locale') === 'en' ? 'en' : 'zh')
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const value = localStorage.getItem('pi-dsh-appearance')
    return value === 'dark' || value === 'light' ? value : 'system'
  })
  const [textAppearance, setTextAppearance] = useState<TextAppearance>(DEFAULT_TEXT_APPEARANCE)
  const [darkTheme, setDarkTheme] = useState(false)
  const codeAppearance = useMemo(() => ({
    theme: darkTheme ? textAppearance.darkCodeTheme : textAppearance.lightCodeTheme,
    lineNumbers: textAppearance.codeLineNumbers, wrap: textAppearance.codeWrapLines,
  }), [darkTheme, textAppearance.lightCodeTheme, textAppearance.darkCodeTheme, textAppearance.codeLineNumbers, textAppearance.codeWrapLines])
  const [preferencesReady, setPreferencesReady] = useState(false)
  const t = useCallback((key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values), [locale])
  const [projects, setProjects] = useState<Project[]>([])
  const [cwd, setCwd] = useState('')
  const [sessions, setSessions] = useState<PiSessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PiSnapshot | null>(null)
  const [historyPreview, setHistoryPreview] = useState<PiSnapshot | null>(null)
  const [openingPath, setOpeningPath] = useState<string | undefined>()
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [extensionFailure, setExtensionFailure] = useState<{ cwd: string; path?: string; id?: string } | null>(null)
  const [dismissedError, setDismissedError] = useState<string | undefined>()
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [historySearchRequest, setHistorySearchRequest] = useState(0)
  const [navigation, setNavigation] = useState<Pick<GuiPreferences, 'collapsedProjects' | 'pinnedSessions' | 'archivedSessions'>>({})
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1024)
  const [draft, setDraft] = useState('')
  const [dismissedCommandDraft, setDismissedCommandDraft] = useState<string | null>(null)
  const [images, setImages] = useState<ImageDraft[]>([])
  const drafts = useRef(new Map<string, { text: string; images: ImageDraft[] }>())
  const currentInput = useRef({ text: draft, images })
  currentInput.current = { text: draft, images }
  const [sending, setSending] = useState(false)
  const [projectBusy, setProjectBusy] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<{ selection: number; id: string | null; text: string; images: ImageDraft[]; baseline: number } | null>(null)
  const receivedSnapshot = useRef(0)
  const latestSnapshot = useRef(snapshot)
  latestSnapshot.current = snapshot
  const submitting = useRef(false)
  const [branching, setBranching] = useState(false)
  const [mode, setMode] = useState<'steer' | 'followUp'>('followUp')
  const [menu, setMenu] = useState<'model' | 'thinking' | 'mode' | 'actions' | 'composer' | null>(null)
  const [dialog, setDialog] = useState<'project' | 'settings' | 'rename' | 'tree' | 'fork' | 'session' | 'terminalCommand' | 'compact' | null>(null)
  const [settingsSection, setSettingsSection] = useState<'general' | 'models' | 'extensions' | 'skills'>('general')
  const [compactInstructions, setCompactInstructions] = useState('')
  const [compactionSubmitting, setCompactionSubmitting] = useState(false)
  const compactionPending = useRef(false)
  const [compactionError, setCompactionError] = useState('')
  const [compactionStopRequested, setCompactionStopRequested] = useState(false)
  const [sessionStats, setSessionStats] = useState<JsonObject | null>(null)
  const [terminalCommand, setTerminalCommand] = useState('')
  const [projectAction, setProjectAction] = useState<'open' | 'send' | 'model'>('open')
  const [modelLoading, setModelLoading] = useState(false)
  const [setupCommand, setSetupCommand] = useState('')
  const [setupError, setSetupError] = useState('')
  const [inventory, setInventory] = useState<ProviderInventory | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventoryError, setInventoryError] = useState('')
  const [pendingModel, setPendingModel] = useState<ProviderModel | null>(null)
  const lastModel = useRef<LastModel | undefined>()
  const [draftThinking, setDraftThinking] = useState<{ provider: string; model: string; level: string } | null>(null)
  const draftThinkingRef = useRef(draftThinking)
  draftThinkingRef.current = draftThinking
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null)
  const [runtimeArgs, setRuntimeArgs] = useState('[]')
  const [runtimeError, setRuntimeError] = useState('')
  const originalRuntime = useRef<RuntimeConfig | null>(null)
  const [previewShown, setPreviewShown] = useState(false)
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(DEFAULT_PANEL_WIDTHS)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const panels = panelLayout(panelWidths, windowWidth, collapsed, previewShown, window.piDsh?.platform === 'darwin' ? 0 : 56)
  useEffect(() => {
    const resize = () => { setWindowWidth(window.innerWidth) }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize) }
  }, [])
  const [fileRequest, setFileRequest] = useState<{ cwd: string; path: string; revision: number } | null>(null)
  const [fileRefresh, setFileRefresh] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const thinkingButton = useRef<HTMLButtonElement>(null)
  const selectedCommand = useRef<SlashCommand | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const composerActionButton = useRef<HTMLButtonElement>(null)
  const insertion = useRef({ start: 0, end: 0 })
  const closeComposerMenu = useCallback((focus = true) => { setMenu(null); if (focus) textarea.current?.focus() }, [])
  const openRevision = useRef(0)
  const notificationIds = useRef(new Set<string>())
  const editorRevision = useRef<string | undefined>()
  const restoredSelection = useRef(false)
  const preferenceWrites = useRef<Promise<void>>(Promise.resolve())
  const inventoryRevision = useRef(0)
  const sessionsRevision = useRef(0)
  const pendingModelRef = useRef<ProviderModel | null>(null)
  const running = snapshot?.state.isStreaming === true
  const compacting = snapshot?.state.isCompacting === true
  const canStop = running || compacting
  const refreshBlocked = running || sending || snapshot?.resourcesReloading === true || snapshot?.state.isCompacting === true || (snapshot?.pendingUI.length ?? 0) > 0
    || (snapshot?.state.pendingMessageCount ?? 0) > 0 || (snapshot?.steering.length ?? 0) > 0 || (snapshot?.followUp.length ?? 0) > 0
  const visibleSnapshot = snapshot ?? historyPreview
  const selectedSessionId = visibleSnapshot?.state.sessionId ?? sessions.find(session => session.path === openingPath)?.id
  const selectedSessionFile = visibleSnapshot?.state.sessionFile ?? openingPath
  const stashInput = useCallback(() => {
    drafts.current.set(activeId ?? (selectedSessionFile ? `session:${selectedSessionFile}` : `project:${cwd}`), currentInput.current)
    if (selectedSessionFile !== undefined) drafts.current.set(`session:${selectedSessionFile}`, currentInput.current)
  }, [activeId, cwd, selectedSessionFile])

  const showFailure = useCallback((reason: unknown) => { setToast({ id: Date.now(), text: failureText(reason) }) }, [])
  const savePreferences = useCallback((value: GuiPreferences) => {
    preferenceWrites.current = preferenceWrites.current.then(async () => {
      try { await api.savePreferences(value) } catch (reason) { showFailure(reason) }
    })
  }, [showFailure])
  const stageLastModel = useCallback((model: LastModel) => {
    const choice = { ...model, thinkingLevels: [model.thinkingLevel] }
    pendingModelRef.current = choice; setPendingModel(choice)
    const thinking = { provider: model.provider, model: model.id, level: model.thinkingLevel }
    draftThinkingRef.current = thinking; setDraftThinking(thinking)
  }, [])
  useEffect(() => {
    if (!preferencesReady || snapshot?.sessionId !== activeId || snapshot?.state.model === undefined) return
    const model = snapshot.state.model
    const choice = { provider: model.provider, id: model.id, name: model.name ?? model.id, thinkingLevel: snapshot.state.thinkingLevel }
    const previous = lastModel.current
    if (previous?.provider === choice.provider && previous.id === choice.id && previous.name === choice.name && previous.thinkingLevel === choice.thinkingLevel) return
    lastModel.current = choice
    savePreferences({ lastModel: choice })
  }, [preferencesReady, activeId, snapshot?.sessionId, snapshot?.state.model?.provider, snapshot?.state.model?.id, snapshot?.state.model?.name, snapshot?.state.thinkingLevel, savePreferences])
  const refreshSessions = useCallback(async () => {
    const revision = ++sessionsRevision.current
    setSessionsLoading(true)
    try {
      const result = await api.sessions()
      if (revision === sessionsRevision.current) setSessions(result.sessions)
    } catch (reason) { if (revision === sessionsRevision.current) showFailure(reason) }
    finally { if (revision === sessionsRevision.current) setSessionsLoading(false) }
  }, [showFailure])
  const unreadChats = useUnreadChats(visibleSnapshot, dialog !== null, showFailure, refreshSessions)
  const refreshInventory = useCallback(async () => {
    const revision = ++inventoryRevision.current
    setInventoryLoading(true); setInventoryError('')
    try {
      const value = await api.providers(cwd || undefined)
      if (revision === inventoryRevision.current) setInventory(value)
    } catch (reason) { if (revision === inventoryRevision.current) setInventoryError(failureText(reason)) }
    finally { if (revision === inventoryRevision.current) setInventoryLoading(false) }
  }, [cwd])
  useEffect(() => {
    if (!preferencesReady) return
    void refreshInventory()
    return () => { inventoryRevision.current++ }
  }, [preferencesReady, refreshInventory])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])
  useEffect(() => {
    const html = document.documentElement
    html.dataset.platform = window.piDsh?.platform ?? 'web'
    if (window.piDsh !== undefined) html.dataset.desktop = ''
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches)
      setDarkTheme(dark)
      document.body.toggleAttribute('data-ds-dark-theme', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    update(); media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [appearance])
  useEffect(() => {
    document.body.style.setProperty('--dsw-ui-font-delta', `${textAppearance.uiFontSize - 14}px`)
    document.body.style.setProperty('--dsh-content-font-size', `${textAppearance.uiFontSize}px`)
    document.body.style.setProperty('--dsw-code-font-size', `${textAppearance.codeFontSize}px`)
  }, [textAppearance.uiFontSize, textAppearance.codeFontSize])
  useEffect(() => installWindowDragRecall({ document }), [])
  useEffect(() => {
    let disposed = false
    void Promise.allSettled([api.preferences(), api.projects()]).then(([preferences, result]) => {
      if (disposed) return
      const saved = preferences.status === 'fulfilled' ? preferences.value : {}
      if (preferences.status === 'rejected') showFailure(preferences.reason)
      lastModel.current = saved.lastModel
      if (saved.lastModel !== undefined) stageLastModel(saved.lastModel)
      setNavigation({ collapsedProjects: saved.collapsedProjects, pinnedSessions: saved.pinnedSessions, archivedSessions: saved.archivedSessions })
      if (saved.locale !== undefined) setLocale(saved.locale)
      if (saved.appearance !== undefined) setAppearance(saved.appearance)
      setTextAppearance({ ...DEFAULT_TEXT_APPEARANCE, ...readTextAppearance({ ...saved }) })
      setPanelWidths({ sidebarWidth: saved.sidebarWidth ?? DEFAULT_PANEL_WIDTHS.sidebarWidth, workspaceWidth: saved.workspaceWidth ?? DEFAULT_PANEL_WIDTHS.workspaceWidth })
      for (const [key, value] of [['pi-dsh-session-id', saved.sessionId], ['pi-dsh-session', saved.sessionFile]] as const) {
        if (value === '') localStorage.removeItem(key)
        else if (value !== undefined) localStorage.setItem(key, value)
      }
      if (result.status === 'fulfilled') {
        setProjects(result.value.projects)
        const savedCwd = saved.cwd ?? localStorage.getItem('pi-dsh-project')
        setCwd(savedCwd === '' ? '' : result.value.projects.find(project => project.cwd === savedCwd)?.cwd ?? result.value.projects[0]?.cwd ?? '')
      } else setError(failureText(result.reason))
      setPreferencesReady(true)
    })
    return () => { disposed = true }
  }, [showFailure, stageLastModel])
  useEffect(() => {
    if (!preferencesReady) return
    localStorage.setItem('pi-dsh-locale', locale)
    localStorage.setItem('pi-dsh-appearance', appearance)
    savePreferences({ locale, appearance, ...textAppearance })
  }, [locale, appearance, textAppearance, preferencesReady, savePreferences])
  useEffect(() => {
    if (!preferencesReady || cwd === '') return
    localStorage.setItem('pi-dsh-project', cwd)
    savePreferences({ cwd })
  }, [cwd, preferencesReady, savePreferences])
  useEffect(() => {
    if (preferencesReady) void refreshSessions()
    return () => { sessionsRevision.current++ }
  }, [preferencesReady, projects, refreshSessions])
  useEffect(() => {
    if (activeId === null) { setConnected(true); return }
    setSnapshot(null); setConnected(true); setDismissedError(undefined)
    const stop = follow(activeId, value => { receivedSnapshot.current++; setSnapshot(value); setHistoryPreview(null); setOpeningPath(undefined); setLoading(false) }, setConnected)
    return stop
  }, [activeId])
  useEffect(() => {
    if (snapshot === null) return
    document.title = snapshot.state.sessionName ? `${snapshot.state.sessionName} — ${t('product')}` : t('product')
    if (!snapshot.state.isStreaming) void refreshSessions()
  }, [snapshot?.state.sessionId, snapshot?.state.sessionFile, snapshot?.state.sessionName, snapshot?.state.isStreaming, t, refreshSessions])
  useEffect(() => {
    if (!preferencesReady || selectedSessionId === undefined) return
    localStorage.setItem('pi-dsh-session-id', selectedSessionId)
    if (selectedSessionFile === undefined) localStorage.removeItem('pi-dsh-session')
    else localStorage.setItem('pi-dsh-session', selectedSessionFile)
    savePreferences({ sessionId: selectedSessionId, sessionFile: selectedSessionFile ?? '' })
  }, [selectedSessionId, selectedSessionFile, preferencesReady, savePreferences])
  useEffect(() => {
    if (snapshot === null) return
    for (const notification of snapshot.notifications) {
      if (!notificationIds.current.has(notification.id)) {
        notificationIds.current.add(notification.id)
        setToast({ id: Date.now(), text: notification.message ?? notification.title ?? t('notification') })
      }
    }
    if (snapshot.editorText !== undefined && snapshot.editorText !== editorRevision.current) {
      editorRevision.current = snapshot.editorText
      setDraft(snapshot.editorText)
    }
  }, [snapshot, t])
  useEffect(() => {
    const el = textarea.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, Math.max(48, el.scrollHeight))}px`
  }, [draft])

  useEffect(() => {
    if (menu !== 'thinking') return
    // The command menu keeps editor focus; the thinking picker uses its chip as the keyboard anchor.
    const frame = requestAnimationFrame(() => { thinkingButton.current?.focus() })
    return () => { cancelAnimationFrame(frame) }
  }, [menu])

  const openSession = useCallback(async (projectCwd: string, path?: string, preserveInput = false, extensionRecovery?: boolean): Promise<string | null> => {
    const revision = ++openRevision.current
    const previousInput = currentInput.current
    const previousId = activeId
    stashInput()
    setLoading(true); setError(''); setExtensionFailure(null); setMenu(null)
    setCwd(projectCwd)
    if (path !== undefined && path !== selectedSessionFile) {
      setActiveId(null); setSnapshot(null); setHistoryPreview(null); setOpeningPath(path)
      if (!preserveInput) {
        const saved = drafts.current.get(`session:${path}`)
        setDraft(saved?.text ?? ''); setImages(saved?.images ?? [])
      }
    }
    if (path !== undefined) {
      // Reading the transcript does not wait for native extensions or model discovery.
      void api.previewSession(projectCwd, path).then(value => {
        if (revision === openRevision.current && latestSnapshot.current === null) setHistoryPreview(value)
      }).catch(reason => { void reason /* Native open remains authoritative and reports failures. */ })
    }
    try {
      const result = extensionRecovery === undefined ? await api.open(projectCwd, path) : await api.open(projectCwd, path, extensionRecovery)
      if (revision !== openRevision.current) return null
      setCwd(projectCwd)
      const model = pendingModelRef.current
      if (path === undefined && model !== null) {
        await api.command(result.id, { type: 'set_model', provider: model.provider, modelId: model.id })
        if (revision !== openRevision.current) return null
      }
      const thinking = draftThinkingRef.current
      if (path === undefined && thinking !== null) {
        const current = await api.snapshot(result.id)
        if (revision !== openRevision.current) return null
        if (current.state.model?.provider === thinking.provider && current.state.model.id === thinking.model && current.thinkingLevels.includes(thinking.level)) {
          await api.command(result.id, { type: 'set_thinking_level', level: thinking.level })
          if (revision !== openRevision.current) return null
        }
      }
      // Subscribe only after new-chat choices are applied, so startup defaults cannot replace them.
      if (path === undefined) { pendingModelRef.current = null; setPendingModel(null) }
      setActiveId(result.id); setLoading(false)
      if (path === undefined && preserveInput) drafts.current.delete(`project:${projectCwd}`)
      // Drafts follow native files or unsaved GUI handles. Late keyboard edits stay in the new chat.
      if (!preserveInput && result.id !== previousId && currentInput.current.text === previousInput.text && currentInput.current.images === previousInput.images) {
        const saved = (path === undefined ? undefined : drafts.current.get(`session:${path}`)) ?? drafts.current.get(result.id)
        setDraft(saved?.text ?? ''); setImages(saved?.images ?? [])
      }
      return result.id
    } catch (reason) { if (revision === openRevision.current) { setError(failureText(reason)); setLoading(false); if (reason instanceof PiApiError && reason.code === 'extension_startup') setExtensionFailure({ cwd: projectCwd, path }) }; return null }
  }, [activeId, stashInput, selectedSessionFile])

  useEffect(() => {
    if (!preferencesReady || restoredSelection.current || activeId !== null || cwd === '' || sessions.length === 0) return
    restoredSelection.current = true
    const savedId = localStorage.getItem('pi-dsh-session-id')
    const saved = localStorage.getItem('pi-dsh-session')
    const previous = sessions.find(session => session.id === savedId) ?? sessions.find(session => session.path === saved)
    if (previous !== undefined) void openSession(previous.cwd, previous.path, true)
  }, [sessions, cwd, activeId, openSession, preferencesReady])

  const command = useCallback(async (value: PiCommand): Promise<void> => {
    if (activeId === null) return
    await api.command(activeId, value)
  }, [activeId])
  const run = (value: PiCommand) => { void command(value).catch(showFailure) }
  const startDraft = useCallback((projectCwd: string) => {
    stashInput()
    if (activeId !== null && lastModel.current !== undefined) stageLastModel(lastModel.current)
    drafts.current.delete(`project:${projectCwd}`)
    ++openRevision.current; restoredSelection.current = true
    setCwd(projectCwd); setActiveId(null); setSnapshot(null); setHistoryPreview(null); setOpeningPath(undefined); setLoading(false); setMenu(null); setError(''); setExtensionFailure(null)
    currentInput.current = { text: '', images: [] }
    setDraft(''); setImages([])
    localStorage.removeItem('pi-dsh-session-id'); localStorage.removeItem('pi-dsh-session')
    savePreferences({ cwd: projectCwd, sessionId: '', sessionFile: '' })
    const collapsedProjects = (navigation.collapsedProjects ?? []).filter(value => value !== projectCwd)
    setNavigation(current => ({ ...current, collapsedProjects }))
    savePreferences({ collapsedProjects })
    document.title = t('product')
    requestAnimationFrame(() => { textarea.current?.focus() })
  }, [cwd, activeId, stashInput, savePreferences, navigation.collapsedProjects, t, stageLastModel])
  const selectDraftProject = (projectCwd: string) => {
    if (activeId !== null && lastModel.current !== undefined) stageLastModel(lastModel.current)
    ++openRevision.current; restoredSelection.current = true
    setCwd(projectCwd); setActiveId(null); setSnapshot(null); setHistoryPreview(null); setOpeningPath(undefined); setLoading(false); setMenu(null); setError(''); setExtensionFailure(null)
    localStorage.removeItem('pi-dsh-session-id'); localStorage.removeItem('pi-dsh-session')
    if (projectCwd) localStorage.setItem('pi-dsh-project', projectCwd)
    else localStorage.removeItem('pi-dsh-project')
    savePreferences({ cwd: projectCwd, sessionId: '', sessionFile: '' })
    document.title = t('product')
    requestAnimationFrame(() => { textarea.current?.focus() })
  }
  const saveNavigation = async (value: Pick<GuiPreferences, 'collapsedProjects' | 'pinnedSessions' | 'archivedSessions'>) => {
    const update = preferenceWrites.current.then(async () => {
      await api.savePreferences(value)
      setNavigation(current => ({ ...current, ...value }))
    })
    preferenceWrites.current = update.catch(error => { void error /* The caller reports this failed navigation save. */ })
    await update
  }
  const manageProject = async (project: Project, action: 'rename' | 'remove', name?: string) => {
    const revision = openRevision.current
    const result = await api.updateProject(project.cwd, action, name)
    setProjects(result.projects)
    if (action === 'remove' && cwd === project.cwd && revision === openRevision.current) startDraft(result.projects[0]?.cwd ?? '')
  }
  const manageSession = async (session: PiSessionSummary, action: 'rename' | 'fork', name?: string) => {
    const revision = openRevision.current
    if (action === 'rename') {
      const opened = await api.open(session.cwd, session.path)
      await api.command(opened.id, { type: 'set_session_name', name })
      await refreshSessions()
    } else {
      const opened = await api.open(session.cwd, session.path)
      const state = await api.snapshot(opened.id)
      if (state.state.isStreaming || state.state.isCompacting || state.state.pendingMessageCount > 0 || state.pendingUI.length > 0) throw new Error(t('commandBusy'))
      // Public clone switches the native handle; select it only after Pi accepts the operation.
      if (revision !== openRevision.current) return
      stashInput()
      const result = await api.command(opened.id, { type: 'clone' })
      if (isJsonObject(result) && result.cancelled === true) return
      const cloned = await api.snapshot(opened.id)
      if (revision === openRevision.current) {
        ++openRevision.current; restoredSelection.current = true
        setCwd(session.cwd); setActiveId(opened.id); setSnapshot(cloned); setDraft(''); setImages([]); setLoading(false)
      }
      await refreshSessions()
    }
  }
  const openFile = useCallback((path: string) => {
    if (!cwd) return
    setPreviewShown(true)
    setFileRequest(current => ({ cwd, path, revision: (current?.revision ?? 0) + 1 }))
  }, [cwd])

  const loadModels = async (id: string) => {
    const revision = openRevision.current
    setModelLoading(true); setSetupError('')
    try {
      await api.command(id, { type: 'get_available_models' })
      const value = await api.snapshot(id)
      if (revision !== openRevision.current) return
      setSnapshot(value)
      if (value.models.length > 0) { setDialog(null); setMenu('model') }
      else { setMenu('model') }
    } catch (reason) { showFailure(reason) }
    finally { setModelLoading(false) }
  }
  const addProject = async (path: string, next = projectAction) => {
    if (path.trim() === '') return
    try {
      const result = await api.addProject(path.trim())
      const projectCwd = result.cwd ?? path.trim()
      setProjects(result.projects); setCwd(projectCwd); setDialog(null)
      if (next === 'open') {
        selectDraftProject(projectCwd)
        setProjectAction('open'); return
      }
      setProjectAction('open')
      if (next === 'send') await sendPrompt(null, projectCwd)
      else {
        const id = await openSession(projectCwd, undefined, true)
        if (id !== null && next === 'model') await loadModels(id)
      }
    } catch (reason) { setError(failureText(reason)) }
  }
  const chooseDirectory = async (next: typeof projectAction = 'open') => {
    setProjectAction(next); setError('')
    if (window.piDsh === undefined) { setDialog('project'); return }
    setDialog(null)
    try { const path = await window.piDsh.pickDirectory(); if (path !== null) await addProject(path, next); else setProjectAction('open') }
    catch (reason) { showFailure(reason) }
  }
  const sendPrompt = async (existingId: string | null, projectCwd = cwd) => {
    const { text: message, images: attachments } = currentInput.current
    const selection = openRevision.current + (existingId === null ? 1 : 0)
    const sessionFile = snapshot?.sessionId === existingId ? snapshot.state.sessionFile : undefined
    const originKey = existingId ?? `project:${projectCwd}`
    const baseline = snapshot?.sessionId === existingId ? snapshot.messages.length : 0
    const queued = existingId !== null && running
    let id = existingId
    let accepted = false
    setSending(true)
    // This local receipt is presentation only. Pi remains the sole transcript and queue owner.
    if (!queued) setPendingPrompt({ selection, id, text: message, images: attachments, baseline })
    setDraft(''); setImages([])
    currentInput.current = { text: '', images: [] }
    drafts.current.delete(originKey)
    if (sessionFile) drafts.current.delete(`session:${sessionFile}`)
    const echoed = () => latestSnapshot.current?.sessionId === id
      && latestSnapshot.current.messages.slice(baseline).some(item => item.role === 'user')
    try {
      if (id === null) id = await openSession(projectCwd, openingPath, true)
      if (id === null) return
      setPendingPrompt(current => current?.selection === selection ? { ...current, id } : current)
      await api.command(id, { type: 'prompt', message,
        ...(queued ? { streamingBehavior: mode } : {}),
        ...(attachments.length > 0 ? { images: attachments.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType })) } : {}) })
      accepted = true
      // The command response can beat its SSE snapshot to the renderer.
      const received = receivedSnapshot.current
      const current = await api.snapshot(id)
      // An HTTP read can complete after a newer streamed question or message.
      if (selection === openRevision.current && received === receivedSnapshot.current) setSnapshot(current)
      if (existingId === null) void refreshSessions()
    } catch (reason) { showFailure(reason) }
    finally {
      if (!accepted && !echoed()) {
        const restore = (input: { text: string; images: ImageDraft[] }) => ({
          text: !input.text || input.text === message ? message : message + '\n\n' + input.text,
          images: [...attachments, ...input.images.filter(image => !attachments.some(sent => sent.id === image.id))],
        })
        if (selection === openRevision.current) {
          const restored = restore(currentInput.current)
          currentInput.current = restored; setDraft(restored.text); setImages(restored.images)
        } else {
          for (const key of [originKey, ...(sessionFile ? [`session:${sessionFile}`] : [])]) drafts.current.set(key, restore(drafts.current.get(key) ?? { text: '', images: [] }))
        }
      }
      setPendingPrompt(current => current?.selection === selection ? null : current)
      setSending(false)
    }
  }
  const submit = async (skipSuggestion = false) => {
    if (submitting.current || sending || projectBusy || loading || modelLoading || snapshot?.resourcesReloading || compacting || (draft.trim() === '' && images.length === 0)) return
    if (!skipSuggestion && selectedCommand.current !== null) { chooseCommand(selectedCommand.current, true); return }
    submitting.current = true
    try {
      if (await handleGuiCommand()) return
      if (cwd === '') { await chooseDirectory('send'); return }
      await sendPrompt(activeId)
    } finally { submitting.current = false }
  }
  const openModels = async (refresh = false) => {
    if (modelLoading) return
    if (!refresh && snapshot !== null && snapshot.models.length > 0) { setMenu(menu === 'model' ? null : 'model'); return }
    if (activeId === null) {
      if (!refresh && (inventory?.models.length ?? 0) > 0) { setMenu(menu === 'model' ? null : 'model'); return }
      setMenu(refresh ? null : menu === 'model' ? null : 'model'); await refreshInventory(); return
    }
    if (refresh && activeId !== null) {
      if (refreshBlocked) { setSetupError(t('modelRefreshBusy')); return }
      const revision = ++openRevision.current
      setModelLoading(true); setSetupError('')
      try {
        const result = await api.reconnect(activeId)
        if (revision !== openRevision.current) return
        setActiveId(result.id); setSnapshot(null)
        await loadModels(result.id)
      } catch (reason) { setSetupError(failureText(reason)); if (reason instanceof PiApiError && reason.code === 'extension_startup') { setError(failureText(reason)); setExtensionFailure({ cwd, id: activeId }) } }
      finally { setModelLoading(false) }
      return
    }
    const id = activeId ?? await openSession(cwd, undefined, true)
    if (id !== null) await loadModels(id)
  }
  const attachImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    try {
      const added = await Promise.all(files.map(file => new Promise<ImageDraft>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          const data = result.slice(result.indexOf(',') + 1)
          resolve({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, data })
        }
        reader.onerror = () => { reject(new Error(t('imageReadFailed'))) }
        reader.readAsDataURL(file)
      })))
      setImages(current => [...current, ...added])
    } catch (reason) { showFailure(reason) }
  }

  const toggleFiles = useCallback(() => {
    setMenu(null); setPreviewShown(value => !value)
    if (previewShown) textarea.current?.focus()
  }, [previewShown])
  const platform = shortcutPlatform()
  const sidebarKeys = [platform === 'darwin' ? '⌘' : 'Ctrl', 'B']
  const fileKeys = [platform === 'darwin' ? '⌘' : 'Ctrl', platform === 'darwin' ? '⌥' : 'Alt', 'B']
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[aria-modal="true"]') !== null) return
      const panel = panelShortcut(event, platform)
      if (panel !== undefined) {
        event.preventDefault(); setMenu(null)
        if (panel === 'history') { setCollapsed(value => !value); textarea.current?.focus() }
        else toggleFiles()
        return
      }
      const modifier = platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (modifier && !event.shiftKey && !event.altKey && !event.repeat && event.key.toLowerCase() === 'n') {
        event.preventDefault(); startDraft(cwd)
      }
      if (event.key === 'Escape' && canStop && menu === null) { event.preventDefault(); run({ type: 'abort' }) }
    }
    window.addEventListener('keydown', shortcut)
    return () => { window.removeEventListener('keydown', shortcut) }
  }, [cwd, canStop, activeId, menu, openSession, startDraft, platform, toggleFiles])

  const selectedModel = snapshot?.state.model
  const catalogSelection = inventory?.models.find(model => model.provider === pendingModel?.provider && model.id === pendingModel.id) ?? pendingModel ?? inventory?.defaultModel
  const thinkingLevels = activeId === null ? catalogSelection?.thinkingLevels ?? [] : snapshot?.thinkingLevels ?? []
  const thinkingLevel = activeId === null
    ? draftThinking !== null && draftThinking.provider === catalogSelection?.provider && draftThinking?.model === catalogSelection?.id && thinkingLevels.includes(draftThinking.level)
      ? draftThinking.level : catalogSelection?.thinkingLevel
    : snapshot?.state.thinkingLevel
  const selectThinking = async (level: string) => {
    if (activeId === null) {
      if (catalogSelection !== undefined) setDraftThinking({ provider: catalogSelection.provider, model: catalogSelection.id, level })
    } else await command({ type: 'set_thinking_level', level })
    setMenu(null)
  }
  const modelLabel = activeId === null ? catalogSelection?.name ?? t('noModel')
    : (snapshot?.models.length ?? 0) > 0 ? selectedModel?.name ?? selectedModel?.id ?? t('noModel') : t('noModel')
  const availableModels: ProviderModel[] = activeId === null ? inventory?.models ?? [] : (snapshot?.models ?? []).map(model => ({ provider: model.provider, id: model.id, name: model.name ?? model.id }))
  const selectModel = async (model: ProviderModel) => {
    if (activeId === null) { pendingModelRef.current = model; setPendingModel(model) }
    else await api.command(activeId, { type: 'set_model', provider: model.provider, modelId: model.id })
    setMenu(null); setDialog(null)
  }
  const providerChanged = async () => {
    await refreshInventory()
    if (activeId === null) return
    if (refreshBlocked) { setSetupError(t('providerRefreshDeferred')); return }
    const revision = ++openRevision.current
    setModelLoading(true)
    try {
      const result = await api.reconnect(activeId)
      if (revision !== openRevision.current) return
      setActiveId(result.id)
      const value = await api.snapshot(result.id)
      if (revision === openRevision.current) setSnapshot(value)
    } catch (reason) {
      if (reason instanceof PiApiError && reason.code === 'extension_startup') { setError(failureText(reason)); setExtensionFailure({ cwd, id: activeId }) }
      throw reason
    } finally { setModelLoading(false) }
  }
  const reloadResources = async () => {
    if (activeId === null || refreshBlocked) return
    const revision = openRevision.current
    setModelLoading(true)
    try {
      await api.reload(activeId)
      const value = await api.snapshot(activeId)
      if (revision === openRevision.current) setSnapshot(value)
    } finally { setModelLoading(false) }
  }
  const restartExtensions = async (recovery: boolean) => {
    const request: { cwd: string; path?: string; id?: string } | null = recovery ? extensionFailure : { cwd, id: activeId ?? undefined }
    if (!request || loading || modelLoading || refreshBlocked) return
    if (!request.id) { await openSession(request.cwd, request.path, true, recovery); return }
    const revision = ++openRevision.current
    setModelLoading(true); setError(''); setDismissedError(undefined)
    try {
      const result = await api.reconnect(request.id, recovery)
      if (revision !== openRevision.current) return
      setActiveId(result.id); setExtensionFailure(null)
      const value = await api.snapshot(result.id)
      if (revision === openRevision.current) setSnapshot(value)
    } catch (reason) {
      if (revision === openRevision.current) { setError(failureText(reason)); if (reason instanceof PiApiError && reason.code === 'extension_startup') setExtensionFailure(request) }
    } finally { setModelLoading(false) }
  }
  const queue = snapshot === null ? { steer: [], followUp: [] } : queuesOf(snapshot)
  const slash = draft.startsWith('/') && !draft.includes('\n') && !draft.includes(' ')
  const nativeCommands = (snapshot?.commands ?? []).filter(value => value.name !== 'desktop-session' && value.name !== 'desktop-reload')
  const allCommands = slashCatalog(nativeCommands, t)
  const guiCommands = allCommands.filter(value => !value.native)
  const commandQuery = draft.slice(1).toLowerCase()
  const historyAvailable = snapshot?.commands.some(value => value.name === 'desktop-session') === true
  const suggestedNames = ['model', ...(!refreshBlocked && thinkingLevels.length > 1 ? ['thinking'] : []), ...(snapshot === null ? [] : [
    ...(!refreshBlocked ? ['compact', ...(historyAvailable ? ['fork'] : [])] : []),
    'session', ...(!refreshBlocked && historyAvailable ? ['tree'] : []),
  ])]
  const commandMatches = slash && dismissedCommandDraft !== draft && menu === null && dialog === null
    ? matchSlashCommands(allCommands, commandQuery, suggestedNames) : []
  const pending = snapshot?.pendingUI[0]
  const outgoing = pendingPrompt?.selection === openRevision.current
    && !(snapshot?.sessionId === pendingPrompt.id && snapshot.messages.slice(pendingPrompt.baseline).some(message => message.role === 'user')) ? pendingPrompt : undefined
  const snapshotError = snapshot?.error === dismissedError ? undefined : snapshot?.error
  const thinkingLabel = thinkingLevel !== undefined && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(thinkingLevel)
    ? t(thinkingLevel as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') : t('thinking')
  const title = visibleSnapshot?.state.sessionName || sessions.find(session => session.id === selectedSessionId)?.name || t('untitled')
  const firstUser = snapshot?.messages.find(message => message.role === 'user')
  const firstText = firstUser ? typeof firstUser.content === 'string' ? firstUser.content : firstUser.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') : undefined
  const pendingHistoryText = pendingPrompt?.selection === openRevision.current && pendingPrompt.baseline === 0 ? pendingPrompt.text : firstText
  const pendingChat = !sessions.some(session => session.id === selectedSessionId) && pendingHistoryText !== undefined
    ? { cwd, name: snapshot?.state.sessionName || userMessageTitle(pendingHistoryText) || t('untitled') } : undefined
  const openSettings = (section: 'general' | 'models' = 'general') => {
    setMenu(null); setSettingsSection(section)
    setDialog('settings'); setRuntimeError('')
    void api.runtime().then(value => { originalRuntime.current = value; setRuntime(value); setRuntimeArgs(JSON.stringify(value.args)) }).catch(showFailure)
  }
  const handleGuiCommand = async (commandText = draft, fromMenu = false): Promise<boolean> => {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(commandText.trim())
    if (match === null || nativeCommands.some(value => value.name === match[1])) return false
    const name = match[1] ?? ''
    // Pi's TUI built-ins do not execute through prompt RPC; keep them out of model context.
    if (['scoped-models', 'llama', 'import', 'share', 'bug', 'trust', 'hotkeys', 'changelog', 'quit'].includes(name)) {
      setTerminalCommand(commandText.trim()); setDialog('terminalCommand'); return true
    }
    if (!guiCommands.some(value => value.name === name)) return false
    const argument = match[2]?.trim() ?? ''
    const submitted = fromMenu ? commandText : draft
    const submittedSelection = openRevision.current
    const submittedKeys = [activeId ?? `project:${cwd}`, ...(selectedSessionFile === undefined ? [] : [`session:${selectedSessionFile}`])]
    const clear = () => {
      if (submittedSelection === openRevision.current) {
        setDraft(current => current === submitted ? '' : current)
        if (currentInput.current.text === submitted) currentInput.current = { ...currentInput.current, text: '' }
      }
      for (const key of submittedKeys) {
        const saved = drafts.current.get(key)
        if (saved?.text === submitted) drafts.current.set(key, { ...saved, text: '' })
      }
    }
    if (argument !== '' && !['name', 'compact', 'model', 'thinking', 'export'].includes(name)) { showFailure(t('commandArguments')); return true }
    if (name === 'settings') { clear(); openSettings(); return true }
    if (name === 'login' || name === 'logout') { clear(); openSettings('models'); return true }
    if (name === 'model') {
      if (argument === '') { clear(); await openModels(); return true }
      const model = availableModels.find(value => `${value.provider}/${value.id}` === argument)
      if (model === undefined) { showFailure(t('commandModelMissing')); return true }
      try { await selectModel(model); clear() } catch (reason) { showFailure(reason) }
      return true
    }
    if (name === 'new') { clear(); startDraft(cwd); return true }
    if (name === 'resume') {
      if (refreshBlocked || branching) { showFailure(t('commandBusy')); return true }
      clear()
      if (cwd === '') await chooseDirectory('open')
      else await refreshSessions()
      setCollapsed(false); setHistorySearchRequest(value => value + 1)
      return true
    }
    if (name === 'thinking') {
      if (refreshBlocked || branching) { showFailure(t('commandBusy')); return true }
      if (argument === '') {
        if (thinkingLevels.length < 2) { showFailure(t('commandThinkingUnavailable')); return true }
        clear(); setMenu('thinking'); return true
      }
      if (!thinkingLevels.includes(argument)) { showFailure(t('commandThinkingInvalid', { levels: thinkingLevels.join(', ') })); return true }
      try { await selectThinking(argument); clear() } catch (reason) { showFailure(reason) }
      return true
    }
    if (activeId === null || snapshot === null) { showFailure(t('commandNeedsChat')); return true }
    if (name === 'reload') {
      if (refreshBlocked || modelLoading) { showFailure(t('commandBusy')); return true }
      try { await reloadResources(); clear(); setToast({ id: Date.now(), text: t('configurationReloaded') }) } catch (reason) { showFailure(reason) }
      return true
    }
    if (name === 'session' || name === 'copy') {
      const selection = openRevision.current
      try {
        const result = await api.command(activeId, { type: name === 'session' ? 'get_session_stats' : 'get_last_assistant_text' })
        if (selection !== openRevision.current) return true
        if (!isJsonObject(result)) throw new Error(t('commandResultMissing'))
        if (name === 'copy') {
          if (typeof result.text !== 'string' || result.text === '') throw new Error(t('commandNoReply'))
          await navigator.clipboard.writeText(result.text)
          setToast({ id: Date.now(), text: t('copied') })
        } else { setSessionStats(result); setDialog('session') }
        clear()
      } catch (reason) { showFailure(reason) }
      return true
    }
    if (refreshBlocked || branching) { showFailure(t('commandBusy')); return true }
    if (name === 'compact' && argument === '' && fromMenu) { clear(); setCompactInstructions(''); setCompactionError(''); setDialog('compact'); return true }
    if (name === 'tree') { clear(); setDialog('tree'); return true }
    if (name === 'fork') { clear(); setDialog('fork'); return true }
    if (name === 'clone' || name === 'export') {
      const selection = openRevision.current
      try {
        if (name === 'clone') {
          stashInput()
          await api.command(activeId, { type: 'clone' })
          const value = await api.snapshot(activeId)
          if (selection !== openRevision.current) return true
          setSnapshot(value); await refreshSessions()
          if (selection !== openRevision.current) return true
        } else {
          if (argument.toLowerCase().endsWith('.jsonl')) { setTerminalCommand(commandText.trim()); setDialog('terminalCommand'); return true }
          const result = await api.command(activeId, { type: 'export_html', ...(argument === '' ? {} : { outputPath: argument }) })
          if (selection !== openRevision.current) return true
          if (!isJsonObject(result) || typeof result.path !== 'string') throw new Error(t('commandResultMissing'))
          setToast({ id: Date.now(), text: t('commandExported', { path: result.path }) })
        }
        clear()
      } catch (reason) { showFailure(reason) }
      return true
    }
    if (name === 'name' && argument === '') { clear(); setName(title); setDialog('rename'); return true }
    try {
      await command(name === 'compact' ? { type: 'compact', ...(argument === '' ? {} : { customInstructions: argument }) } : { type: 'set_session_name', name: argument })
      clear()
    } catch (reason) { showFailure(reason) }
    return true
  }
  const completeCommand = (value: SlashCommand) => { setDraft(`/${value.name} `); setDismissedCommandDraft(null); textarea.current?.focus() }
  const chooseCommand = (value: SlashCommand, submitExactNative = false) => {
    if (value.native) {
      if (submitExactNative && draft === `/${value.name}`) void submit(true)
      else completeCommand(value)
      return
    }
    if (submitting.current || loading || sending) return
    submitting.current = true
    const text = `/${value.name}`
    setDraft(text); currentInput.current = { ...currentInput.current, text }
    setDismissedCommandDraft(text)
    void handleGuiCommand(text, true).catch(showFailure).finally(() => { submitting.current = false })
  }
  const referenceFile = (path: string) => {
    const text = currentInput.current.text
    const start = Math.min(insertion.current.start, text.length), end = Math.min(insertion.current.end, text.length)
    const before = text.slice(0, start), after = text.slice(end)
    const added = (before && !/\s$/u.test(before) ? ' ' : '') + path + ' '
    const next = before + added + after
    setDraft(next); currentInput.current = { ...currentInput.current, text: next }; setDismissedCommandDraft(null); setMenu(null)
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(before.length + added.length, before.length + added.length) })
  }
  const chooseComposerCommand = (value: SlashCommand) => {
    setMenu(null)
    if (value.native) {
      const text = '/' + value.name + ' ' + currentInput.current.text
      setDraft(text); currentInput.current = { ...currentInput.current, text }; textarea.current?.focus()
    } else if (!submitting.current && !loading && !sending) {
      submitting.current = true
      void handleGuiCommand('/' + value.name, true).catch(showFailure).finally(() => { submitting.current = false })
    }
  }
  const compactFromDialog = async () => {
    if (activeId === null || refreshBlocked || compactionPending.current) return
    compactionPending.current = true; setCompactionSubmitting(true); setCompactionError(''); setCompactionStopRequested(false)
    try {
      await command({ type: 'compact', ...(compactInstructions.trim() ? { customInstructions: compactInstructions } : {}) })
      setDialog(null)
    } catch (reason) { setCompactionError(failureText(reason)) }
    finally { compactionPending.current = false; setCompactionSubmitting(false) }
  }
  useEffect(() => {
    if (dialog !== 'terminalCommand') return
    let disposed = false
    setSetupCommand(''); setSetupError('')
    void api.piSetup(cwd || undefined).then(value => { if (!disposed) setSetupCommand(value.commandLine) })
      .catch(reason => { if (!disposed) setSetupError(failureText(reason)) })
    return () => { disposed = true }
  }, [dialog, cwd])
  const saveRuntime = async () => {
    if (runtime === null) return
    try {
      const args: unknown = JSON.parse(runtimeArgs)
      if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new Error(t('invalidArguments'))
      if (originalRuntime.current?.command === runtime.command && JSON.stringify(originalRuntime.current.args) === JSON.stringify(args)
        && (originalRuntime.current.agentDir ?? '') === (runtime.agentDir ?? '')) { setDialog(null); return }
      const result = await api.saveRuntime({ command: runtime.command, args, ...(runtime.agentDir ? { agentDir: runtime.agentDir } : {}) })
      ++openRevision.current
      setRuntime(result); setLoading(false); setActiveId(null); setSnapshot(null); setDialog(null); setToast({ id: Date.now(), text: t('saved') })
      pendingModelRef.current = null; setPendingModel(null); setInventory(null); await refreshInventory()
    } catch (reason) { setRuntimeError(failureText(reason)) }
  }
  const useBundled = async () => {
    try {
      const result = await api.useBundledRuntime(runtime?.agentDir)
      originalRuntime.current = result; setRuntime(result); setRuntimeArgs(JSON.stringify(result.args))
      ++openRevision.current
      setLoading(false); setActiveId(null); setSnapshot(null)
      pendingModelRef.current = null; setPendingModel(null); setInventory(null)
      await refreshInventory(); setToast({ id: Date.now(), text: t('saved') })
    } catch (reason) { setRuntimeError(failureText(reason)) }
  }
  const navigate = async (entryId: string, action: 'navigate' | 'fork') => {
    if (activeId === null || branching || refreshBlocked) return
    const selection = openRevision.current
    const id = activeId
    stashInput()
    setBranching(true)
    try {
      await api.branch(id, entryId, action)
      const value = await api.snapshot(id)
      if (selection !== openRevision.current) return
      setSnapshot(value)
      await refreshSessions()
      if (selection === openRevision.current) setDialog(null)
    } catch (reason) { showFailure(reason) }
    finally { setBranching(false) }
  }

  const welcome = !outgoing && visibleSnapshot === null && activeId === null && !loading

  const panelStyle: CSSProperties & Record<'--pi-sidebar-expanded-width' | '--pi-workspace-width', string> = { '--pi-sidebar-expanded-width': `${panels.sidebarWidth}px`, '--pi-workspace-width': `${panels.workspaceWidth}px` }
  return <CodeAppearanceProvider value={codeAppearance}><div style={panelStyle} className={clsx(css.app, collapsed && css.collapsed, previewShown && css.withPreview, resizing && css.resizing)}>
    {!collapsed && <PanelResizeHandle side="left" label={t('resizeHistory')} controls="pi-history-panel" value={panels.sidebarWidth} preferred={panelWidths.sidebarWidth} min={PANEL_MINIMUM.sidebarWidth} max={panels.sidebarMax} resizing={setResizing} change={sidebarWidth => { setPanelWidths(current => ({ ...current, sidebarWidth })) }} commit={sidebarWidth => { savePreferences({ sidebarWidth }) }} />}
    {previewShown && <PanelResizeHandle side="right" label={t('resizeWorkspace')} controls="pi-workspace-panel" value={panels.workspaceWidth} preferred={panelWidths.workspaceWidth} min={PANEL_MINIMUM.workspaceWidth} max={panels.workspaceMax} resizing={setResizing} change={workspaceWidth => { setPanelWidths(current => ({ ...current, workspaceWidth })) }} commit={workspaceWidth => { savePreferences({ workspaceWidth }) }} />}
    <aside id="pi-history-panel" className={css.sidebar} aria-label={t('projects')} aria-hidden={window.piDsh?.platform === 'darwin' && collapsed ? true : undefined}>
      <div className={css.sidebarInner} aria-hidden={collapsed} {...{ inert: collapsed ? '' : undefined }}>
        <div className={css.titlebar} data-window-drag>
          <Tooltip label={t('collapseSidebar')} shortcutKeys={sidebarKeys} portal delayMs={350}>
            <button type="button" className={css.iconButton} aria-label={t('collapseSidebar')} onClick={() => { setCollapsed(true); textarea.current?.focus() }}><IconPanelLeftOutlineRegular size={16} /></button>
          </Tooltip>
        </div>
        <div className={css.brand} data-window-drag><PiLogo size={28} /><span>{t('product')}</span></div>
        <Button variant="outline" className={css.newSession} icon={<IconPlusOutlineRegular size={16} />} onClick={() => { startDraft(cwd) }} aria-label={t('newSession')}>
          <span>{t('newSession')}</span>
        </Button>
        <div className={css.sidebarContent}>
          <HistorySidebar active={!collapsed} projects={projects} sessions={sessions} pendingChat={pendingChat} loading={sessionsLoading} cwd={cwd} selectedId={selectedSessionId} unreadChats={unreadChats} navigation={navigation} searchRequest={historySearchRequest} locale={locale} t={t}
            addProject={() => { void chooseDirectory() }} newChat={startDraft} openChat={session => { void openSession(session.cwd, session.path) }} saveNavigation={saveNavigation} projectAction={manageProject} sessionAction={manageSession} feedback={text => { setToast({ id: Date.now(), text }) }} />
        </div>
        <div className={css.footer}>
          <Tooltip label={t('extensionsSettings')} portal disabled delayMs={350}><Button icon={<IconPluginPinwheelOutlineRegular size={16} />} onClick={() => { openSettings(); setSettingsSection('extensions') }} aria-label={t('extensionsSettings')}><span>{t('extensionsSettings')}</span></Button></Tooltip>
          <Tooltip label={t('settings')} portal disabled delayMs={350}><Button icon={<IconSettingsOutlineRegular size={16} />} onClick={() => { openSettings() }} aria-label={t('settings')}><span>{t('settings')}</span></Button></Tooltip>
        </div>
      </div>
      {window.piDsh?.platform !== 'darwin' && <div className={css.sidebarRail} aria-hidden={!collapsed} {...{ inert: collapsed ? undefined : '' }}>
        <div className={css.titlebar} data-window-drag><Tooltip label={t('expandSidebar')} shortcutKeys={sidebarKeys} portal delayMs={350}><button type="button" className={css.iconButton} aria-label={t('expandSidebar')} onClick={() => { setCollapsed(false); textarea.current?.focus() }}><IconPanelLeftOutlineRegular size={16} /></button></Tooltip></div>
        <Tooltip label={t('newSession')} portal delayMs={350}><Button variant="outline" className={css.newSession} icon={<IconPlusOutlineRegular size={16} />} onClick={() => { startDraft(cwd) }} aria-label={t('newSession')} /></Tooltip>
        <div className={css.footer}>
          <Tooltip label={t('extensionsSettings')} portal delayMs={350}><Button icon={<IconPluginPinwheelOutlineRegular size={16} />} onClick={() => { openSettings(); setSettingsSection('extensions') }} aria-label={t('extensionsSettings')} /></Tooltip>
          <Tooltip label={t('settings')} portal delayMs={350}><Button icon={<IconSettingsOutlineRegular size={16} />} onClick={() => { openSettings() }} aria-label={t('settings')} /></Tooltip>
        </div>
      </div>}
    </aside>
    <main className={clsx(css.main, welcome && css.welcomeMain)}>
      <header className={css.header} data-window-drag>
        <div className={css.breadcrumb}><IconFolderOpenOutlineRegular size={14} /><span>{cwd === '' ? t('chooseProject') : projects.find(project => project.cwd === cwd)?.name ?? displayPath(cwd)}</span><span className={css.crumbDivider}>/</span><span className={css.chatTitle}>{title}</span></div>
        <div className={css.headerActions}>
          <Menu open={menu === 'actions'} portal align="end" onClose={() => { setMenu(null) }} anchor={<button type="button" className={css.iconButton} disabled={snapshot === null || branching} aria-label={t('sessionTree')} aria-haspopup="menu" aria-expanded={menu === 'actions'} onClick={() => { setMenu(menu === 'actions' ? null : 'actions') }}><IconEllipsisOutlineRegular size={16} /></button>}
            items={[{ id: 'tree', label: t('sessionTree'), icon: <IconBranchOutlineRegular size={14} /> }, { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular size={14} /> }, { id: 'compact', label: t('compact'), disabled: refreshBlocked || branching, icon: <IconCompactOutlineRegular size={14} /> }]}
            onSelect={id => { setMenu(null); if (id === 'compact') run({ type: 'compact' }); else { setName(title); setDialog(id === 'tree' ? 'tree' : 'rename') } }} />
          <Tooltip label={t('files')} shortcutKeys={fileKeys} portal side="bottom" align="end" delayMs={350}><button type="button" className={css.iconButton} aria-label={t('files')} aria-pressed={previewShown} onClick={toggleFiles}><IconPanelLeftOutlineRegular className={css.rightPanelIcon} size={16} /></button></Tooltip>
        </div>
      </header>
      <div className={clsx(css.chatBody, welcome && css.welcomeBody)}>
      {outgoing || visibleSnapshot !== null && (visibleSnapshot.messages.length > 0 || visibleSnapshot.state.isStreaming)
          ? <Conversation key={openRevision.current} snapshot={visibleSnapshot} pending={outgoing} awaitingResponse={sending && pendingPrompt?.selection === openRevision.current} t={t} feedback={text => { setToast({ id: Date.now(), text }) }} openFile={path => { void openFile(path) }} openExternal={url => { if (window.piDsh) void window.piDsh.openExternal(url).catch(showFailure); else window.open(url, '_blank', 'noopener,noreferrer') }} navigate={(id, action) => { void navigate(id, action) }} historyDisabled={loading || refreshBlocked || branching || !historyAvailable} />
          : loading || activeId !== null && snapshot === null
            ? <div className={css.center}><div className={css.spinner} aria-label={t('loading')} role="status" /></div>
          : <div className={css.hero}><PiLogo size={52} /><h1>{t('welcome')}</h1></div>}
      <div className={css.composerArea}>
        {loading && historyPreview !== null && <div className={css.inputHint} role="status">{t('restoringSession')}</div>}
        {(error !== '' || snapshotError) && <div className={css.notice} role="alert">{extensionFailure || snapshot?.errorCode === 'extension_startup' ? <div className={css.noticeText}>{t(snapshot?.extensionRecovery ? 'extensionRestoreFailed' : 'extensionStartupFailed')}<details className={css.errorDetails}><summary>{t('extensionFailureDetails')}</summary><pre>{error || snapshotError}</pre></details></div> : error || snapshotError}<button type="button" className={css.noticeClose} onClick={() => { setError(''); setDismissedError(snapshot?.error) }} aria-label={t('close')}><IconCloseOutlineRegular size={12} /></button></div>}
        {extensionFailure && <div className={clsx(css.notice, css.recoveryNotice)}><p>{t('extensionRecoveryOffer')}</p><div className={css.setupActions}><Button disabled={loading || modelLoading || refreshBlocked} onClick={() => { void restartExtensions(true) }}>{t('extensionRecoveryContinue')}</Button><Button onClick={() => { setSettingsSection('extensions'); setDialog('settings') }}>{t('extensionsSettings')}</Button></div></div>}
        {snapshot?.extensionRecovery && <div className={clsx(css.notice, css.recoveryNotice)} role="status"><p>{t('extensionRecoveryActive')}</p><Button disabled={loading || modelLoading || refreshBlocked} onClick={() => { void restartExtensions(false) }}>{t('extensionRecoveryRestore')}</Button></div>}
        {activeId !== null && !connected && <div className={css.notice} role="status">{t('disconnected')}</div>}
        {(queue.steer.length > 0 || queue.followUp.length > 0) && <div className={css.queue}>
          <div className={css.queueHeading}><span>{t('queue')}</span><Button size="sm" onClick={() => { run({ type: 'clear_queue' }) }}>{t('clearQueue')}</Button></div>
          {queue.steer.map((text, index) => <div className={css.queueRow} key={`s${index}`}><span>{t('steer')}</span><p>{text}</p></div>)}
          {queue.followUp.map((text, index) => <div className={css.queueRow} key={`f${index}`}><span>{t('followUp')}</span><p>{text}</p></div>)}
        </div>}
        <div className={css.composerShell}>
        {welcome && <ProjectToolbar cwd={cwd} projects={projects} disabled={loading || sending || modelLoading || projectBusy} t={t} locale={locale} select={selectDraftProject} browse={() => { void chooseDirectory() }} busyChanged={setProjectBusy}
          changed={() => { void refreshInventory(); setFileRefresh(value => value + 1) }} feedback={text => { setToast({ id: Date.now(), text }) }} />}
        <ExtensionDialog sessionId={activeId} request={pending} t={t} respond={command}><form className={css.composer} onSubmit={event => { event.preventDefault(); void submit() }}>
          {menu === 'composer' && <ComposerMenu key={cwd + ':' + activeId} anchor={composerActionButton} cwd={cwd} commands={allCommands} suggestedNames={suggestedNames} t={t} close={closeComposerMenu}
            chooseProject={() => { void chooseDirectory() }} attachImages={() => { closeComposerMenu(); imageInput.current?.click() }} reference={referenceFile} chooseCommand={chooseComposerCommand} />}
          {images.length > 0 && <div className={css.imageDrafts}>{images.map(image => <div className={css.imageDraft} key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} /><button type="button" aria-label={t('removeImage')} onClick={() => { setImages(current => current.filter(value => value.id !== image.id)) }}><IconCloseOutlineRegular size={12} /></button></div>)}</div>}
          <SlashCommandInput inputRef={textarea} selectionRef={selectedCommand} className={css.textarea} label={t('prompt')} placeholder={cwd === '' ? t('promptNoProject') : t('prompt')} value={draft} commands={commandMatches} t={t}
            change={value => { setDraft(value); setDismissedCommandDraft(null) }} dismiss={() => { setDismissedCommandDraft(draft) }} complete={completeCommand} choose={chooseCommand} submit={() => { void submit() }} />
          <div className={css.composerControls}>
            <div className={css.controlsLeft}><Tooltip label={t('composerActions')} side="top" portal><button type="button" ref={composerActionButton} className={css.addImage} aria-label={t('composerActions')} aria-haspopup="listbox" aria-expanded={menu === 'composer'} onClick={() => {
              if (menu === 'composer') closeComposerMenu()
              else { insertion.current = { start: textarea.current?.selectionStart ?? draft.length, end: textarea.current?.selectionEnd ?? draft.length }; setMenu('composer') }
            }}><IconPlusOutlineRegular size={16} /></button></Tooltip>
              <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={event => { void attachImages(event) }} />
              {running && <Menu open={menu === 'mode'} side="top" portal onClose={() => { setMenu(null) }} selectedId={mode} items={[{ id: 'followUp', label: t('followUp') }, { id: 'steer', label: t('steer') }]}
                onSelect={id => { setMode(id === 'steer' ? 'steer' : 'followUp'); setMenu(null) }} anchor={<Tooltip label={mode === 'steer' ? t('steerHint') : t('followUpHint')} side="top" portal><button type="button" className={css.chip} onClick={() => { setMenu(menu === 'mode' ? null : 'mode') }}>{mode === 'steer' ? t('steer') : t('followUp')}<IconChevronDownOutlineRegular size={12} /></button></Tooltip>} />}
            </div>
            <div className={css.controlsRight}>
              {snapshot?.completedContext !== undefined && <ContextUsage usage={snapshot.completedContext.usage} breakdown={snapshot.completedContext.breakdown} cacheHitRate={snapshot.completedContext.cacheHitRate} t={t} />}
              <ModelPicker open={menu === 'model'} models={availableModels} selected={activeId === null ? catalogSelection ?? undefined : selectedModel} label={modelLabel} disabled={loading || modelLoading} t={t}
                toggle={() => { void openModels() }} close={() => { setMenu(null) }} select={model => { void selectModel(model).catch(showFailure) }} />
              {thinkingLevels.length > 1 && <Menu open={menu === 'thinking'} portal side="top" align="end" onClose={() => { setMenu(null) }} selectedId={thinkingLevel}
                items={thinkingLevels.map(level => ({ id: level, label: t(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level) ? level as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' : 'thinking') }))}
                onSelect={level => { void selectThinking(level).catch(showFailure) }} anchor={<Tooltip label={t('thinkingLevel')} side="top" portal><button type="button" ref={thinkingButton} className={css.chip} disabled={loading || modelLoading} aria-label={t('thinkingLevel')} aria-haspopup="menu" aria-expanded={menu === 'thinking'} onClick={() => { setMenu(menu === 'thinking' ? null : 'thinking') }}>{thinkingLabel}<IconChevronDownOutlineRegular size={12} /></button></Tooltip>} />}
              <Tooltip label={canStop ? t('stop') : cwd === '' ? t('chooseProjectToSend') : t('send')} shortcutKeys={[canStop ? 'Esc' : 'Enter']} side="top" portal>
                <button type={canStop ? 'button' : 'submit'} className={css.send}
                  disabled={!canStop && (loading || sending || projectBusy || modelLoading || snapshot?.resourcesReloading || (draft.trim() === '' && images.length === 0))}
                  aria-label={t(canStop ? 'stop' : 'send')} aria-keyshortcuts={canStop ? 'Escape' : 'Enter'}
                  onClick={canStop ? event => { event.preventDefault(); run({ type: 'abort' }) } : undefined}>
                  {canStop ? <IconStopFillRegular size={12} /> : <IconSendOutlineRegular size={16} />}
                </button>
              </Tooltip>
            </div>
          </div>
        </form>
        </ExtensionDialog>
        </div>
      </div>
      </div>
    </main>
    <WorkspacePanel visible={previewShown} interactive={dialog === null && menu === null && (snapshot?.pendingUI.length ?? 0) === 0} cwd={cwd} projects={projects} request={fileRequest} refresh={fileRefresh} t={t} shortcutKeys={fileKeys} close={() => { setPreviewShown(false); textarea.current?.focus() }} chooseProject={() => { void chooseDirectory() }} feedback={text => { setToast({ id: Date.now(), text }) }} />
    {window.piDsh?.platform === 'darwin' && <div className={css.leadingSeat} aria-hidden={!collapsed} {...{ inert: collapsed ? undefined : '' }}>
      <Tooltip label={t('expandSidebar')} shortcutKeys={sidebarKeys} portal side="bottom"><button type="button" className={css.iconButton} aria-label={t('expandSidebar')} onClick={() => { setCollapsed(false); textarea.current?.focus() }}><IconPanelLeftOutlineRegular size={16} /></button></Tooltip>
      <Tooltip label={t('newSession')} portal side="bottom"><button type="button" className={css.iconButton} aria-label={t('newSession')} onClick={() => { startDraft(cwd) }}><IconPlusOutlineRegular size={16} /></button></Tooltip>
    </div>}
    {dialog === 'project' && <DirectoryPicker initialPath={cwd} hint={projectAction === 'send' ? t('chooseProjectToSend') : undefined} error={error} t={t}
      close={() => { setDialog(null); setProjectAction('open') }} select={addProject} />}
    <Modal open={dialog === 'compact'} title={t('compact')} closeLabel={t('close')} backdropBlur={false} onClose={() => { if (!compactionSubmitting) setDialog(null) }}
      footer={<><Button onClick={() => { if (compactionSubmitting) { setCompactionStopRequested(true); void command({ type: 'abort' }).catch(reason => { setCompactionError(failureText(reason)) }) } else setDialog(null) }}>{t(compactionSubmitting ? 'stop' : 'cancel')}</Button><Button variant="primary" disabled={compactionSubmitting || refreshBlocked} onClick={() => { void compactFromDialog() }}>{t(compactionSubmitting ? 'compacting' : 'compact')}</Button></>}>
      <p className={css.setupText}>{t('slashCompactDescription')}</p>
      <label className={css.field}>{t('compactInstructions')}<textarea data-modal-autofocus className={css.compactInput} aria-label={t('compactInstructions')} placeholder={t('compactInstructionsHint')} value={compactInstructions} disabled={compactionSubmitting} onChange={event => { setCompactInstructions(event.target.value) }} /></label>
      {compactionError && (compactionStopRequested && compactionError === 'Compaction cancelled'
        ? <p className={css.setupText} role="status">{t('compactionCancelled')}</p> : <p className={css.error} role="alert">{compactionError}</p>)}
    </Modal>
    <Modal open={dialog === 'rename'} title={t('rename')} closeLabel={t('close')} backdropBlur={false} onClose={() => { setDialog(null) }} footer={<><Button onClick={() => { setDialog(null) }}>{t('cancel')}</Button><Button variant="primary" onClick={() => { void command({ type: 'set_session_name', name }).then(() => { setDialog(null) }).catch(showFailure) }}>{t('save')}</Button></>}>
      <form onSubmit={event => { event.preventDefault(); void command({ type: 'set_session_name', name }).then(() => { setDialog(null) }).catch(showFailure) }}><Input data-modal-autofocus aria-label={t('sessionName')} value={name} onChange={event => { setName(event.target.value) }} /></form>
    </Modal>
    <Modal open={dialog === 'tree' || dialog === 'fork'} title={t(dialog === 'fork' ? 'fork' : 'sessionTree')} closeLabel={t('close')} className={css.treeModal} backdropBlur={false} onClose={() => { setDialog(null) }}>
      {!historyAvailable && <p className={css.setupText}>{t('historyUnavailable')}</p>}
      {snapshot !== null && <SessionTree snapshot={snapshot} forkOnly={dialog === 'fork'} disabled={refreshBlocked || branching || !historyAvailable} t={t} navigate={(id, action) => { void navigate(id, action) }} />}

    </Modal>
    <Modal open={dialog === 'session'} title={t('sessionInfo')} closeLabel={t('close')} backdropBlur={false} onClose={() => { setDialog(null) }}>
      {sessionStats !== null && <dl className={clsx(css.runtimeVersions, css.sessionInfo)}>
        <div><dt>{t('sessionId')}</dt><dd>{string(sessionStats.sessionId)}</dd></div>
        <div><dt>{t('sessionFile')}</dt><dd>{string(sessionStats.sessionFile) || t('sessionUnsaved')}</dd></div>
        {(['totalMessages', 'userMessages', 'assistantMessages', 'toolCalls'] as const).map(key => <div key={key}><dt>{t(key)}</dt><dd>{typeof sessionStats[key] === 'number' ? sessionStats[key] : '—'}</dd></div>)}
        {isJsonObject(sessionStats.tokens) && <div><dt>{t('totalTokens')}</dt><dd>{typeof sessionStats.tokens.total === 'number' ? sessionStats.tokens.total : '—'}</dd></div>}
        <div><dt>{t('sessionCost')}</dt><dd>{typeof sessionStats.cost === 'number' ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(sessionStats.cost) : '—'}</dd></div>
        {isJsonObject(sessionStats.contextUsage) && <div><dt>{t('context')}</dt><dd>{typeof sessionStats.contextUsage.percent === 'number' ? `${sessionStats.contextUsage.percent.toFixed(1)}%` : '—'}</dd></div>}
      </dl>}
    </Modal>
    <Modal open={dialog === 'terminalCommand'} title={t('nativePiCommand')} closeLabel={t('close')} backdropBlur={false} onClose={() => { setDialog(null) }}>
      <p className={css.setupText}>{t('commandTerminalOnly', { command: terminalCommand })}</p>
      {window.piDsh?.openPiTerminal !== undefined && <Button variant="primary" onClick={() => { void window.piDsh?.openPiTerminal?.(cwd || undefined).catch(showFailure) }}>{t('openPiTerminal')}</Button>}
      {setupCommand !== '' && <><pre className={css.setupCommand}>{setupCommand}</pre><Button onClick={() => { void navigator.clipboard.writeText(setupCommand).then(() => { setToast({ id: Date.now(), text: t('copied') }) }).catch(showFailure) }}>{t('copyPiCommand')}</Button></>}
      {setupError !== '' && <p className={css.error}>{setupError}</p>}
    </Modal>
    {dialog === 'settings' && <SettingsPanel initialSection={settingsSection} t={t} close={() => { setDialog(null) }} locale={locale} setLocale={setLocale} appearance={appearance} setAppearance={setAppearance} textAppearance={textAppearance} setTextAppearance={setTextAppearance} cwd={cwd}
      selectSessionModel={selectModel}
      modelActions={<><div className={css.setupActions}><Button disabled={modelLoading || loading || refreshBlocked} onClick={() => { void openModels(true) }}>{modelLoading || loading ? t('loadingModels') : t('refreshModels')}</Button></div>
        {activeId !== null && <p className={css.setupText}>{refreshBlocked ? t('modelRefreshBusy') : t('modelRefreshDetail')}</p>}
        <p className={css.setupText}>{t('providerLoginStep')}</p>
        {window.piDsh?.openPiTerminal !== undefined
          ? <Button onClick={() => { void window.piDsh?.openPiTerminal?.(cwd || undefined).catch(showFailure) }}>{t('openPiTerminal')}</Button>
          : <Button onClick={() => { void api.piSetup(cwd || undefined).then(value => navigator.clipboard.writeText(value.commandLine)).then(() => { setToast({ id: Date.now(), text: t('copied') }) }).catch(showFailure) }}>{t('copyPiCommand')}</Button>}
        {setupError !== '' && <p className={css.error} role="status">{setupError}</p>}</>}
      sessionModels={activeId === null ? undefined : availableModels} inventory={inventory} inventoryLoading={inventoryLoading} inventoryError={inventoryError} refreshInventory={refreshInventory} providerChanged={providerChanged}
      feedback={text => { setToast({ id: Date.now(), text }) }} reload={reloadResources} reloadDisabled={activeId === null || refreshBlocked || branching || modelLoading}
      runtimeContent={<>
      <h3 className={css.sectionTitle}>{t('runtime')}</h3><p className={css.emptySmall}>{t('runtimeHint')}</p>
      <p className={css.setupText}>{t('runtimeIsolation')}</p>
      {runtime?.source !== undefined && <div className={css.settingsRow}><span>{t('runtimeSource')}</span><span>{t(runtime.source === 'bundled' ? 'runtimeBundled' : 'runtimeExternal')}</span></div>}
      {runtime?.bundled !== undefined && runtime.source !== 'bundled' && <Button onClick={() => { void useBundled() }}>{t('useBundled')}</Button>}
      {runtime !== null && <div className={css.runtimeFields}><label className={css.field}>{t('executable')}<Input aria-label={t('executable')} value={runtime.command} onChange={event => { setRuntime({ ...runtime, command: event.target.value }) }} /></label><label className={css.field}>{t('arguments')}<Input aria-label={t('arguments')} value={runtimeArgs} onChange={event => { setRuntimeArgs(event.target.value) }} /></label><label className={css.field}>{t('agentDir')}<Input aria-label={t('agentDir')} value={runtime.agentDir ?? ''} onChange={event => { setRuntime({ ...runtime, agentDir: event.target.value }) }} /></label>{runtime.version && <span className={css.emptySmall}>{runtime.version}</span>}</div>}
      {runtime?.bundled !== undefined && <><h3 className={css.sectionTitle}>{t('bundledRuntime')}</h3><p className={css.emptySmall}>{t('bundledRuntimeHint')}</p><dl className={css.runtimeVersions}>
        <div><dt>{t('nodeRuntime')}</dt><dd>{runtime.bundled.node}</dd></div>
        <div><dt>{t('piRuntime')}</dt><dd>{runtime.bundled.pi}</dd></div>
        <div><dt>{t('pnpmRuntime')}</dt><dd>{runtime.bundled.pnpm}</dd></div>
        <div><dt>{t('pythonRuntime')}</dt><dd>{runtime.bundled.python}</dd></div>
      </dl></>}
      {runtimeError !== '' && <p className={css.error}>{runtimeError}</p>}<p className={css.emptySmall}>{t('about')}</p>
      <Button variant="primary" disabled={runtime === null} onClick={() => { void saveRuntime() }}>{t('save')}</Button></>} />}
    {toast !== null && <Toast key={toast.id} text={toast.text} onDone={() => { setToast(null) }} />}
  </div></CodeAppearanceProvider>
}
