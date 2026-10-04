/** Local repository metadata for the shared project picker; Git owns repository files. */
export interface GitBranch { name: string; current: boolean; worktree: string | null }
export interface GitRepositoryState {
  kind: 'repository'
  root: string
  branch: string | null
  head: string | null
  /** Observed HEAD identity, checked again before a branch mutation. */
  revision: string
  branches: GitBranch[]
  changedFiles: number
  conflicts: boolean
  operation: string | null
}
export type ProjectGitState = GitRepositoryState | { kind: 'not-repository' | 'unavailable' }
export type GitIssue = 'invalid-name' | 'changes-overwritten' | 'conflicts' | 'operation' | 'exists' | 'missing' | 'worktree' | 'stale' | 'busy' | 'failed'
export type GitChangeResult = { ok: true; state: GitRepositoryState } | { ok: false; issue: GitIssue; detail?: string }
export interface GitCommit {
  id: string
  parents: string[]
  author: string
  timestamp: number
  subject: string
  refs: string
}
export interface GitGraphPage { commits: GitCommit[]; hasMore: boolean }
