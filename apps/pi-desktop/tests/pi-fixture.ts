/** Local streaming provider and private Pi workspace for browser and engine verification. */
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isJsonObject, type JsonObject, type PiRuntime } from "../bridge/types.ts";
import { loadRuntime } from "../runtime/config.ts";

/** Test-only extension loaded through Pi's documented public extension entry. */
export const uiExtensionSource = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("ui-check", {
    description: "Verify the GUI's Pi extension dialogs",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Pi confirmation", "Continue the GUI interaction check?");
      const selected = await ctx.ui.select("Pi selection", ["Option A", "Option B"]);
      const text = await ctx.ui.input("Pi input", "Type verified");
      const edited = await ctx.ui.editor("Pi editor", "# Verified");
      const content = "Dialogs verified: " + [confirmed ? "yes" : "no", selected ?? "cancelled", text ?? "cancelled", edited ?? "cancelled"].join(" | ");
      ctx.ui.notify(content, "info");
      pi.sendMessage({ customType: "ui-check-result", content, display: true }, { triggerTurn: false });
    },
  });
}
`;

/** Start a fixture whose CLI path is the installed official Pi, never an imitation engine. */
export async function createPiFixture(selectedRuntime?: PiRuntime) {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-gui-fixture-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  const uiExtension = join(root, "ui-check.ts");
  await writeFile(uiExtension, uiExtensionSource, { flag: "wx", mode: 0o600 });
  const requests: JsonObject[] = [];
  let held: ServerResponse | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const body: unknown = JSON.parse(text);
      if (!isJsonObject(body)) throw new Error("Fixture provider expected an object");
      requests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const delta = (data: JsonObject, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `gui-${requests.length}`, object: "chat.completion.chunk", created: 1, model: "scripted", choices: [{ index: 0, delta: data, finish_reason: finish }] })}\n\n`);
      const finish = (reason: string) => {
        delta({}, reason);
        response.write(`data: ${JSON.stringify({ id: `gui-${requests.length}`, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: requests.length * 1000, completion_tokens: 60, total_tokens: requests.length * 1000 + 60, prompt_tokens_details: { cached_tokens: requests.length * 1000 - 500 } } })}\n\n`);
        response.end("data: [DONE]\n\n");
      };
      delta({ role: "assistant" });
      if (requests.length === 1) {
        delta({ tool_calls: [{ index: 0, id: "write-report", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "report.md", content: "# Pi Desktop report\n\nThe official Pi tools created this file.\n" }) } }] });
        finish("tool_calls");
      } else if (requests.length === 2) {
        const tools = Array.isArray(body.tools) ? body.tools.filter(isJsonObject) : [];
        const shell = tools.some((tool) => isJsonObject(tool.function) && tool.function.name === "powershell") ? "powershell" : "bash";
        delta({ tool_calls: [
          { index: 0, id: "read-report", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "report.md" }) } },
          { index: 1, id: "shell-report", type: "function", function: { name: shell, arguments: JSON.stringify({ command: "echo Pi Desktop shell verified" }) } },
        ] });
        finish("tool_calls");
      } else if (requests.length === 3) {
        delta({ content: "Created **report.md** with the official Pi file tools.\n\n" });
        delta({ content: "The shell returned `Pi Desktop shell verified`. You can preview the file from the workspace panel." });
        finish("stop");
      } else {
        held = response;
        delta({ content: "Waiting for your steering message or cancellation…" });
      }
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))));
  });
  let bound = false;
  try {
    await new Promise<void>((complete, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { bound = true; complete(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture provider failed to bind TCP");
    const selected = selectedRuntime ?? await loadRuntime();
    await writeFile(join(agentDir, "models.json"), `${JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "scripted", name: "Pi Desktop fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }, null, 2)}\n`);
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({ defaultProvider: "fixture", defaultModel: "scripted", defaultThinkingLevel: "off", compaction: { enabled: false }, ...(process.platform === "win32" ? { defaultTools: ["read", "write", "edit", "powershell"] } : {}) }, null, 2)}\n`);
    const runtimeConfig = join(root, "runtime.json");
    await writeFile(runtimeConfig, `${JSON.stringify({ ...selected, agentDir, args: [...selected.args, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", uiExtension], env: { ...selected.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions") } }, null, 2)}\n`);
    return {
      cwd, agentDir, runtimeConfig, requests,
      async dispose() {
        held?.destroy();
        server.closeAllConnections();
        await new Promise<void>((complete, reject) => server.close((error) => error ? reject(error) : complete()));
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (bound) {
      server.closeAllConnections();
      await new Promise<void>((complete) => server.close(() => complete()));
    }
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await createPiFixture();
  console.log(JSON.stringify({ cwd: fixture.cwd, runtimeConfig: fixture.runtimeConfig }));
  try {
    await new Promise<void>((complete) => {
      process.once("SIGINT", complete);
      process.once("SIGTERM", complete);
    });
  } finally { await fixture.dispose(); }
}
