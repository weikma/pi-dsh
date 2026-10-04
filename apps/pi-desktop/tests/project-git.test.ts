/** Real disposable repositories cover branch safety, aliases, worktrees and command teardown. */
import assert from 'node:assert/strict'
import { watch } from 'node:fs'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProjectGit } from '../project-git.ts'
import { GitCommands } from '../git-command.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-project-git-'))
  const cwd = join(root, 'repository'), commands = new GitCommands(), project = new ProjectGit()
  const git = async (...args: string[]) => { const result = await commands.run(cwd, args); assert.equal(result.code, 0, result.stderr); return result.stdout.trim() }
  try {
    await mkdir(cwd); await git('init', '-b', 'main'); await git('config', 'user.name', 'Pi fixture'); await git('config', 'user.email', 'fixture@example.invalid'); await git('config', 'commit.gpgsign', 'false')
    await writeFile(join(cwd, 'readme.txt'), 'main\n'); await git('add', '.'); await git('commit', '-m', 'Initial project')
  } catch (error) { await commands.close(); await project.close(); await rm(root, { recursive: true, force: true }); throw error }
  return { root, cwd, project, git, async close() { await project.close(); await commands.close(); await rm(root, { recursive: true, force: true }) } }
}

test('local Git preserves dirty files, exposes only local branches and rejects stale/invalid changes', async () => {
  const f = await fixture()
  try {
    await f.git('switch', '-c', 'topic'); await writeFile(join(f.cwd, 'readme.txt'), 'topic\n'); await f.git('commit', '-am', 'Topic content'); await f.git('switch', 'main')
    await f.git('update-ref', 'refs/remotes/origin/remote-only', 'topic')
    await writeFile(join(f.cwd, 'readme.txt'), 'unsaved\n'); await writeFile(join(f.cwd, 'scratch.txt'), 'keep me')
    const state = await f.project.state(f.cwd); assert.equal(state.kind, 'repository'); if (state.kind !== 'repository') throw new Error('Expected repository')
    assert.equal(state.changedFiles, 2); assert.equal(state.branch, 'main'); assert.deepEqual(new Set(state.branches.map(item => item.name)), new Set(['main', 'topic']))
    const failed = await f.project.change(f.cwd, 'switch', 'topic', state.revision); assert.equal(failed.ok, false); if (!failed.ok) assert.equal(failed.issue, 'changes-overwritten')
    assert.equal(await readFile(join(f.cwd, 'readme.txt'), 'utf8'), 'unsaved\n')
    assert.deepEqual(await f.project.change(f.cwd, 'create', 'bad name', state.revision), { ok: false, issue: 'invalid-name' })
    assert.deepEqual(await f.project.change(f.cwd, 'switch', 'remote-only', state.revision), { ok: false, issue: 'missing' })
    const created = await f.project.change(f.cwd, 'create', 'codex/new', state.revision); assert.ok(created.ok); assert.equal(created.state.head, state.head); assert.equal(created.state.changedFiles, 2)
    assert.deepEqual(await f.project.change(f.cwd, 'switch', 'main', state.revision), { ok: false, issue: 'stale' })
    await writeFile(join(f.cwd, 'readme.txt'), 'main\n')
    const switched = await f.project.change(f.cwd, 'switch', 'topic', created.state.revision); assert.ok(switched.ok); assert.equal(switched.state.branch, 'topic')
    const graph = await f.project.graph(f.cwd); assert.equal(graph.commits.length, 2); assert.equal(graph.commits[0]?.subject, 'Topic content'); assert.equal(graph.commits[0]?.parents[0], graph.commits[1]?.id); assert.match(graph.commits[0]?.refs ?? '', /origin\/remote-only/)
    assert.equal(await readFile(join(f.cwd, 'scratch.txt'), 'utf8'), 'keep me')
  } finally { await f.close() }
})

test('Git handles non-repositories, unborn and detached HEAD, conflicts and occupied worktrees', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await f.project.state(f.root), { kind: 'not-repository' })
    const empty = join(f.root, 'empty'); await mkdir(empty)
    const cmd = new GitCommands(); try { assert.equal((await cmd.run(empty, ['init', '-b', 'fresh'])).code, 0) } finally { await cmd.close() }
    const unborn = await f.project.state(empty); assert.equal(unborn.kind, 'repository'); if (unborn.kind !== 'repository') throw new Error('Expected repository')
    assert.equal(unborn.head, null); assert.deepEqual(await f.project.graph(empty), { commits: [], hasMore: false }); assert.ok((await f.project.change(empty, 'create', 'newborn', unborn.revision)).ok)
    await f.git('switch', '--detach'); const detached = await f.project.state(f.cwd); assert.equal(detached.kind, 'repository'); if (detached.kind !== 'repository') throw new Error('Expected repository'); assert.equal(detached.branch, null)
    await f.git('worktree', 'add', join(f.root, 'other'), 'main')
    const occupied = await f.project.state(f.cwd); assert.equal(occupied.kind, 'repository'); if (occupied.kind !== 'repository') throw new Error('Expected repository'); assert.ok(occupied.branches[0]?.worktree)
    const denied = await f.project.change(f.cwd, 'switch', 'main', occupied.revision); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.issue, 'worktree')
    await writeFile(join(f.cwd, '.git', 'MERGE_HEAD'), occupied.head! + '\n'); assert.deepEqual(await f.project.change(f.cwd, 'create', 'blocked', occupied.revision), { ok: false, issue: 'operation' })
    await rm(join(f.cwd, '.git', 'MERGE_HEAD'))
    await f.git('switch', '-c', 'conflict'); await writeFile(join(f.cwd, 'readme.txt'), 'one\n'); await f.git('commit', '-am', 'One')
    await f.git('switch', '-c', 'other-conflict', 'HEAD~1'); await writeFile(join(f.cwd, 'readme.txt'), 'two\n'); await f.git('commit', '-am', 'Two')
    const merge = new GitCommands(); try { assert.notEqual((await merge.run(f.cwd, ['merge', 'conflict'])).code, 0) } finally { await merge.close() }
    const conflict = await f.project.state(f.cwd); assert.equal(conflict.kind, 'repository'); if (conflict.kind !== 'repository') throw new Error('Expected repository'); assert.equal(conflict.conflicts, true)
    assert.deepEqual(await f.project.change(f.cwd, 'create', 'blocked', conflict.revision), { ok: false, issue: 'conflicts' })
  } finally { await f.close() }
})

test('branch mutations serialize across path aliases and obey the Pi activity gate', async () => {
  const f = await fixture(); let releaseGate!: () => void; let entered!: () => void
  const first = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { releaseGate = resolve })
  let calls = 0
  const p = new ProjectGit(async () => { if (++calls === 1) { entered(); await gate }; return () => {} })
  try {
    const alias = join(f.root, 'alias'); await symlink(await realpath(f.cwd), alias, process.platform === 'win32' ? 'junction' : 'dir')
    const state = await p.state(alias); if (state.kind !== 'repository') throw new Error('Expected repository')
    const a = p.change(f.cwd, 'create', 'one', state.revision); await first
    const b = p.change(alias, 'create', 'two', state.revision); releaseGate()
    assert.ok((await a).ok); assert.deepEqual(await b, { ok: false, issue: 'stale' })
    const blocked = new ProjectGit(async () => undefined)
    try { assert.deepEqual(await blocked.change(f.cwd, 'switch', 'main', 'anything'), { ok: false, issue: 'busy' }) } finally { await blocked.close() }
  } finally { releaseGate(); await p.close(); await f.close() }
})

test('closing joins a Git hook and its child process group', { skip: process.platform === 'win32', timeout: 10_000 }, async () => {
  const f = await fixture(), marker = join(f.cwd, 'hook-started'), hook = join(f.cwd, '.git', 'hooks', 'post-checkout')
  const watcher = watch(f.cwd)
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve })
  watcher.on('change', (_event, name) => { if (name === 'hook-started') started() })
  try {
    const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{},1000)`
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
    await writeFile(hook, '#!/bin/sh\nexec ' + quote(process.execPath) + ' -e ' + quote(script) + '\n'); await chmod(hook, 0o755)
    const state = await f.project.state(f.cwd); if (state.kind !== 'repository') throw new Error('Expected repository')
    const changing = f.project.change(f.cwd, 'create', 'hooked', state.revision)
    const rejected = assert.rejects(changing, /cancelled|stopping/)
    await ready; const pid = Number(await readFile(marker, 'utf8'))
    await f.project.close(); await rejected
    assert.throws(() => { process.kill(pid, 0) }, { code: 'ESRCH' })
  } finally { watcher.close(); await f.close() }
})

test('history pages include existing remote refs without fetching or changing the working tree', async () => {
  const f = await fixture()
  try {
    const tree = await f.git('rev-parse', 'HEAD^{tree}'), initial = await f.git('rev-parse', 'HEAD')
    let parent = initial
    for (let index = 1; index <= 52; index++) parent = await f.git('commit-tree', tree, '-p', parent, '-m', 'History entry ' + index)
    await f.git('update-ref', 'refs/remotes/origin/history', parent)
    const first = await f.project.graph(f.cwd), second = await f.project.graph(f.cwd, 50)
    assert.equal(first.commits.length, 50); assert.equal(first.hasMore, true); assert.equal(second.commits.length, 3); assert.equal(second.hasMore, false)
    assert.equal(new Set([...first.commits, ...second.commits].map(commit => commit.id)).size, 53)
    assert.equal(await f.git('rev-parse', 'HEAD'), initial); assert.equal(await f.git('status', '--porcelain'), '')
  } finally { await f.close() }
})
