/** Public RPC correlation, LF framing, streaming, dialog, and teardown regressions. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiBridge } from "../bridge/manager.ts";
import { PiProcess } from "../bridge/process.ts";
import type { PiSnapshot } from "../bridge/types.ts";

const fixture = fileURLToPath(new URL("./bridge-fixture.mjs", import.meta.url));

test('publishes composer context only at complete reply settlement and freezes all its metadata between replies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-context-settlement-'));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture], agentDir: join(directory, 'agent') });
  try {
    const session = await bridge.createSession(directory);
    const usage = { tokens: 32000, contextWindow: 128000, percent: 25 };
    const breakdown = { system: 100, tools: 50, mcp: 0, extensions: 0, skills: 0, messages: 100, results: 50 };
    const update = (value: number) => session.command({ type: 'test_context', value: { ...usage, tokens: value * 1280, percent: value }, tokens: { input: 100, cacheRead: value * 100, cacheWrite: 0 }, breakdown: { ...breakdown, messages: value * 100 } });
    await update(10);
    assert.equal(session.snapshot().completedContext, undefined);
    await session.command({ type: 'test_context_start' });
    await session.command({ type: 'test_context_message', stopReason: 'toolUse' });
    await update(20);
    assert.equal(session.snapshot().completedContext, undefined);
    await session.command({ type: 'test_context_message', stopReason: 'stop' });
    assert.equal(session.snapshot().completedContext, undefined);
    await update(25);
    await session.command({ type: 'test_context_settle' });
    const first = session.snapshot().completedContext;
    assert.deepEqual(first, { usage, breakdown: { ...breakdown, messages: 2500 }, cacheHitRate: 25 / 26 });
    // Idle model/settings refreshes and intermediate tool responses must not replace the display.
    await update(30);
    assert.equal(session.snapshot().contextUsage?.percent, 30);
    assert.deepEqual(session.snapshot().completedContext, first);
    await session.command({ type: 'test_context_start' });
    await update(40);
    await session.command({ type: 'test_context_message', stopReason: 'toolUse' });
    assert.deepEqual(session.snapshot().completedContext, first);
    await session.command({ type: 'test_context_message', stopReason: 'stop' });
    await update(50);
    assert.deepEqual(session.snapshot().completedContext, first);
    await session.command({ type: 'test_context_settle' });
    const second = session.snapshot().completedContext;
    assert.equal(second?.usage?.percent, 50);
    assert.equal(second?.breakdown?.messages, 5000);
    assert.equal(second?.cacheHitRate, 50 / 51);
    for (const stopReason of ['aborted', 'error']) {
      await session.command({ type: 'test_context_start' });
      await update(60);
      await session.command({ type: 'test_context_message', stopReason });
      await session.command({ type: 'test_context_settle' });
      assert.deepEqual(session.snapshot().completedContext, second);
    }
    await session.command({ type: 'new_session' });
    assert.equal(session.snapshot().completedContext, undefined);
    await session.command({ type: 'test_context_start' });
    await session.command({ type: 'test_context_message', stopReason: 'aborted' });
    await session.command({ type: 'test_context_settle' });
    assert.equal(session.snapshot().completedContext, undefined);
  } finally { await bridge.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('publishes complete native thinking before the assistant ends, including summaries without deltas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-thinking-end-'));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture], agentDir: join(directory, 'agent') });
  try {
    const session = await bridge.createSession(directory);
    for (const delta of [undefined, 'Partial thinking']) {
      await session.command({ type: 'thinking_summary', ...(delta === undefined ? {} : { delta }), summary: 'Complete provider summary' });
      const snapshot = session.snapshot();
      assert.equal(snapshot.state.isStreaming, true);
      assert.deepEqual(snapshot.messages.at(-1)?.content, [{ type: 'thinking', thinking: 'Complete provider summary' }]);
    }
  } finally {
    await bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("correlates out-of-order responses and preserves Unicode separators inside one LF record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-test-"));
  const pi = new PiProcess({ command: process.execPath, args: [fixture], cwd: directory });
  try {
    await pi.start();
    const [first, second] = await Promise.all([pi.request({ type: "first" }), pi.request({ type: "second" })]);
    assert.deepEqual(first, { order: "first" });
    assert.deepEqual(second, { order: "second" });
    let text;
    const unsubscribe = pi.subscribe((event) => { if (event.type === "message_start") text = event.message; });
    await pi.request({ type: "unicode" });
    assert.deepEqual(text, { role: "assistant", content: [{ type: "text", text: "left\u2028right\u2029end" }], timestamp: 1 });
    unsubscribe();
    await assert.rejects(pi.request({ type: "failure" }), /Intentional rejection/);
  } finally {
    await pi.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unexpected process exit rejects outstanding commands and disposal joins the child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-exit-"));
  const pi = new PiProcess({ command: process.execPath, args: [fixture], cwd: directory });
  try {
    await pi.start();
    await assert.rejects(pi.request({ type: "exit" }), /Pi exited \(code 23\)/);
    await pi.dispose();
    await assert.rejects(pi.request({ type: "get_state" }), /closed/);
  } finally {
    await pi.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("model reconnect rejects active work, pending dialogs and queues while the old handle stays usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-reconnect-guard-"));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture] });
  try {
    const session = await bridge.createSession(directory);
    await session.command({ type: "prompt", message: "Hold this turn" });
    await assert.rejects(bridge.reconnect(session.id), /Wait for Pi to finish/);
    assert.equal(session.isClosed, false);
    await session.command({ type: "abort" });
    await assert.rejects(bridge.reconnect(session.id), /Complete the Pi extension dialog/);
    assert.equal(session.isClosed, false);
    await session.command({ type: "extension_ui_response", id: "dialog-1", confirmed: true });
    await session.command({ type: "steer", message: "Keep this pending" });
    await assert.rejects(bridge.reconnect(session.id), /Deliver or clear/);
    assert.equal(session.isClosed, false);
    assert.deepEqual(session.snapshot().steering, ["Keep this pending"]);
    await session.command({ type: "clear_queue" });
    await assert.rejects(bridge.reconnect(session.id), /no session file to preserve/);
    assert.equal(session.isClosed, false);
    assert.equal(bridge.get(session.id), session);
  } finally {
    await bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge shutdown joins a reconnect already stopping its previous process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-reconnect-close-"));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture] });
  try {
    const original = await bridge.createSession(directory);
    const reconnecting = bridge.reconnect(original.id);
    const closing = bridge.dispose();
    const [replacement, stopped] = await Promise.allSettled([reconnecting, closing]);
    assert.equal(stopped.status, "fulfilled");
    assert.equal(replacement.status, "rejected");
    assert.equal(original.isClosed, true);
    assert.equal(bridge.get(original.id), undefined);
    await assert.rejects(bridge.createSession(directory), /closed/);
  } finally {
    await bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("model reconnect waits for an admitted command and leaves that command's process usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-reconnect-command-"));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture] });
  try {
    const original = await bridge.createSession(directory);
    const first = original.command({ type: "first" });
    await assert.rejects(bridge.reconnect(original.id), /Wait for pending Pi commands/);
    assert.equal(original.isClosed, false);
    const second = original.command({ type: "second" });
    assert.deepEqual(await first, { order: "first" });
    assert.deepEqual(await second, { order: "second" });
    const replacement = await bridge.reconnect(original.id);
    assert.equal(original.isClosed, true);
    assert.notEqual(replacement.id, original.id);
  } finally {
    await bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("interactive responses can wait for a person beyond the metadata request deadline", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-dialog-time-"));
  const pi = new PiProcess({ command: process.execPath, args: [fixture], cwd: directory });
  try {
    await pi.start();
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const waitingForPerson = pi.request({ type: "first" });
    await Promise.resolve();
    context.mock.timers.tick(30_001);
    const second = pi.request({ type: "second" });
    assert.deepEqual(await waitingForPerson, { order: "first" });
    assert.deepEqual(await second, { order: "second" });
  } finally {
    await pi.dispose();
    context.mock.timers.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

test("folds native assistant deltas, dialogs and settlement while cancellation preserves the queue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-snapshot-"));
  const bridge = new PiBridge({ command: process.execPath, args: [fixture], agentDir: join(directory, "agent") });
  try {
    const session = await bridge.createSession(directory);
    assert.equal(session.snapshot().contextUsage, undefined);
    const usage = { tokens: 32000, contextWindow: 128000, percent: 25 };
    await session.command({ type: 'test_context', value: usage });
    assert.deepEqual(session.snapshot().contextUsage, usage);
    await session.command({ type: 'test_context', value: { ...usage, tokens: null, percent: null } });
    assert.equal(session.snapshot().contextUsage?.percent, null);
    await session.command({ type: 'test_context', value: { ...usage, contextWindow: -1 } });
    assert.equal(session.snapshot().contextUsage, undefined);
    const snapshots: PiSnapshot[] = [];
    session.subscribe((snapshot) => snapshots.push(snapshot));
    await session.command({ type: "prompt", message: "Hello" });
    assert.equal(session.snapshot().pendingUI[0]?.id, "dialog-1");
    assert.ok(snapshots.some((snapshot) => snapshot.messages.some((message) => Array.isArray(message.content) && message.content.some((block) => block.text === "Hello\u2028world"))));
    assert.equal(session.snapshot().state.isStreaming, true);
    await session.command({ type: "steer", message: "Queued change" });
    await session.command({ type: "extension_ui_response", id: "dialog-1", confirmed: true });
    await session.command({ type: "abort" });
    assert.deepEqual(session.snapshot().steering, ["Queued change"]);
    assert.equal(session.snapshot().pendingUI.length, 0);
    assert.equal(session.snapshot().state.isStreaming, false);
    await session.command({ type: "clear_queue" });
    assert.deepEqual(session.snapshot().steering, []);
    assert.equal(session.snapshot().messages.filter((message) => message.role === "assistant").length, 1);
    const copied = session.snapshot();
    copied.messages.length = 0;
    assert.notEqual(session.snapshot().messages.length, 0);
  } finally {
    await bridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});


test("lists registered projects together, resolves aliases and keeps relative session directories per project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-sidebar-list-"));
  const projects = [join(directory, "one"), join(directory, "two")];
  const alias = join(directory, "alias");
  const shared = join(directory, "sessions");
  const nativeRecord = (cwd: string, id: string) => JSON.stringify({ type: "session", id, cwd }) + "\n" + JSON.stringify({ type: "session_info", name: id }) + "\n";
  const runtime = { command: process.execPath, args: [fixture, "--session-dir", "history"] };
  const bridge = new PiBridge(runtime);
  const sharedBridge = new PiBridge({ ...runtime, args: [fixture, "--session-dir", shared] });
  try {
    for (const [index, project] of projects.entries()) {
      await mkdir(join(project, "history"), { recursive: true });
      await writeFile(join(project, "history", "chat.jsonl"), nativeRecord(project, "chat-" + index));
    }
    await symlink(projects[0]!, alias, process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual((await bridge.listSessions([alias, projects[1]!])).map(session => session.cwd).sort(), [alias, projects[1]!].sort());
    await mkdir(shared);
    for (const [index, project] of projects.entries()) await writeFile(join(shared, index + ".jsonl"), nativeRecord(project, "shared-" + index));
    await writeFile(join(shared, "unregistered.jsonl"), nativeRecord(directory, "hidden"));
    assert.equal((await sharedBridge.listSessions(projects)).length, 2);
    assert.equal((await sharedBridge.listSessions(projects[0])).length, 1);
    assert.deepEqual(await sharedBridge.listSessions([]), []);
  } finally {
    await bridge.dispose(); await sharedBridge.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
