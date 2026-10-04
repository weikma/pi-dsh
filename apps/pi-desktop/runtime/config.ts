/** Independent Pi selection takes priority over the separately executable bundled default. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJsonObject, type PiRuntime } from "../bridge/types.ts";
import { availableBundledRuntime, bundledPi } from './bundled.ts';

/** Optional shipped payload and its GUI-owned offline installation location. */
export interface RuntimeOptions { bundledRoot?: string; installationHome?: string }

/** Resolve the operator's runtime selection file for both local Web and Desktop. */
export function runtimeConfigPath(appRoot = dirname(dirname(fileURLToPath(import.meta.url)))): string {
  return process.env.PI_DESKTOP_RUNTIME_CONFIG ?? join(appRoot, "runtime", "selected.json");
}

/** Load the selected command, or install the bundled default offline when available. */
export async function loadRuntime(appRoot = dirname(dirname(fileURLToPath(import.meta.url))), options: RuntimeOptions = {}): Promise<PiRuntime> {
  const path = runtimeConfigPath(appRoot);
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (isJsonObject(error) && error.code === "ENOENT") {
      if (process.env.PI_EXECUTABLE) return { command: process.env.PI_EXECUTABLE, args: [] };
      const bundled = await availableBundledRuntime(appRoot, options.bundledRoot, options.installationHome);
      if (bundled === undefined) throw new Error('No Desktop Pi runtime is installed. Run pnpm pi:install or pnpm runtime:prepare, or explicitly select PI_EXECUTABLE.');
      return bundledPi(bundled);
    }
    throw error;
  }
  let data: unknown;
  try { data = JSON.parse(source); }
  catch (error) { void error; throw new Error('Pi runtime selection must contain valid JSON'); }
  if (isJsonObject(data) && data.mode === 'bundled') {
    if (data.agentDir !== undefined && typeof data.agentDir !== 'string') throw new Error('Invalid Pi agentDir');
    const bundled = await availableBundledRuntime(appRoot, options.bundledRoot, options.installationHome);
    if (bundled === undefined) throw new Error('The bundled Pi runtime is unavailable. Run pnpm runtime:prepare.');
    return { ...bundledPi(bundled), ...(typeof data.agentDir === 'string' && data.agentDir ? { agentDir: data.agentDir } : {}) };
  }
  if (!isJsonObject(data) || typeof data.command !== "string" || !data.command.trim()
    || !Array.isArray(data.args) || !data.args.every((arg): arg is string => typeof arg === "string")) throw new Error(`Invalid Pi runtime command or args in ${path}`);
  const env = data.env;
  if (env !== undefined && (!isJsonObject(env) || !Object.values(env).every((value) => typeof value === "string"))) throw new Error(`Pi runtime env values must be strings in ${path}`);
  if (data.agentDir !== undefined && typeof data.agentDir !== "string") throw new Error(`Invalid Pi agentDir in ${path}`);
  const result: PiRuntime = { command: data.command, args: data.args };
  if (typeof data.version === "string") result.version = data.version;
  if (isJsonObject(env)) result.env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
  if (typeof data.agentDir === "string") {
    result.agentDir = data.agentDir;
    result.env = { ...result.env, PI_CODING_AGENT_DIR: data.agentDir };
  }
  return result;
}
