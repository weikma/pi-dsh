/** Project-scoped local Git navigation; branch changes never stash, reset or force checkout. */
import { access, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { GitCommands, type GitOutput } from './git-command.ts'
import type { GitChangeResult, GitCommit, GitGraphPage, GitIssue, GitRepositoryState, ProjectGitState } from './git-types.ts'
import { isJsonObject } from './bridge/types.ts'

const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
function requireSuccess(result: GitOutput): string {
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Git operation failed')
  return result.stdout
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true }
  catch (error) { if (isJsonObject(error) && error.code === 'ENOENT') return false; throw error }
}
function issue(detail: string): GitIssue {
  if (/would be overwritten|would overwrite/i.test(detail)) return 'changes-overwritten'
  if (/already exists/i.test(detail)) return 'exists'
  if (/invalid reference|not a valid branch|pathspec/i.test(detail)) return 'missing'
  if (/already (?:checked out|used by worktree)/i.test(detail)) return 'worktree'
  if (/resolve your current index|unmerged/i.test(detail)) return 'conflicts'
  if (/while (?:merging|rebasing|cherry-picking|reverting|bisecting)|rebase in progress|not concluded your merge/i.test(detail)) return 'operation'
  return 'failed'
}

/** Read local refs and history; serialize mutations for aliases of the same working tree. */
export class ProjectGit {
  private readonly commands = new GitCommands()
  private readonly changes = new Map<string, Promise<GitChangeResult>>()
  private closing = false
  constructor(private readonly acquireChange: (root: string) => Promise<(() => void) | undefined> = async () => () => {}) {}

  /** Return no control for absent Git/non-repositories; other read failures remain observable. */
  async state(cwd: string): Promise<ProjectGitState> {
    let top: GitOutput
    try { top = await this.commands.run(cwd, ['rev-parse', '--show-toplevel']) }
    catch (error) { if (isJsonObject(error) && error.code === 'ENOENT') return { kind: 'unavailable' }; throw error }
    if (top.code !== 0 && /not a git repository|must be run in a work tree/i.test(top.stderr)) return { kind: 'not-repository' }
    const root = await realpath(requireSuccess(top).replace(/\r?\n$/, ''))
    const [symbolic, commit, branches, status, directory] = await Promise.all([
      this.commands.run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.commands.run(root, ['rev-parse', '--verify', 'HEAD']),
      this.commands.run(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(worktreepath)%00', 'refs/heads/']),
      this.commands.run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
      this.commands.run(root, ['rev-parse', '--absolute-git-dir']),
    ])
    if (symbolic.code !== 0 && symbolic.code !== 1) requireSuccess(symbolic)
    const branch = symbolic.code === 0 ? symbolic.stdout.trim() : null
    const head = commit.code === 0 ? commit.stdout.trim() : null
    if (head !== null && !sha.test(head)) throw new Error('Git returned an invalid HEAD')
    if (head === null && branch === null) requireSuccess(commit)
    const fields = requireSuccess(branches).split('\0')
    const refs: GitRepositoryState['branches'] = []
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const name = fields[index]!.replace(/^\n/, ''), worktree = fields[index + 1]!
      if (!name || /[\r\n]/.test(name)) throw new Error('Git returned an invalid branch list')
      refs.push({ name, current: name === branch, worktree: worktree || null })
    }
    refs.sort((a, b) => Number(b.current) - Number(a.current))
    const changes = requireSuccess(status).split('\0')
    let changedFiles = 0, conflicts = false
    for (let index = 0; index < changes.length; index++) {
      const record = changes[index]!
      if (!record) continue
      if (record.length < 4 || record[2] !== ' ') throw new Error('Git returned an invalid status record')
      const code = record.slice(0, 2)
      changedFiles++
      if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) conflicts = true
      if (/[RC]/.test(code)) index++
    }
    const gitDir = requireSuccess(directory).replace(/\r?\n$/, '')
    const operations = await Promise.all(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG'].map(async name => await exists(join(gitDir, name)) ? name : null))
    return { kind: 'repository', root, branch, head, revision: JSON.stringify([branch, head]), branches: refs, changedFiles, conflicts, operation: operations.find(value => value !== null) ?? null }
  }

  /** Read bounded pages across local branches, tags and already-present remote refs; never fetch. */
  async graph(cwd: string, skip = 0): Promise<GitGraphPage> {
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 100_000) throw new Error('Git history offset must be an integer from 0 to 100000')
    const state = await this.state(cwd)
    if (state.kind !== 'repository') throw new Error('Choose a Git repository to view its history')
    if (state.head === null) return { commits: [], hasMore: false }
    const output = requireSuccess(await this.commands.run(state.root, ['log', 'HEAD', '--branches', '--tags', '--remotes', '--topo-order', '--date-order', `--skip=${skip}`, '--max-count=51', '--format=%H%x00%P%x00%an%x00%at%x00%s%x00%D%x00']))
    const fields = output.split('\0'), commits: GitCommit[] = []
    for (let index = 0; index + 5 < fields.length; index += 6) {
      const id = fields[index]!.replace(/^\n/, ''), parents = fields[index + 1] ? fields[index + 1]!.split(' ') : []
      const timestamp = Number(fields[index + 3])
      if (!sha.test(id) || !parents.every(parent => sha.test(parent)) || !Number.isFinite(timestamp)) throw new Error('Git returned invalid commit metadata')
      commits.push({ id, parents, author: fields[index + 2]!, timestamp, subject: fields[index + 4]!, refs: fields[index + 5]! })
    }
    return { commits: commits.slice(0, 50), hasMore: commits.length > 50 }
  }

  /** Switch a local branch or create from current HEAD; Git rejects overwrites and worktree conflicts. */
  async change(cwd: string, action: 'switch' | 'create', branch: string, revision: string): Promise<GitChangeResult> {
    if (this.closing) throw new Error('Git operations are stopping')
    const initial = await this.state(cwd)
    if (initial.kind !== 'repository') throw new Error('Choose a Git repository before switching branches')
    const previous = this.changes.get(initial.root)
    const ready = previous?.then(() => {}, error => { void error /* The previous caller owns its failure; a later selection can retry. */ }) ?? Promise.resolve()
    const operation = ready.then(async (): Promise<GitChangeResult> => {
      if (this.closing) throw new Error('Git operations are stopping')
      const release = await this.acquireChange(initial.root)
      if (!release) return { ok: false, issue: 'busy' }
      try {
        const state = await this.state(cwd)
        if (state.kind !== 'repository' || state.root !== initial.root || state.revision !== revision) return { ok: false, issue: 'stale' }
        if (action === 'switch' && state.branch === branch) return { ok: true, state }
        if (state.conflicts) return { ok: false, issue: 'conflicts' }
        if (state.operation) return { ok: false, issue: 'operation' }
        if (!branch || branch !== branch.trim() || branch.startsWith('-') || branch.length > 1024 || branch.includes('\0') || branch.includes('@{')) return { ok: false, issue: 'invalid-name' }
        if ((await this.commands.run(state.root, ['check-ref-format', '--branch', branch])).code !== 0) return { ok: false, issue: 'invalid-name' }
        const existing = state.branches.some(item => item.name === branch)
        if (action === 'switch' && !existing) return { ok: false, issue: 'missing' }
        if (action === 'create' && existing) return { ok: false, issue: 'exists' }
        const args = action === 'create' ? ['switch', '--no-guess', '-c', branch, ...(state.head ? ['--', state.head] : [])] : ['switch', '--no-guess', '--', branch]
        const result = await this.commands.run(state.root, args)
        if (result.code !== 0) return { ok: false, issue: issue(result.stderr), detail: result.stderr.trim() }
        const next = await this.state(cwd)
        if (next.kind !== 'repository') throw new Error('Git repository became unavailable after switching branches')
        return { ok: true, state: next }
      } finally { release() }
    })
    this.changes.set(initial.root, operation)
    try { return await operation }
    finally { if (this.changes.get(initial.root) === operation) this.changes.delete(initial.root) }
  }

  /** Stop new work and join in-flight Git commands and queued branch changes. */
  async close(): Promise<void> {
    this.closing = true
    await this.commands.close()
    await Promise.allSettled(this.changes.values())
  }
}
