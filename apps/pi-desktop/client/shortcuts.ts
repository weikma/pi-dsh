import type {} from './native.ts'

/** Codex's panel bindings, shared by native Desktop and the local Web GUI. */
export function panelShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>, platform: string): 'history' | 'files' | undefined {
  if (event.isComposing || event.repeat || event.shiftKey) return undefined
  const modifier = platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  // Option can change the produced character on macOS; the physical B key remains KeyB.
  if (!modifier || (event.code !== 'KeyB' && event.key.toLowerCase() !== 'b')) return undefined
  return event.altKey ? 'files' : 'history'
}

/** Infer Web keyboard bindings and labels independently of runtime selection. */
export function shortcutPlatform(): string {
  return window.piDesktop?.platform ?? (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : 'web')
}
