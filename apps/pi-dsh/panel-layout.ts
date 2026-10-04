/** GUI-owned panel widths in CSS pixels, independent of Pi configuration. */
export const PANEL_MINIMUM = { sidebarWidth: 264, workspaceWidth: 240 } as const
export const DEFAULT_PANEL_WIDTHS = { sidebarWidth: 280, workspaceWidth: 420 }
export interface PanelWidths { sidebarWidth: number; workspaceWidth: number }

/** Validate partial HTTP/durable preferences; absent widths retain their saved values. */
export function readPanelWidths(input: Record<string, unknown>): Partial<PanelWidths> {
  const result: Partial<PanelWidths> = {}
  for (const key of ['sidebarWidth', 'workspaceWidth'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < PANEL_MINIMUM[key] || value > 10000) {
      throw new Error(`GUI ${key} must be a whole number from ${PANEL_MINIMUM[key]} to 10000`)
    }
    result[key] = value
  }
  return result
}

/** Fit saved sizes without overwriting them when the window shrinks. Narrow workspaces overlay the chat. */
export function panelLayout(saved: PanelWidths, width: number, collapsed: boolean, workspaceOpen: boolean, rail: number) {
  const overlay = width <= 1024
  const sidebarMinimum = PANEL_MINIMUM.sidebarWidth
  const workspaceMinimum = PANEL_MINIMUM.workspaceWidth
  const sidebarSpace = collapsed ? rail : sidebarMinimum
  const workspaceLimit = Math.max(workspaceMinimum, overlay ? width - 48 : width - sidebarSpace - 360)
  const workspaceWidth = Math.min(saved.workspaceWidth, workspaceLimit)
  const sidebarMax = Math.max(sidebarMinimum, Math.min(width / 2, width - 360 - (workspaceOpen && !overlay ? workspaceWidth : 0)))
  const sidebarWidth = Math.min(saved.sidebarWidth, sidebarMax)
  const workspaceMax = Math.max(workspaceMinimum, overlay ? width - 48 : width - (collapsed ? rail : sidebarWidth) - 360)
  return { sidebarWidth: Math.floor(sidebarWidth), workspaceWidth: Math.floor(Math.min(workspaceWidth, workspaceMax)), sidebarMax: Math.floor(sidebarMax), workspaceMax: Math.floor(workspaceMax) }
}
