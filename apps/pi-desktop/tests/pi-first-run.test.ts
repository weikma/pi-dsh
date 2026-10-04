/** Credential discovery uses the real official Pi in private directories, with no model network calls. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PiBridge } from "../bridge/manager.ts";
import { availableBundledRuntime, bundledPi } from "../runtime/bundled.ts";

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("an empty Pi profile opens without models and a reconnect discovers native CLI credentials while preserving its JSONL", { timeout: 60_000 }, async context => {
  const runtime = await availableBundledRuntime(sourceRoot, process.env.PI_DESKTOP_TEST_RUNTIME);
  if (!runtime) { context.skip("Prepare the native official Pi runtime to exercise first-run credential discovery"); return; }
  const root = await mkdtemp(join(tmpdir(), "pi-first-run-native-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(agentDir); await mkdir(workspace);
  const extension = join(root, "seed.mjs");
  const seed = "export default function(){}\n";
  await writeFile(extension, seed);
  const selected = bundledPi(runtime);
  const credentialEnvironment = Object.fromEntries(Object.keys(process.env).filter(key => /key|token|secret|credential|password|auth|aws|azure|google|cloud|vertex/iu.test(key)).map(key => [key, ""]));
  const childEnvironment: Record<string, string> = { ...selected.env, ...credentialEnvironment, DEEPSEEK_API_KEY: "", PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(root, "sessions") };
  const bridge = new PiBridge({ ...selected, agentDir,
    args: [...selected.args, "--no-skills", "--no-prompt-templates", "--no-themes", "-e", extension], env: childEnvironment });
  try {
    const empty = await bridge.createSession(workspace);
    assert.equal(empty.snapshot().models.filter(model => model.provider === "deepseek").length, 0);
    await empty.command({ type: "set_session_name", name: "First-run empty conversation" });
    const reconnecting = bridge.reconnect(empty.id);
    await assert.rejects(empty.command({ type: "get_state" }), /models are refreshing/);
    const emptyReplacement = await reconnecting;
    assert.equal(empty.isClosed, true);
    assert.equal(emptyReplacement.snapshot().state.sessionName, "First-run empty conversation");
    assert.equal(emptyReplacement.snapshot().messages.length, 0);
    const sdk = pathToFileURL(join(dirname(dirname(runtime.pi.cli)), "index.js")).href;
    const createSession = `import {SessionManager} from ${JSON.stringify(sdk)};
const session=SessionManager.create(process.argv[1],process.argv[2]);
session.appendMessage({role:'assistant',content:[{type:'text',text:'Persisted before provider login'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
console.log(session.getSessionFile());`;
    const seeded = await promisify(execFile)(runtime.node.executable, ["--input-type=module", "-e", createSession, workspace, join(root, "sessions")], {
      cwd: workspace, env: { PATH: childEnvironment.PATH, PI_CODING_AGENT_DIR: agentDir }, timeout: 30_000,
    });
    const original = await bridge.createSession(workspace, seeded.stdout.trim());
    assert.equal(original.snapshot().state.isStreaming, false);
    assert.equal(original.snapshot().models.filter(model => model.provider === "deepseek").length, 0);
    await assert.rejects(original.command({ type: "prompt", message: "/login" }), /No API key/);
    const sessionFile = original.sessionFile;
    assert.ok(sessionFile);
    const before = await readFile(sessionFile, "utf8");
    assert.ok(before.includes("Persisted before provider login"));
    const nativeSessionId = original.snapshot().state.sessionId;
    const script = `import {ModelRuntime} from ${JSON.stringify(sdk)};
const runtime = await ModelRuntime.create({authPath:process.argv[1],modelsPath:null,allowModelNetwork:false});
await runtime.login('deepseek','api_key',{prompt:async()=> 'private-first-run-fixture-key',notify:()=>{}});
if(runtime.getAvailableSnapshot().filter(model=>model.provider==='deepseek').length===0)throw new Error('Native credential fixture did not resolve models');`;
    await promisify(execFile)(runtime.node.executable, ["--input-type=module", "-e", script, join(agentDir, "auth.json")], {
      cwd: workspace, env: { PATH: childEnvironment.PATH, PI_CODING_AGENT_DIR: agentDir }, timeout: 30_000,
    });
    await original.command({ type: "get_available_models" });
    assert.equal(original.snapshot().models.filter(model => model.provider === "deepseek").length, 0);
    await writeFile(extension, "throw new Error('Private reconnect startup failure')\n");
    await assert.rejects(bridge.reconnect(original.id), /Private reconnect startup failure/);
    assert.equal(original.isClosed, true);
    assert.equal(bridge.get(original.id), original);
    await writeFile(extension, seed);
    const [replacement, repeated] = await Promise.all([bridge.reconnect(original.id), bridge.reconnect(original.id)]);
    assert.equal(replacement, repeated);
    assert.notEqual(replacement.id, original.id);
    assert.equal(bridge.get(original.id), undefined);
    assert.equal(replacement.cwd, workspace);
    assert.equal(replacement.snapshot().state.sessionId, nativeSessionId);
    assert.equal(replacement.sessionFile, sessionFile);
    assert.ok(replacement.snapshot().messages.some(message => message.role === "assistant" && Array.isArray(message.content)
      && message.content.some(block => block.text === "Persisted before provider login")));
    assert.ok(replacement.snapshot().models.some(model => model.provider === "deepseek"));
    const model = replacement.snapshot().models.find(model => model.provider === "deepseek");
    assert.ok(model);
    await replacement.command({ type: "set_model", provider: model.provider, modelId: model.id });
    assert.equal(replacement.snapshot().state.model?.provider, "deepseek");
    assert.equal(await bridge.createSession(workspace, sessionFile), replacement);
  } finally {
    await bridge.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
