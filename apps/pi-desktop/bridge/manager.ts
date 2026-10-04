/** Pi-native conversation presentation and ownership of public RPC processes. */
import { branchMessages, isMessage, readSessionPreview } from "./session-records.ts";
import { randomUUID } from "node:crypto";
import { userMessageTitle } from './skill-presentation.ts';
import { CONTEXT_STATUS_KEY, readContextBreakdown } from './context-breakdown.ts';
import { readCacheHitRate } from './cache-usage.ts';
import type { UnreadChat } from '../unread-types.ts';
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PiExtensionStartupError, PiProcess, type PiProcessOptions } from "./process.ts";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
  type PiCommand,
  type PiContentBlock,
  type PiEvent,
  type PiMessage,
  type PiModel,
  type PiRuntime,
  type PiSessionSummary,
  type PiSnapshot,
  type PiState,
  type PiUIRequest,
} from "./types.ts";

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`Pi ${label} response is not an object`);
  return value;
}

function objects(value: JsonValue | undefined, label: string): JsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) throw new Error(`Pi ${label} response is not an object array`);
  return value;
}

function strings(value: JsonValue | undefined, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) throw new Error(`Pi ${label} response is not a string array`);
  return value;
}


function isModel(value: JsonValue | undefined): value is PiModel {
  return isJsonObject(value) && typeof value.id === "string" && typeof value.provider === "string";
}

function isState(value: JsonValue | undefined): value is PiState {
  return isJsonObject(value) && typeof value.sessionId === "string" && typeof value.thinkingLevel === "string"
    && typeof value.isStreaming === "boolean" && typeof value.isCompacting === "boolean"
    && typeof value.messageCount === "number" && typeof value.pendingMessageCount === "number"
    && (value.model === undefined || isModel(value.model));
}

function isUIRequest(event: PiEvent): event is PiUIRequest {
  return event.type === "extension_ui_request" && typeof event.id === "string" && typeof event.method === "string";
}

/** One browser-addressable conversation; Pi's own session ID can change on switch. */
export class PiSessionHandle {
  readonly id = randomUUID();
  readonly cwd: string;
  private readonly process: PiProcess;
  private current: PiSnapshot;
  private listeners = new Set<(snapshot: PiSnapshot) => void>();
  private unsubscribe: () => void;
  private closed = false;
  private reconnecting = false;
  private commandsInFlight = 0;
  private refreshPromise: Promise<void> | undefined;
  private refreshAgain = false;
  private contextRevision = 0;
  private contextSessionId: string | undefined;
  private contextReplyKey: string | undefined;
  private streamIndex: number | undefined;
  private toolArguments = new Map<number, string>();
  private completionListeners = new Set<(completion: UnreadChat) => void>();
  private turnStarted = false;
  private turnReply: PiMessage | undefined;
  private settledReply: PiMessage | undefined;

  constructor(options: PiProcessOptions) {
    this.cwd = options.cwd;
    this.process = new PiProcess(options);
    this.current = {
      sessionId: this.id,
      state: { sessionId: "", thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 0 },
      messages: [], entries: [], models: [], commands: [], thinkingLevels: [], pendingUI: [],
      steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {},
      ...(options.extensionRecovery ? { extensionRecovery: true } : {}),
    };
    this.unsubscribe = this.process.subscribe((event) => this.receive(event));
  }

  /** Complete native RPC readiness and load the initial conversation. */
  async start(): Promise<void> {
    await this.process.start();
    await this.refresh();
  }

  /** Read an independent presentation snapshot; callers cannot mutate session state. */
  snapshot(): PiSnapshot { return structuredClone(this.current); }

  /** Current Pi-owned JSONL file; session replacement can change it. */
  get sessionFile(): string | undefined { return this.current.state.sessionFile; }

  /** Whether this handle has stopped accepting commands. */
  get isClosed(): boolean { return this.closed; }

  /** Surface a failed replacement after the same recovery launch has been restored. */
  reportRecoveryRestoreFailure(error: unknown): void {
    this.current.error = error instanceof Error ? error.message : String(error);
    this.current.errorCode = error instanceof PiExtensionStartupError ? error.code : undefined;
    this.publish();
  }

  /** Block new commands while the bridge replaces this process.
   * @returns A release function; failed replacement preparation leaves the existing process usable.
   */
  holdCommandsForReconnect(): () => void {
    if (this.commandsInFlight > 0) throw new Error("Wait for pending Pi commands to finish before refreshing models");
    if (this.reconnecting) throw new Error("Pi models are already refreshing");
    this.reconnecting = true;
    return () => { this.reconnecting = false; };
  }

  /** Subscribe to complete presentation snapshots. */
  subscribe(listener: (snapshot: PiSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Only native agent_settled followed by persisted history can publish a completion. */
  subscribeCompletions(listener: (completion: UnreadChat) => void): () => void {
    this.completionListeners.add(listener);
    return () => { this.completionListeners.delete(listener); };
  }

  /** Forward a native command or an extension dialog response and refresh changed state. */
  async command(command: PiCommand): Promise<JsonValue | undefined> {
    if (this.closed) throw new Error("Pi conversation is closed");
    if (this.reconnecting) throw new Error("Pi models are refreshing; wait before sending another command");
    if (this.current.resourcesReloading && command.type !== 'extension_ui_response') throw new Error('Wait for Pi resource reload to finish');
    this.commandsInFlight++;
    try { return await this.executeCommand(command); }
    finally { this.commandsInFlight--; }
  }

  /** Use native in-process reload, retaining Pi's session and duplicate-tool precedence. */
  async reloadResources(): Promise<void> {
    if (this.closed || this.reconnecting) throw new Error('Pi conversation is not available for resource reload');
    if (this.commandsInFlight > 0 || this.current.resourcesReloading || this.current.state.isStreaming || this.current.state.isCompacting
      || this.current.state.pendingMessageCount > 0 || this.current.pendingUI.length > 0) throw new Error('Finish the current task, queued input and dialogs before reloading resources');
    if (!this.current.commands.some(command => command.name === 'desktop-reload')) throw new Error('This Pi runtime cannot load the Desktop reload extension. Use the Pi terminal to reload resources.');
    this.current.resourcesReloading = true;
    this.current.error = undefined;
    this.current.errorCode = undefined;
    this.publish();
    try {
      await this.process.request({ type: 'prompt', message: '/desktop-reload' });
      await this.refresh();
    } finally { this.current.resourcesReloading = false; this.publish(); }
  }

  /** Ask the public Desktop extension to change history; Pi owns cancellation and persistence. */
  async navigate(entryId: string, action: 'navigate' | 'fork'): Promise<void> {
    if (this.commandsInFlight > 0 || this.current.state.isStreaming || this.current.state.isCompacting
      || this.current.state.pendingMessageCount > 0 || this.current.pendingUI.length > 0) throw new Error('Finish the current task before changing history');
    if (!this.current.entries.some(entry => entry.id === entryId)) throw new Error('Session entry is unavailable');
    if (!this.current.commands.some(command => command.name === 'desktop-session')) throw new Error('This Pi runtime cannot load the Desktop session extension. Use the Pi terminal to navigate history.');
    await this.command({ type: 'prompt', message: '/desktop-session ' + JSON.stringify({ entryId, action }) });
    this.current.tools = {};
    this.publish();
  }

  private async executeCommand(command: PiCommand): Promise<JsonValue | undefined> {
    if (typeof command.type !== "string") throw new Error("Pi command requires a type");
    if (command.type === 'abort') { this.turnStarted = false; this.turnReply = undefined; this.settledReply = undefined; }
    this.current.error = undefined;
    this.current.errorCode = undefined;
    if (command.type === "extension_ui_response") {
      if (typeof command.id !== "string" || !this.current.pendingUI.some((request) => request.id === command.id)) throw new Error("Pi extension dialog is no longer pending");
      const result = await this.process.request(command);
      this.current.pendingUI = this.current.pendingUI.filter((request) => request.id !== command.id);
      this.publish();
      return result;
    }
    const result = await this.process.request(command);
    if (["new_session", "switch_session", "fork", "clone"].includes(command.type) && !(isJsonObject(result) && result.cancelled === true)) {
      this.streamIndex = undefined;
      this.toolArguments.clear();
      this.current.tools = {};
      this.current.pendingUI = [];
      this.current.steering = [];
      this.current.followUp = [];
    }
    await this.refresh();
    return result;
  }

  private refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return this.refreshPromise;
    }
    this.refreshPromise = this.readSnapshot().finally(async () => {
      this.refreshPromise = undefined;
      if (this.refreshAgain && !this.closed) {
        this.refreshAgain = false;
        await this.refresh();
      }
    });
    return this.refreshPromise;
  }

  private async readSnapshot(): Promise<void> {
    const [state, messages, entries, models, commands, thinking] = await Promise.all([
      this.process.request({ type: "get_state" }), this.process.request({ type: "get_messages" }),
      this.process.request({ type: "get_entries" }), this.process.request({ type: "get_available_models" }),
      this.process.request({ type: "get_commands" }), this.process.request({ type: "get_available_thinking_levels" }),
      this.updateContextUsage(),
    ]);
    if (this.closed) return;
    if (!isState(state)) throw new Error("Pi get_state returned invalid required fields");
    const rawMessages = object(messages, "get_messages").messages;
    if (!Array.isArray(rawMessages) || !rawMessages.every(isMessage)) throw new Error("Pi get_messages returned invalid messages");
    const entryData = object(entries, "get_entries");
    const entryList = objects(entryData.entries, "get_entries");
    const modelList = object(models, "get_available_models").models;
    if (!Array.isArray(modelList) || !modelList.every(isModel)) throw new Error("Pi get_available_models returned invalid models");
    this.current.state = state;
    this.current.entries = entryList;
    this.current.leafId = typeof entryData.leafId === 'string' ? entryData.leafId : null;
    this.current.models = modelList;
    this.current.commands = objects(object(commands, "get_commands").commands, "get_commands");
    this.current.thinkingLevels = strings(object(thinking, "get_available_thinking_levels").levels, "get_available_thinking_levels");
    if (!state.isStreaming && this.streamIndex === undefined) {
      this.current.messages = entryList.length ? branchMessages(entryList, entryData.leafId) : rawMessages;
    }
    this.updateCompletedContext();
    this.publish();
    if (!state.isStreaming && this.settledReply) {
      const reply = this.settledReply;
      this.settledReply = undefined;
      const message = this.current.messages.findLast(message => message.role === 'assistant');
      if (state.sessionFile && message?.entryId && message.timestamp === reply.timestamp
        && (reply.stopReason === 'stop' || reply.stopReason === 'length' || reply.stopReason === 'error')) {
        const completion = { nativeSessionId: state.sessionId, cwd: this.cwd, sessionFile: state.sessionFile, entryId: message.entryId };
        for (const listener of this.completionListeners) listener(completion);
      }
    }
  }

  /** Freeze the whole hover card until Pi settles a complete reply, including its tool work. */
  private updateCompletedContext(): void {
    const { state, messages } = this.current;
    if (state.sessionId !== this.contextSessionId) {
      this.contextSessionId = state.sessionId;
      this.contextReplyKey = undefined;
      this.current.completedContext = undefined;
    }
    if (this.turnStarted || state.isStreaming || state.isCompacting || state.pendingMessageCount > 0) return;
    const index = messages.findLastIndex(message => message.role === 'assistant' && (message.stopReason === 'stop' || message.stopReason === 'length'));
    const reply = messages[index];
    if (reply === undefined) {
      this.contextReplyKey = undefined;
      this.current.completedContext = undefined;
      return;
    }
    const key = JSON.stringify([reply.entryId ?? index, reply.timestamp]);
    if (key === this.contextReplyKey) return;
    this.contextReplyKey = key;
    this.current.completedContext = structuredClone({ usage: this.current.contextUsage, breakdown: this.current.contextBreakdown, cacheHitRate: this.current.cacheHitRate });
  }

  /** Optional public metadata must not prevent conversation use on another Pi release. */
  private async updateContextUsage(): Promise<void> {
    const revision = ++this.contextRevision;
    let usage;
    let cacheHitRate;
    try {
      const stats = await this.process.request({ type: 'get_session_stats' });
      cacheHitRate = readCacheHitRate(isJsonObject(stats) ? stats.tokens : undefined);
      const value = isJsonObject(stats) ? stats.contextUsage : undefined;
      if (isJsonObject(value) && typeof value.contextWindow === 'number' && Number.isFinite(value.contextWindow) && value.contextWindow > 0
        && (value.tokens === null || typeof value.tokens === 'number' && Number.isFinite(value.tokens) && value.tokens >= 0)
        && (value.percent === null || typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0)) {
        usage = { tokens: value.tokens, contextWindow: value.contextWindow, percent: value.percent };
      }
    } catch (error) { void error; /* Older public RPCs can omit context metadata; execution remains available. */ }
    if (this.closed || revision !== this.contextRevision) return;
    this.current.contextUsage = usage;
    this.current.cacheHitRate = cacheHitRate;
    this.publish();
  }

  private receive(event: PiEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case "agent_start":
        this.current.state.isStreaming = true;
        this.turnStarted = true;
        this.turnReply = undefined;
        this.settledReply = undefined;
        break;
      case "agent_settled":
        this.settledReply = this.turnStarted ? this.turnReply : undefined;
        this.turnStarted = false;
        this.streamIndex = undefined;
        this.toolArguments.clear();
        this.refreshAfterEvent();
        break;
      case "message_start":
        if (isMessage(event.message)) {
          this.current.messages.push(structuredClone(event.message));
          this.streamIndex = this.current.messages.length - 1;
        }
        break;
      case "message_end":
        void this.updateContextUsage();
        if (isMessage(event.message)) {
          if (this.turnStarted && event.message.role === 'assistant') this.turnReply = structuredClone(event.message);
          if (this.streamIndex !== undefined) this.current.messages[this.streamIndex] = structuredClone(event.message);
          else this.current.messages.push(structuredClone(event.message));
          this.streamIndex = undefined;
          this.toolArguments.clear();
          if (event.message.role === "assistant" && event.message.stopReason !== "aborted" && (event.message.stopReason === "error" || event.message.errorMessage)) {
            this.current.error = typeof event.message.errorMessage === "string" ? event.message.errorMessage : "Pi model request failed";
          }
        }
        break;
      case "message_update": this.updateAssistant(event); break;
      case "tool_execution_start":
        if (typeof event.toolCallId === "string") this.current.tools[event.toolCallId] = {
          toolCallId: event.toolCallId, toolName: typeof event.toolName === "string" ? event.toolName : undefined,
          status: "running", args: isJsonObject(event.args) ? event.args : undefined,
        };
        break;
      case "tool_execution_update":
      case "tool_execution_end":
        if (typeof event.toolCallId === "string") {
          const tool = this.current.tools[event.toolCallId] ?? { toolCallId: event.toolCallId, status: "running" };
          if (event.type === "tool_execution_update" && isJsonObject(event.partialResult)) tool.partialResult = event.partialResult;
          if (event.type === "tool_execution_end") {
            tool.status = event.isError === true ? "error" : "complete";
            if (isJsonObject(event.result)) tool.result = event.result;
          }
          this.current.tools[event.toolCallId] = tool;
        }
        break;
      case "queue_update":
        this.current.steering = strings(event.steering, "queue_update.steering");
        this.current.followUp = strings(event.followUp, "queue_update.followUp");
        this.current.state.pendingMessageCount = this.current.steering.length + this.current.followUp.length;
        break;
      case "compaction_start": this.current.state.isCompacting = true; break;
      case "compaction_end":
        this.current.state.isCompacting = false;
        this.refreshAfterEvent();
        break;
      case "thinking_level_changed":
        if (typeof event.level === "string") this.current.state.thinkingLevel = event.level;
        break;
      case "session_info_changed":
        this.current.state.sessionName = typeof event.name === "string" ? event.name : undefined;
        break;
      case "extension_ui_request": if (isUIRequest(event)) this.receiveUI(event); break;
      case "bridge_error":
        this.current.state.isStreaming = false;
        this.current.error = typeof event.error === "string" ? event.error : "Pi process failed";
        this.current.errorCode = event.code === 'extension_startup' ? event.code : undefined;
        break;
      case 'extension_error':
        this.current.error = typeof event.error === 'string' ? event.error : 'Pi extension failed';
        break;
      default: break;
    }
    this.publish();
  }

  private updateAssistant(event: PiEvent): void {
    const update = event.assistantMessageEvent;
    const message = this.streamIndex === undefined ? undefined : this.current.messages[this.streamIndex];
    if (!isJsonObject(update) || !message || message.role !== "assistant") return;
    if (isJsonObject(event.usage)) message.usage = event.usage;
    const index = typeof update.contentIndex === "number" ? update.contentIndex : -1;
    if (index < 0 || !Number.isInteger(index)) return;
    const content: PiContentBlock[] = Array.isArray(message.content) ? message.content : [];
    message.content = content;
    switch (update.type) {
      case "text_start": content[index] = { type: "text", text: "" }; break;
      case "thinking_start": content[index] = { type: "thinking", thinking: "" }; break;
      case "text_delta":
        content[index] ??= { type: "text", text: "" };
        if (typeof update.delta === "string") content[index].text = (content[index].text ?? "") + update.delta;
        break;
      case "thinking_delta":
        content[index] ??= { type: "thinking", thinking: "" };
        if (typeof update.delta === "string") content[index].thinking = (content[index].thinking ?? "") + update.delta;
        break;
      case "thinking_end":
        if (typeof update.content === "string") content[index] = { ...content[index], type: "thinking", thinking: update.content };
        break;
      case "toolcall_start":
        content[index] = { type: "toolCall", id: typeof update.id === "string" ? update.id : undefined, name: typeof update.toolName === "string" ? update.toolName : undefined, arguments: {} };
        this.toolArguments.set(index, "");
        break;
      case "toolcall_delta":
        if (typeof update.delta === "string") this.toolArguments.set(index, (this.toolArguments.get(index) ?? "") + update.delta);
        break;
      case "toolcall_end":
        if (isJsonObject(update.toolCall)) content[index] = { ...update.toolCall, type: "toolCall" };
        break;
      default: break;
    }
  }

  private receiveUI(request: PiUIRequest): void {
    if (["select", "confirm", "input", "editor"].includes(request.method)) {
      this.current.pendingUI.push(request);
      return;
    }
    if (request.method === "notify") this.current.notifications = [...this.current.notifications.slice(-19), request];
    if (request.method === "setStatus" && typeof request.statusKey === "string") {
      if (request.statusKey === CONTEXT_STATUS_KEY) {
        this.current.contextBreakdown = readContextBreakdown(typeof request.statusText === 'string' ? request.statusText : undefined);
        return;
      }
      if (typeof request.statusText === "string") this.current.statuses[request.statusKey] = request.statusText;
      else delete this.current.statuses[request.statusKey];
    }
    if (request.method === "setWidget" && typeof request.widgetKey === "string") {
      if (Array.isArray(request.widgetLines)) this.current.widgets[request.widgetKey] = strings(request.widgetLines, "setWidget");
      else delete this.current.widgets[request.widgetKey];
    }
    if (request.method === "set_editor_text" && typeof request.text === "string") this.current.editorText = request.text;
  }

  private refreshAfterEvent(): void {
    void this.refresh().catch((error: unknown) => {
      if (this.closed) return;
      this.current.error = error instanceof Error ? error.message : String(error);
      this.publish();
    });
  }

  private publish(): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      try { listener(this.snapshot()); }
      catch (error) { console.error("Pi-DSH snapshot subscriber failed:", error instanceof Error ? error.message : String(error)); }
    }
  }

  /** Stop notifications before joining the external process. */
  async dispose(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    this.completionListeners.clear();
    this.unsubscribe();
    await this.process.dispose();
  }
}

/** Owns GUI conversation handles while leaving Pi session persistence untouched. */
export class PiBridge {
  private readonly sessions = new Map<string, PiSessionHandle>();
  private readonly opening = new Map<string, Promise<PiSessionHandle>>();
  private readonly reconnecting = new Map<string, Promise<PiSessionHandle>>();
  private closed = false;
  private discovered = new Map<string, PiSessionSummary>();
  private completionListeners = new Set<(completion: UnreadChat) => void>();

  constructor(private readonly runtime: PiRuntime, private readonly processOptions: Partial<Omit<PiProcessOptions, keyof PiRuntime | "cwd" | "sessionPath">> = {}) {}

  /** Follow settled replies across every owned session, independent of renderer subscriptions. */
  subscribeCompletions(listener: (completion: UnreadChat) => void): () => void {
    this.completionListeners.add(listener);
    return () => { this.completionListeners.delete(listener); };
  }

  /** Open an existing Pi session or start one in a selected working directory. */
  async createSession(cwd: string, sessionPath?: string, extensionRecovery?: boolean): Promise<PiSessionHandle> {
    if (this.closed) throw new Error("Pi bridge is closed");
    if (sessionPath) {
      const path = await realpath(sessionPath).catch(() => resolve(sessionPath));
      const pending = this.opening.get(path);
      if (pending) return pending;
      for (const handle of this.sessions.values()) {
        const activeFile = handle.sessionFile;
        if (activeFile && await realpath(activeFile).catch(() => resolve(activeFile)) === path) {
          const reconnecting = this.reconnecting.get(handle.id);
          if (reconnecting) return reconnecting;
          if (!handle.isClosed) return extensionRecovery === undefined || !!handle.snapshot().extensionRecovery === extensionRecovery ? handle : this.reconnect(handle.id, extensionRecovery);
        }
      }
      const racing = this.opening.get(path);
      if (racing) return racing;
      const promise = this.startSession(cwd, path, extensionRecovery);
      this.opening.set(path, promise);
      try { return await promise; }
      finally { this.opening.delete(path); }
    }
    return this.startSession(cwd, undefined, extensionRecovery);
  }

  /** Reload Pi-owned credentials and models in a fresh process using the current native session file.
   * @param id - Current GUI handle identity; repeated calls share one replacement.
   * @returns A ready replacement with a new GUI identity. Failed starts retain the old identity for retry.
   */
  async reconnect(id: string, extensionRecovery?: boolean): Promise<PiSessionHandle> {
    if (this.closed) throw new Error("Pi bridge is closed");
    const pending = this.reconnecting.get(id);
    if (pending) return pending;
    const previous = this.sessions.get(id);
    if (!previous) throw new Error("Pi conversation is not open");
    this.assertReconnectReady(previous);
    const release = previous.holdCommandsForReconnect();
    const operation = this.replaceSession(previous, extensionRecovery);
    this.reconnecting.set(id, operation);
    try { return await operation; }
    finally { this.reconnecting.delete(id); release(); }
  }

  private assertReconnectReady(previous: PiSessionHandle): void {
    const snapshot = previous.snapshot();
    if (snapshot.resourcesReloading) throw new Error('Wait for Pi resource reload to finish');
    if (snapshot.state.isStreaming || snapshot.state.isCompacting) throw new Error("Wait for Pi to finish before refreshing models");
    if (snapshot.state.pendingMessageCount > 0 || snapshot.steering.length > 0 || snapshot.followUp.length > 0) throw new Error("Deliver or clear Pi's queued messages before refreshing models");
    if (snapshot.pendingUI.length > 0) throw new Error("Complete the Pi extension dialog before refreshing models");
    if (!previous.sessionFile && snapshot.messages.length > 0) throw new Error("This Pi conversation has no session file to preserve during a reconnect");
  }

  private async replaceSession(previous: PiSessionHandle, extensionRecovery = previous.snapshot().extensionRecovery): Promise<PiSessionHandle> {
    const sessionFile = previous.sessionFile;
    let path: string | undefined;
    if (sessionFile) {
      try { path = await realpath(sessionFile); }
      catch (error) {
        if (!isJsonObject(error) || error.code !== "ENOENT") throw error;
        if (previous.snapshot().messages.length > 0) throw new Error("Pi has not persisted this conversation yet; its messages cannot be preserved during a reconnect");
      }
    }
    this.assertReconnectReady(previous);
    const name = previous.snapshot().state.sessionName;
    const operation = (async () => {
      await previous.dispose();
      let replacement: PiSessionHandle;
      try { replacement = await this.startSession(previous.cwd, path, extensionRecovery); }
      catch (error) {
        if (!previous.snapshot().extensionRecovery || extensionRecovery !== false || this.closed) throw error;
        replacement = await this.startSession(previous.cwd, path, true);
        replacement.reportRecoveryRestoreFailure(error);
      }
      if (!path && name) {
        try { await replacement.command({ type: "set_session_name", name }); }
        catch (error) {
          this.sessions.delete(replacement.id);
          await replacement.dispose();
          throw error;
        }
      }
      this.sessions.delete(previous.id);
      return replacement;
    })();
    if (path) this.opening.set(path, operation);
    try { return await operation; }
    finally { if (path && this.opening.get(path) === operation) this.opening.delete(path); }
  }

  private async startSession(cwd: string, sessionPath?: string, extensionRecovery?: boolean): Promise<PiSessionHandle> {
    if (this.closed) throw new Error("Pi bridge is closed");
    const handle = new PiSessionHandle({ ...this.runtime, ...this.processOptions, cwd: resolve(cwd), sessionPath, extensionRecovery });
    handle.subscribeCompletions(completion => {
      if (!this.closed) for (const listener of this.completionListeners) listener(completion);
    });
    this.sessions.set(handle.id, handle);
    try { await handle.start(); }
    catch (error) {
      this.sessions.delete(handle.id);
      await handle.dispose();
      throw error;
    }
    if (this.closed) {
      await handle.dispose();
      throw new Error("Pi bridge closed while starting a conversation");
    }
    return handle;
  }

  /** Return an owned GUI handle; a failed reconnect retains its closed handle for retry. */
  get(id: string): PiSessionHandle | undefined { return this.sessions.get(id); }

  /** Read session sidebar metadata from Pi's own JSONL directory. */
  async listSessions(cwd?: string | string[]): Promise<PiSessionSummary[]> {
    const agentDir = this.runtime.agentDir ?? this.runtime.env?.PI_CODING_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    const sessionArgument = this.runtime.args.lastIndexOf("--session-dir");
    const configuredDirectory = (sessionArgument >= 0 ? this.runtime.args[sessionArgument + 1] : undefined) ?? this.runtime.env?.PI_CODING_AGENT_SESSION_DIR ?? process.env.PI_CODING_AGENT_SESSION_DIR;
    const directory = configuredDirectory ?? join(agentDir, "sessions");
    const expandedDirectory = directory.startsWith("~/") || directory.startsWith("~\\") ? join(homedir(), directory.slice(2)) : directory;
    const projects = typeof cwd === 'string' ? [cwd] : cwd;
    const roots = new Set<string>();
    const selectedCwds = new Map<string, string>();
    for (const project of projects ?? [process.cwd()]) {
      if (projects) selectedCwds.set(await realpath(project).catch(() => resolve(project)), project);
      try { roots.add(await realpath(resolve(project, expandedDirectory))); }
      catch (error) {
        if (!isJsonObject(error) || error.code !== "ENOENT") throw error;
      }
    }
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if (isJsonObject(error) && error.code === "ENOENT") return;
        throw error;
      }
      await Promise.all(children.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
      }));
    };
    await Promise.all([...roots].map(walk));
    const result = await Promise.all(files.map(async (path): Promise<PiSessionSummary | undefined> => {
      const [text, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      let header: JsonObject | undefined;
      let name = "";
      let messageCount = 0;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let record: unknown;
        try { record = JSON.parse(line); }
        catch { continue; } // Pi may be appending the final JSONL record during the read.
        if (!isJsonObject(record)) continue;
        if (record.type === "session") header = record;
        if (record.type === "session_info" && typeof record.name === "string") name = record.name;
        if (record.type === "message" && isMessage(record.message)) {
          messageCount++;
          if (!name && record.message.role === "user") name = userMessageTitle(typeof record.message.content === "string" ? record.message.content : record.message.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") ?? "");
        }
      }
      if (!header || typeof header.id !== "string" || typeof header.cwd !== "string") return undefined;
      const sessionCwd = header.cwd;
      const registeredCwd = projects ? selectedCwds.get(await realpath(sessionCwd).catch(() => resolve(sessionCwd))) : sessionCwd;
      if (registeredCwd === undefined) return undefined;
      return { id: header.id, path, cwd: registeredCwd, name: name || "Untitled session", modified: metadata.mtime.toISOString(), messageCount };
    }));
    const summaries = result.filter((session): session is PiSessionSummary => session !== undefined).sort((a, b) => b.modified.localeCompare(a.modified));
    this.discovered = new Map(summaries.map(session => [session.path, session]));
    return summaries;
  }

  /** Read a listed native session without starting Pi. Live handles remain RPC-authoritative.
   * Unknown record versions fall back to native loading; this path never migrates or writes files.
   */
  async previewSession(cwd: string, path: string): Promise<PiSnapshot | null> {
    const listed = this.discovered.get(path);
    if (!listed || resolve(listed.cwd) !== resolve(cwd)) throw new Error("Session is not in this project's history");
    const canonical = await realpath(path);
    if (canonical !== resolve(path)) throw new Error("Session preview cannot follow a changed symbolic link");
    for (const session of this.sessions.values()) {
      if (!session.isClosed && session.sessionFile === canonical) return session.snapshot();
    }
    return readSessionPreview(canonical, cwd);
  }

  /** Close all session subscriptions and join every external Pi process. */
  async dispose(): Promise<void> {
    this.closed = true;
    this.completionListeners.clear();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
    await Promise.allSettled(this.reconnecting.values());
  }
}
