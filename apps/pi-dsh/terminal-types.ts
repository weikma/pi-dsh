/** Host-created PTY identity, separate from Pi sessions and GUI tabs. */
export type TerminalId = string & { readonly terminalId: unique symbol }
/** Public terminal state contains no shell environment or persisted transcript. */
export interface TerminalInfo { id: TerminalId; cwd: string; shell: string }
/** Reconnection replaces the screen before subsequent ordered output. */
export type TerminalEvent = { type: 'screen'; data: string; cols: number; rows: number } | { type: 'output'; data: string } | { type: 'exit'; code: number }
