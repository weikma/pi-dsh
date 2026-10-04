/** Keyless compatibility check against the selected, independently installed Pi CLI. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiBridge } from "../bridge/manager.ts";
import { loadRuntime } from "./config.ts";

const root = await mkdtemp(join(tmpdir(), "pi-dsh-compat-"));
const selected = await loadRuntime();
const bridge = new PiBridge({
  ...selected,
  args: [...selected.args, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
  agentDir: join(root, "agent"),
  env: { ...selected.env, PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "agent", "sessions") },
});
try {
  const session = await bridge.createSession(root);
  let snapshot = session.snapshot();
  assert.equal(snapshot.state.isStreaming, false);
  assert.equal(typeof snapshot.state.sessionId, "string");
  assert.ok(Array.isArray(snapshot.models));
  assert.ok(Array.isArray(snapshot.thinkingLevels));
  assert.deepEqual(snapshot.messages, []);
  assert.ok(Array.isArray(snapshot.entries));
  assert.ok(snapshot.entries.every((entry) => entry.type !== "message"));
  await session.command({ type: "get_tree" });
  await session.command({ type: "clear_queue" });
  await session.command({ type: "set_session_name", name: "Pi DSH compatibility" });
  snapshot = session.snapshot();
  assert.equal(snapshot.state.sessionName, "Pi DSH compatibility");
  await session.command({ type: "new_session" });
  assert.notEqual(session.snapshot().state.sessionId, snapshot.state.sessionId);
  await session.command({ type: "abort" });
  console.log(`Pi ${selected.version ?? "external"} public RPC compatibility passed: state, messages, entries, models, commands, thinking levels, queues, naming, new session, cancellation, and joined shutdown.`);
} finally {
  await bridge.dispose();
  await rm(root, { recursive: true, force: true });
}
