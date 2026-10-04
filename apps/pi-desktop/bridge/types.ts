import type { ContextBreakdown } from './context-breakdown.ts';

/** JSON values carried by Pi's public RPC protocol and the local GUI transport. */
export type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];

/** Extensible JSON object; optional properties disappear when serialized. */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** A native Pi content block, including extension-defined fields. */
export interface PiContentBlock extends JsonObject {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: JsonObject;
  data?: string;
  mimeType?: string;
}

/** A Pi transcript message with optional GUI identity from its persisted entry. */
export interface PiMessage extends JsonObject {
  role: string;
  content?: string | PiContentBlock[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  entryId?: string;
}

/** Provider/model fields used by the model selector, without a runtime SDK dependency. */
export interface PiModel extends JsonObject {
  id: string;
  provider: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

/** State returned by Pi's get_state command. */
export interface PiState extends JsonObject {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  model?: PiModel;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
  messageCount: number;
}

/** A command forwarded unchanged to Pi's public RPC stdin. */
export interface PiCommand extends JsonObject {
  type: string;
  id?: string;
}

/** Native session or extension UI event from Pi's RPC stdout. */
export interface PiEvent extends JsonObject {
  type: string;
}

/** An extension dialog awaiting a GUI response. */
export interface PiUIRequest extends PiEvent {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

/** Tool progress keyed by the native tool call ID. */
export interface PiToolActivity extends JsonObject {
  toolCallId: string;
  toolName?: string;
  status: "running" | "complete" | "error";
  args?: JsonObject;
  partialResult?: JsonObject;
  result?: JsonObject;
}

/** Complete GUI presentation of one Pi conversation, derived from native records. */
export interface PiSnapshot {
  sessionId: string;
  /** Current Pi context estimate; null usage follows native post-compaction semantics. */
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  /** Estimated relative sizes from the public extension; not measured token counts. */
  contextBreakdown?: ContextBreakdown;
  /** Cached reads / all input tokens across Pi's session stats; absent without usable usage. */
  cacheHitRate?: number;
  /** Composer metadata from the last completed reply; absent before the first completion. */
  completedContext?: {
    usage?: PiSnapshot['contextUsage'];
    breakdown?: ContextBreakdown;
    cacheHitRate?: number;
  };
  state: PiState;
  messages: PiMessage[];
  entries: JsonObject[];
  /** Pi's current tree position, including non-message entries. */
  leafId?: string | null;
  models: PiModel[];
  commands: JsonObject[];
  thinkingLevels: string[];
  pendingUI: PiUIRequest[];
  steering: string[];
  followUp: string[];
  tools: Record<string, PiToolActivity>;
  notifications: PiUIRequest[];
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  editorText?: string;
  error?: string;
  /** Native extension-load failure before RPC readiness; offers an explicit recovery launch. */
  errorCode?: 'extension_startup';
  /** Temporary per-process native --no-extensions selection; configured files are untouched. */
  extensionRecovery?: boolean;
  resourcesReloading?: boolean;
}

/** Metadata for an existing Pi JSONL session; the file remains Pi-owned. */
export interface PiSessionSummary {
  id: string;
  path: string;
  cwd: string;
  name: string;
  modified: string;
  messageCount: number;
}

/** External process launch configuration; args precede Pi's RPC flags. */
export interface PiRuntime {
  command: string;
  args: string[];
  env?: Record<string, string>;
  version?: string;
  agentDir?: string;
}

/** Reject non-object protocol records while retaining future Pi fields. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
