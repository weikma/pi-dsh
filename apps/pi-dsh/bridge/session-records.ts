/** Read-only presentation of Pi v3 JSONL; execution and migrations always belong to Pi. */
import { readFile, stat, realpath } from 'node:fs/promises'
import { isJsonObject, type JsonValue, type JsonObject, type PiMessage, type PiSnapshot } from './types.ts'

/** Validate native message fields consumed by the GUI while preserving extension fields. */
export function isMessage(value: JsonValue | undefined): value is PiMessage {
  return isJsonObject(value) && typeof value.role === "string"
    && (value.content === undefined || typeof value.content === "string"
      || (Array.isArray(value.content) && value.content.every((block) => isJsonObject(block) && typeof block.type === "string")));
}


/** Keep pre-compaction history on the active branch available to the GUI. */
export function branchMessages(entries: JsonObject[], leafId: JsonValue | undefined): PiMessage[] {
  const byId = new Map(entries.flatMap((entry) => typeof entry.id === "string" ? [[entry.id, entry] as const] : []));
  const branch: JsonObject[] = [];
  const seen = new Set<string>();
  let id = typeof leafId === "string" ? leafId : undefined;
  while (id) {
    if (seen.has(id)) throw new Error("Pi session contains a cyclic parent chain");
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) throw new Error(`Pi active branch references missing entry ${id}`);
    branch.push(entry);
    id = typeof entry.parentId === "string" ? entry.parentId : undefined;
  }
  return branch.reverse().flatMap((entry): PiMessage[] => {
    if (entry.type === "message" && isMessage(entry.message)) return [{ ...entry.message, entryId: typeof entry.id === "string" ? entry.id : undefined }];
    if (entry.type === "custom_message" && entry.display !== false) {
      const message = { role: "custom", customType: entry.customType, content: entry.content, entryId: typeof entry.id === "string" ? entry.id : undefined };
      return isMessage(message) ? [message] : [];
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      return [{ role: entry.type === "compaction" ? "compactionSummary" : "branchSummary", summary: entry.summary, entryId: typeof entry.id === "string" ? entry.id : undefined }];
    }
    return [];
  });
}

/** Read the persisted active branch before RPC readiness; unsupported formats use native loading.
 * The last entry is Pi v3's persisted leaf. Invalid trailing JSON is skipped as in Pi's reader.
 * No expanded history cache or session writes are created; the live RPC snapshot supersedes this view.
 */
export async function readSessionPreview(path: string, cwd: string): Promise<PiSnapshot | null> {
  const info = await stat(path)
  if (!info.isFile() || info.size > 64 * 1024 * 1024) return null
  const records: JsonObject[] = []
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    let record: unknown
    try { record = JSON.parse(line) }
    catch (error) { void error; continue /* Pi can be appending the final JSONL record. */ }
    if (isJsonObject(record)) records.push(record)
  }
  const header = records[0]
  if (!header || header.type !== 'session' || header.version !== 3 || typeof header.id !== 'string' || typeof header.cwd !== 'string') return null
  if (await realpath(header.cwd) !== await realpath(cwd)) throw new Error('Session belongs to a different project')
  const entries = records.slice(1)
  if (entries.some(entry => typeof entry.id !== 'string' || (entry.parentId !== null && typeof entry.parentId !== 'string'))) return null
  const leafId = typeof entries.at(-1)?.id === 'string' ? entries.at(-1)!.id : null
  let messages: PiMessage[]
  try { messages = branchMessages(entries, leafId) }
  catch (error) { void error; return null /* Native loading owns incomplete or incompatible trees. */ }
  const name = records.findLast(entry => entry.type === 'session_info' && typeof entry.name === 'string')?.name
  return {
    sessionId: '',
    state: { sessionId: header.id, sessionFile: path, ...(typeof name === 'string' ? { sessionName: name } : {}), thinkingLevel: 'off', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: messages.length },
    messages, entries, leafId: typeof leafId === 'string' ? leafId : null,
    models: [], commands: [], thinkingLevels: [], pendingUI: [], steering: [], followUp: [], tools: {}, notifications: [], statuses: {}, widgets: {},
  }
}
