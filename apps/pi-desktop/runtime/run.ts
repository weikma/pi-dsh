/** Launch the selected external Pi CLI, including its own TUI, help, and auth commands. */
import { spawn } from "node:child_process";
import { loadRuntime } from "./config.ts";

const runtime = await loadRuntime();
const child = spawn(runtime.command, [...runtime.args, ...process.argv.slice(2)], {
  env: { ...process.env, ...runtime.env },
  stdio: "inherit",
  windowsHide: false,
});
await new Promise<void>((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => {
    process.exitCode = code ?? 1;
    resolve();
  });
});
