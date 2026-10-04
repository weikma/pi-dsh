/** Group native messages for disclosure without changing Pi's transcript or queue. */
import type { MessageRecord } from './records.ts'

export interface WorkRecord {
  id: string
  messages: MessageRecord[]
  active: boolean
  startedAt?: number
  completedAt?: number
  outcome: 'complete' | 'stopped' | 'error'
}
export type ConversationRow = { type: 'message'; message: MessageRecord } | { type: 'work'; work: WorkRecord }

/** One response groups its intermediate replies, thinking and tools below its user message.
 * Native entry timestamps record completion; message timestamps alone can mark generation start.
 * Missing completion metadata leaves duration unknown rather than fabricating elapsed time.
 */
export function workRows(messages: MessageRecord[], active: boolean): ConversationRow[] {
  const rows: ConversationRow[] = []
  let work: WorkRecord | undefined
  let user: MessageRecord | undefined
  let userIndex = -1, segment = 0
  const begin = (message: MessageRecord | undefined): WorkRecord => {
    const next: WorkRecord = { id: `work:${userIndex}:${segment++}`,
      messages: [], active: false, startedAt: user?.timestamp ?? message?.timestamp, outcome: 'complete' }
    rows.push({ type: 'work', work: next })
    return next
  }
  for (const message of messages) {
    if (message.role === 'user') {
      work = undefined; user = message; userIndex++; segment = 0
      rows.push({ type: 'message', message })
    } else if (message.role === 'assistant') {
      work ??= begin(message)
      work.messages.push(message)
      work.completedAt = message.completedAt
      work.outcome = message.stopReason === 'aborted' ? 'stopped' : message.error !== undefined || message.stopReason === 'error' ? 'error' : 'complete'
    } else if (work && message.role !== 'compactionSummary' && message.role !== 'branchSummary') {
      work.messages.push(message)
    } else {
      rows.push({ type: 'message', message })
      work = undefined
    }
  }
  if (active) {
    work ??= begin(undefined)
    work.active = true
  }
  return rows
}

/** Locale-independent elapsed time, retaining all units below the largest nonzero unit. */
export function workDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return [hours ? `${hours}h` : '', hours || minutes ? `${minutes}m` : '', `${seconds % 60}s`].filter(Boolean).join(' ')
}
