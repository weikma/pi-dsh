/** Specific native capabilities exposed by the sandboxed Desktop preload. */
import type { NativeFileRequest } from '../file-actions.ts'

declare global {
  interface Window {
    piDesktop?: {
      platform: string
      pickDirectory(): Promise<string | null>
      openExternal(url: string): Promise<void>
      openPiTerminal?(cwd?: string): Promise<void>
      openFile?(request: NativeFileRequest): Promise<void>
      createBrowser?(): Promise<{ id: string; partition: string }>
      closeBrowser?(id: string): Promise<void>
      setUnreadCount?(count: number): Promise<void>
    }
  }
}
