import { isJsonObject, type JsonObject } from './bridge/types.ts'

/** A settled native reply awaiting viewing; identities come from Pi, read state belongs to Desktop. */
export interface UnreadChat extends JsonObject {
  nativeSessionId: string
  cwd: string
  sessionFile: string
  entryId: string
}

/** Match the exact displayed native reply, independently of a GUI process handle or path alias. */
export interface UnreadReceipt { nativeSessionId: string; entryId: string }

/** Validate persisted or transported metadata without accepting transcript content. */
export function isUnreadChat(value: unknown): value is UnreadChat {
  return isJsonObject(value) && typeof value.cwd === 'string' && value.cwd.length > 0
    && typeof value.nativeSessionId === 'string' && value.nativeSessionId.length > 0
    && typeof value.sessionFile === 'string' && value.sessionFile.length > 0
    && typeof value.entryId === 'string' && value.entryId.length > 0
}
