/** Run the installed Pi engine and its tools against a deterministic streaming provider. */
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiBridge, type PiSessionHandle } from "../bridge/manager.ts";
import { isJsonObject, type JsonObject, type PiSnapshot } from "../bridge/types.ts";
import { bundledPi, readBundledRuntime } from '../runtime/bundled.ts';
import { loadRuntime } from "../runtime/config.ts";
import { uiExtensionSource } from "./pi-fixture.ts";
import type { UnreadChat } from '../unread-types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function waitSnapshot(session: PiSessionHandle, predicate: (snapshot: PiSnapshot) => boolean): Promise<PiSnapshot> {
  if (predicate(session.snapshot())) return Promise.resolve(session.snapshot());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Pi did not reach the expected observable state")); }, 30_000);
    const unsubscribe = session.subscribe((snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(snapshot);
    });
  });
}

function messageText(snapshot: PiSnapshot, role: string): string[] {
  return snapshot.messages.filter((message) => message.role === role).map((message) => typeof message.content === "string" ? message.content : message.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("") ?? "");
}

test("real Pi streams tool work, aborts a provider request, keeps steering and resumes its JSONL session", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-real-flow-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  const held = deferred<void>();
  const cancelled = deferred<void>();
  const queueBoundary = deferred<() => void>();
  const requests: JsonObject[] = [];
  let holdResponse: ServerResponse | undefined;
  let providerError: Error | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const body: unknown = JSON.parse(text);
      if (!isJsonObject(body)) throw new Error("Fixture provider expected a JSON request");
      requests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const delta = (data: JsonObject, finishReason: string | null = null) => response.write(`data: ${JSON.stringify({ id: `fixture-${requests.length}`, object: "chat.completion.chunk", created: 1, model: "scripted", choices: [{ index: 0, delta: data, finish_reason: finishReason }] })}\n\n`);
      const finish = (reason: string) => {
        delta({}, reason);
        response.write(`data: ${JSON.stringify({ id: `fixture-${requests.length}`, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: requests.length * 12, completion_tokens: 6, total_tokens: requests.length * 12 + 6, prompt_tokens_details: { cached_tokens: requests.length === 1 ? 0 : requests.length === 2 ? 12 : requests.length * 12 } } })}\n\n`);
        response.end("data: [DONE]\n\n");
      };
      delta({ role: "assistant" });
      if (requests.length === 1) {
        delta({ tool_calls: [{ index: 0, id: "write-file", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "roundtrip.txt", content: "Pi owns this file.\n" }) } }] });
        finish("tool_calls");
      } else if (requests.length === 2) {
        const tools = Array.isArray(body.tools) ? body.tools.filter(isJsonObject) : [];
        const shell = tools.some((tool) => isJsonObject(tool.function) && tool.function.name === "powershell") ? "powershell" : "bash";
        delta({ tool_calls: [
          { index: 0, id: "read-file", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "roundtrip.txt" }) } },
          { index: 1, id: "shell-output", type: "function", function: { name: shell, arguments: JSON.stringify({ command: "echo fixture-shell-output" }) } },
        ] });
        finish("tool_calls");
      } else if (requests.length === 3) {
        delta({ content: "Pi fixture " });
        delta({ content: "completed." });
        finish("stop");
      } else if (requests.length === 4) {
        queueBoundary.resolve(() => { delta({ content: "Queued turn complete." }); finish("stop"); });
      } else if (requests.length === 5) {
        assert.ok(JSON.stringify(body.messages).includes("Deliver this steering input."));
        delta({ content: "Steering delivered." });
        finish("stop");
      } else if (requests.length === 6) {
        assert.ok(JSON.stringify(body.messages).includes("Deliver this follow-up input."));
        delta({ content: "Follow-up delivered." });
        finish("stop");
      } else {
        holdResponse = response;
        response.once("close", () => cancelled.resolve());
        held.resolve();
      }
    })().catch((error: unknown) => {
      providerError = error instanceof Error ? error : new Error(String(error));
      response.destroy(providerError);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture provider did not bind a TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const selected = process.env.PI_DESKTOP_TEST_RUNTIME ? bundledPi(await readBundledRuntime(process.env.PI_DESKTOP_TEST_RUNTIME)) : await loadRuntime();
  const runtime = {
    ...selected,
    args: [...selected.args, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
    agentDir,
    env: { ...selected.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions") },
  };
  let bridge = new PiBridge(runtime);
  const completions: UnreadChat[] = [];
  bridge.subscribeCompletions(completion => { completions.push(completion); });
  try {
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "scripted", name: "Scripted fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "scripted", defaultThinkingLevel: "off", compaction: { enabled: false }, ...(process.platform === "win32" ? { defaultTools: ["read", "write", "edit", "powershell"] } : {}) }));
    const session = await bridge.createSession(cwd);
    await session.command({ type: 'set_session_name', name: 'Native flow fixture' })
    const snapshots: PiSnapshot[] = [];
    session.subscribe((snapshot) => snapshots.push(snapshot));
    const finished = waitSnapshot(session, (snapshot) => !snapshot.state.isStreaming && messageText(snapshot, "assistant").includes("Pi fixture completed."));
    await session.command({ type: "prompt", message: "Write @roundtrip.txt, read it, and show shell output." });
    const snapshot = await finished;
    assert.deepEqual(completions, [{ nativeSessionId: snapshot.state.sessionId, cwd, sessionFile: snapshot.state.sessionFile, entryId: snapshot.messages.findLast(message => message.role === 'assistant')?.entryId }]);
    if (providerError) throw providerError;
    assert.equal(requests.length, 3);
    assert.ok(JSON.stringify(requests[0]?.messages).includes("Write @roundtrip.txt, read it, and show shell output."));
    assert.equal(await readFile(join(cwd, "roundtrip.txt"), "utf8"), "Pi owns this file.\n");
    assert.ok(messageText(snapshot, "toolResult").some((text) => text.includes("Pi owns this file.")));
    assert.ok(messageText(snapshot, "toolResult").some((text) => text.includes("fixture-shell-output")));
    assert.ok(snapshots.some((state) => messageText(state, "assistant").includes("Pi fixture ")));
    assert.ok(Object.values(snapshot.tools).some((tool) => tool.toolName === "write" && tool.status === "complete"));
    assert.ok(Object.values(snapshot.tools).some((tool) => tool.toolName === "read" && tool.status === "complete"));
    assert.ok(snapshot.entries.some((entry) => entry.type === "message" && isJsonObject(entry.message) && entry.message.role === "toolResult"));
    const expected: unknown = JSON.parse(await readFile(new URL("./fixtures/pi-flow.expected.json", import.meta.url), "utf8"));
    const toolText = (name: string) => snapshot.messages.filter((message) => message.role === "toolResult" && message.toolName === name).map((message) => Array.isArray(message.content) ? message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("") : message.content ?? "");
    assert.deepEqual({
      assistant: messageText(snapshot, "assistant").filter(Boolean),
      read: toolText("read"),
      shell: [...toolText("bash"), ...toolText("powershell")].map((text) => text.trim()),
      file: await readFile(join(cwd, "roundtrip.txt"), "utf8"),
    }, expected);
    const lastText = await session.command({ type: 'get_last_assistant_text' });
    assert.ok(isJsonObject(lastText));
    assert.equal(lastText.text, 'Pi fixture completed.');
    const stats = await session.command({ type: 'get_session_stats' });
    assert.ok(isJsonObject(stats));
    assert.equal(stats.sessionId, snapshot.state.sessionId);
    assert.equal(stats.toolCalls, 3);
    assert.ok(isJsonObject(stats.contextUsage));
    assert.deepEqual(session.snapshot().contextUsage, stats.contextUsage);
    assert.equal(stats.contextUsage.contextWindow, 128000);
    assert.ok(typeof stats.contextUsage.tokens === "number" && stats.contextUsage.tokens > 0);
    const composition = session.snapshot().contextBreakdown;
    assert.ok(composition && composition.system > 0 && composition.tools > 0 && composition.messages > 0 && composition.results > 0);
    assert.equal(session.snapshot().statuses['pi-desktop:context-v1'], undefined);
    assert.ok(isJsonObject(stats.tokens));
    assert.equal(stats.tokens.input, 24);
    assert.equal(stats.tokens.cacheRead, 48);
    assert.equal(session.snapshot().cacheHitRate, 2 / 3);
    assert.ok(typeof stats.tokens.total === 'number' && stats.tokens.total > 0);
    const exportPath = join(cwd, 'chat export.html');
    const exported = await session.command({ type: 'export_html', outputPath: exportPath });
    assert.ok(isJsonObject(exported));
    assert.equal(exported.path, exportPath);
    assert.ok((await readFile(exportPath, 'utf8')).startsWith('<!DOCTYPE html>'), 'Pi must export a complete HTML document');
    assert.equal(requests.length, 3);

    const originalFile = snapshot.state.sessionFile;
    const userEntry = snapshot.messages.find((message) => message.role === "user")?.entryId;
    assert.equal(typeof originalFile, "string");
    assert.equal(typeof userEntry, "string");
    const assistants = snapshot.messages.filter(message => message.role === 'assistant');
    const firstAssistant = assistants[0]?.entryId;
    const lastAssistant = assistants.at(-1)?.entryId;
    assert.equal(typeof firstAssistant, 'string');
    assert.equal(typeof lastAssistant, 'string');
    assert.ok(firstAssistant && lastAssistant && userEntry);
    const requestsBeforeHistory = requests.length;
    await session.navigate(firstAssistant, 'navigate');
    assert.equal(session.snapshot().leafId, firstAssistant);
    assert.equal(session.snapshot().entries.length, snapshot.entries.length);
    assert.ok(!messageText(session.snapshot(), 'assistant').includes('Pi fixture completed.'));
    await session.navigate(lastAssistant, 'navigate');
    assert.ok(messageText(session.snapshot(), 'assistant').includes('Pi fixture completed.'));
    await session.navigate(lastAssistant, 'fork');
    assert.notEqual(session.snapshot().state.sessionId, snapshot.state.sessionId);
    assert.ok(messageText(session.snapshot(), 'assistant').includes('Pi fixture completed.'));
    await session.command({ type: 'switch_session', sessionPath: originalFile });
    await session.navigate(userEntry, 'fork');
    assert.notEqual(session.snapshot().state.sessionId, snapshot.state.sessionId);
    assert.deepEqual(messageText(session.snapshot(), 'user'), ['Write @roundtrip.txt, read it, and show shell output.']);
    assert.deepEqual(messageText(session.snapshot(), 'assistant'), []);
    await session.command({ type: 'switch_session', sessionPath: originalFile });
    assert.equal(requests.length, requestsBeforeHistory);
    await session.command({ type: "clone" });
    assert.notEqual(session.snapshot().state.sessionId, snapshot.state.sessionId);
    assert.ok(messageText(session.snapshot(), "assistant").includes("Pi fixture completed."));
    await session.command({ type: "switch_session", sessionPath: originalFile });
    assert.equal(session.snapshot().state.sessionId, snapshot.state.sessionId);
    const fork = await session.command({ type: "fork", entryId: userEntry });
    assert.ok(isJsonObject(fork) && fork.text === "Write @roundtrip.txt, read it, and show shell output.");
    assert.notEqual(session.snapshot().state.sessionId, snapshot.state.sessionId);
    assert.deepEqual(messageText(session.snapshot(), "user"), []);
    await session.command({ type: "switch_session", sessionPath: originalFile });
    assert.equal(session.snapshot().state.sessionId, snapshot.state.sessionId);

    const delivered = waitSnapshot(session, (state) => !state.state.isStreaming && messageText(state, "assistant").includes("Follow-up delivered."));
    assert.equal(completions.length, 1, 'History navigation and forks must not replay completion notices');
    await session.command({ type: "prompt", message: "Exercise queued input delivery." });
    const finishQueuedTurn = await queueBoundary.promise;
    await session.command({ type: "steer", message: "Deliver this steering input." });
    await session.command({ type: "follow_up", message: "Deliver this follow-up input." });
    assert.equal(session.snapshot().state.pendingMessageCount, 2);
    finishQueuedTurn();
    await delivered;
    assert.equal(completions.length, 2, 'The drained steering/follow-up batch produces one settled result');
    assert.equal(completions[1]?.entryId, session.snapshot().messages.findLast(message => message.role === 'assistant')?.entryId);
    assert.deepEqual(session.snapshot().steering, []);
    assert.deepEqual(session.snapshot().followUp, []);

    await session.command({ type: "prompt", message: "Wait for cancellation." });
    await held.promise;
    await session.command({ type: "steer", message: "Keep this queued input." });
    await session.command({ type: "follow_up", message: "Keep this follow-up input." });
    assert.deepEqual(session.snapshot().steering, ["Keep this queued input."]);
    assert.deepEqual(session.snapshot().followUp, ["Keep this follow-up input."]);
    await session.command({ type: "abort" });
    await cancelled.promise;
    assert.equal(completions.length, 2, 'Cancellation must not mark an unfinished response as complete');
    assert.equal(session.snapshot().state.isStreaming, false);
    assert.equal(session.snapshot().error, undefined, 'User cancellation must not raise a failure notice');
    assert.deepEqual(session.snapshot().steering, ["Keep this queued input."]);
    assert.deepEqual(session.snapshot().followUp, ["Keep this follow-up input."]);
    await session.command({ type: "clear_queue" });
    const sessionPath = session.snapshot().state.sessionFile;
    assert.equal(typeof sessionPath, "string");
    const summaries = await bridge.listSessions(cwd);
    assert.ok(summaries.some((summary) => summary.id === snapshot.state.sessionId), JSON.stringify({ summaries, sessionPath, sessionId: snapshot.state.sessionId }));
    await bridge.dispose();
    bridge = new PiBridge(runtime);
    bridge.subscribeCompletions(completion => { completions.push(completion); });
    const resumed = await bridge.createSession(cwd, sessionPath);
    const [same, alsoSame] = await Promise.all([bridge.createSession(cwd, sessionPath), bridge.createSession(cwd, sessionPath)]);
    assert.equal(same.id, resumed.id);
    assert.equal(alsoSame.id, resumed.id);
    assert.equal(resumed.snapshot().state.sessionId, snapshot.state.sessionId);
    assert.ok(messageText(resumed.snapshot(), "assistant").includes("Pi fixture completed."));
    assert.ok(messageText(resumed.snapshot(), "toolResult").some((text) => text.includes("fixture-shell-output")));
    assert.equal(resumed.snapshot().state.isStreaming, false);
    assert.equal(completions.length, 2, 'Resuming stored replies must not replay completion notices');
  } finally {
    await bridge.dispose();
    holdResponse?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("real Pi extension dialogs round-trip through the public UI subprotocol without a model run", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-extension-flow-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const extension = join(root, "ui-check.ts");
  await writeFile(extension, uiExtensionSource, { flag: "wx", mode: 0o600 });
  const selected = process.env.PI_DESKTOP_TEST_RUNTIME ? bundledPi(await readBundledRuntime(process.env.PI_DESKTOP_TEST_RUNTIME)) : await loadRuntime();
  const bridge = new PiBridge({ ...selected, agentDir, env: { ...selected.env, PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions") }, args: [...selected.args, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", extension] });
  try {
    const session = await bridge.createSession(root);
    assert.ok(session.snapshot().commands.some((command) => command.name === "ui-check"));
    const handled = session.command({ type: "prompt", message: "/ui-check" });
    const responses = [
      { method: "confirm", confirmed: true },
      { method: "select", value: "Option B" },
      { method: "input", value: "verified" },
      { method: "editor", value: "# Edited" },
    ];
    for (const response of responses) {
      const snapshot = await waitSnapshot(session, (state) => state.pendingUI.some((request) => request.method === response.method));
      const request = snapshot.pendingUI.find((request) => request.method === response.method);
      assert.ok(request);
      await session.command({ type: "extension_ui_response", id: request.id, ...response });
    }
    const result = await handled;
    assert.ok(isJsonObject(result) && result.disposition === "handled");
    assert.equal(session.snapshot().state.isStreaming, false);
    assert.deepEqual(session.snapshot().pendingUI, []);
    const output = "Dialogs verified: yes | Option B | verified | # Edited";
    assert.ok(session.snapshot().notifications.some((notification) => notification.message === output));
    assert.ok(messageText(session.snapshot(), "custom").includes(output));
  } finally {
    await bridge.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
