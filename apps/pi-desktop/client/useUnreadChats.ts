import { useEffect, useMemo, useRef, useState } from 'react'
import type { PiSnapshot } from '../bridge/types.ts'
import type { UnreadChat } from '../unread-types.ts'
import { api, followUnread } from './http.ts'
import type {} from './native.ts'

/** A reply is read only while its native entry is displayed in a focused, visible conversation. */
export function useUnreadChats(snapshot: PiSnapshot | null, obscured: boolean, failed: (reason: unknown) => void, changed: () => Promise<void>): ReadonlySet<string> {
  const [items, setItems] = useState<UnreadChat[]>([])
  const pending = useRef(new Set<string>())
  useEffect(() => followUnread(next => {
    setItems(previous => previous.length === next.length && previous.every((item, index) => item.nativeSessionId === next[index]?.nativeSessionId && item.entryId === next[index]?.entryId) ? previous : next)
  }), [])
  useEffect(() => { void window.piDesktop?.setUnreadCount?.(items.length).catch(failed) }, [items.length, failed])
  useEffect(() => { if (items.length) void changed() }, [items, changed])
  useEffect(() => {
    const acknowledge = (): void => {
      if (obscured || document.visibilityState !== 'visible' || !document.hasFocus()) return
      const item = items.find(item => item.nativeSessionId === snapshot?.state.sessionId && snapshot.messages.some(message => message.entryId === item.entryId))
      if (!item) return
      const key = JSON.stringify([item.nativeSessionId, item.entryId])
      if (pending.current.has(key)) return
      pending.current.add(key)
      void api.readChat({ nativeSessionId: item.nativeSessionId, entryId: item.entryId }).catch(failed).finally(() => { pending.current.delete(key) })
    }
    acknowledge()
    window.addEventListener('focus', acknowledge)
    document.addEventListener('visibilitychange', acknowledge)
    return () => { window.removeEventListener('focus', acknowledge); document.removeEventListener('visibilitychange', acknowledge) }
  }, [items, snapshot, obscured, failed])
  return useMemo(() => new Set(items.map(item => item.nativeSessionId)), [items])
}
