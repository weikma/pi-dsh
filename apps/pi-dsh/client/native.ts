/** Specific native capabilities exposed by the sandboxed Desktop preload. */
export {}

declare global {
  interface Window {
    piDsh?: {
      platform: string
      pickDirectory(): Promise<string | null>
      openExternal(url: string): Promise<void>
      openPiTerminal?(cwd?: string): Promise<void>
      createBrowser?(): Promise<{ id: string; partition: string }>
      closeBrowser?(id: string): Promise<void>
      setUnreadCount?(count: number): Promise<void>
    }
  }
}
