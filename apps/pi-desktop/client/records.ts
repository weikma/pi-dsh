/** Presentation records derived from Pi's own messages; no Harness event vocabulary. */
import type { PiSnapshot } from '../bridge/types.ts'
import { skillInvocation, type SkillInvocation } from '../bridge/skill-presentation.ts'

/** A JSON object recognized at the browser wire boundary. */
export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
/** Text returned by a wire value, or absence. */
export function string(value: unknown): string { return typeof value === 'string' ? value : '' }
/** Concatenate the text blocks of a Pi message or tool result. */
export function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => { const block = object(part); return block.type === 'text' ? string(block.text) : '' }).join('\n')
}

/** Tool-call data visible in the transcript. */
export interface ToolRecord { id: string; name: string; args: Record<string, unknown>; output: string; running: boolean; error: boolean; details: Record<string, unknown> }
/** One visible message block. */
export type Block = { type: 'text' | 'thinking'; text: string } | { type: 'skill'; text: string; skill: SkillInvocation } | { type: 'summary'; kind: 'compaction' | 'branch'; text: string } | { type: 'tool'; tool: ToolRecord } | { type: 'image'; url: string }
/** One Pi message rendered by the shared conversation surface. */
export interface MessageRecord { id: string; entryId?: string; role: string; blocks: Block[]; streaming: boolean; error?: string; timestamp?: number; completedAt?: number; stopReason?: string }

/** Build conversation cards from a complete Pi snapshot.
 * @param snapshot - Authoritative process snapshot.
 * @returns Messages with tool results linked by Pi tool-call id.
 */
export function messagesOf(snapshot: PiSnapshot): MessageRecord[] {
  const source: unknown[] = Array.isArray(snapshot.messages) ? snapshot.messages : []
  const results = new Map<string, Record<string, unknown>>()
  for (const value of source) {
    const message = object(value)
    if (message.role === 'toolResult') results.set(string(message.toolCallId), message)
  }
  const active = object(snapshot.state).isStreaming === true
  const lastAssistant = source.findLastIndex(value => object(value).role === 'assistant')
  const completionTimes = new Map(snapshot.entries.flatMap(entry => {
    const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    return typeof entry.id === 'string' && Number.isFinite(time) ? [[entry.id, time] as const] : []
  }))
  return source.flatMap((value, index): MessageRecord[] => {
    const message = object(value)
    const role = string(message.role)
    if (role === 'toolResult') return []
    const streaming = active && index === lastAssistant
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
    const blocks: Block[] = Array.isArray(content) ? content.flatMap((value): Block[] => {
      const block = object(value)
      if (block.type === 'text') {
        const text = string(block.text), skill = role === 'user' ? skillInvocation(text) : undefined
        return text === '' ? [] : skill ? [{ type: 'skill', text, skill }] : [{ type: 'text', text }]
      }
      if (block.type === 'thinking') return [{ type: 'thinking', text: string(block.thinking) }]
      if (block.type === 'image' && typeof block.data === 'string') return [{ type: 'image', url: `data:${string(block.mimeType) || 'image/png'};base64,${block.data}` }]
      if (block.type !== 'toolCall') return []
      const id = string(block.id)
      const activity = snapshot.tools[id]
      const result = results.get(id) ?? activity?.result ?? activity?.partialResult
      return [{ type: 'tool', tool: {
        id, name: string(block.name), args: object(block.arguments), output: textContent(result?.content),
        running: activity?.status === 'running' || (result === undefined && active), error: activity?.status === 'error' || result?.isError === true, details: object(result?.details),
      } }]
    }) : []
    if (role === 'bashExecution') blocks.push({ type: 'tool', tool: { id: String(index), name: 'bash', args: { command: message.command },
      output: string(message.output), running: false, error: typeof message.exitCode === 'number' && message.exitCode !== 0, details: { exitCode: message.exitCode } } })
    if ((role === 'compactionSummary' || role === 'branchSummary') && typeof message.summary === 'string') blocks.push({ type: 'summary', kind: role === 'compactionSummary' ? 'compaction' : 'branch', text: message.summary })
    const error = typeof message.errorMessage === 'string' && message.stopReason !== 'aborted' ? message.errorMessage : undefined
    if (blocks.length === 0 && error === undefined) return []
    return [{ id: string(message.entryId) || `${role}:${String(message.timestamp ?? index)}:${index}`, entryId: typeof message.entryId === 'string' ? message.entryId : undefined, role, blocks, streaming,
      timestamp: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? message.timestamp : undefined,
      completedAt: completionTimes.get(string(message.entryId)), stopReason: string(message.stopReason),
      ...(error === undefined ? {} : { error }) }]
  })
}

/** Read the native queue arrays without introducing a second queue. */
export function queuesOf(snapshot: PiSnapshot): { steer: string[]; followUp: string[] } {
  return { steer: snapshot.steering, followUp: snapshot.followUp }
}
