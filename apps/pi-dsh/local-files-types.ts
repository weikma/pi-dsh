/** Browser-safe records for user-requested directory selection and application opening. */
export interface DirectoryListing {
  path: string
  parent: string | null
  home: string
  entries: { name: string; path: string; hidden: boolean }[]
  truncated: boolean
}

export const LOCAL_APPLICATION_IDS = ['vscode', 'cursor', 'windsurf', 'zed', 'sublime', 'textedit', 'notepad', 'iterm', 'warp', 'ghostty', 'terminal', 'windows-terminal', 'gnome-terminal', 'konsole', 'kitty'] as const
export type LocalApplicationId = typeof LOCAL_APPLICATION_IDS[number]

export interface LocalApplication {
  id: LocalApplicationId
  name: string
  kind: 'editor' | 'terminal'
}

export interface LocalApplicationsView {
  available: boolean
  applications: LocalApplication[]
  editorName?: string
  canChooseEditor: boolean
}

/** The Host resolves application IDs; clients cannot submit executable paths or arguments. */
export type FileActionRequest = { cwd: string; path: string } & (
  | { action: 'editor' | 'chooseEditor' | 'system' | 'reveal' }
  | { action: 'application'; applicationId: LocalApplicationId }
)

export interface FileActionResult { status: 'opened' | 'cancelled' }
