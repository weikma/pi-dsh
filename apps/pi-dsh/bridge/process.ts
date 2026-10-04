/** Public Pi RPC subprocess transport with correlated commands and joined teardown. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import type { JsonValue, PiCommand, PiEvent, PiRuntime } from "./types.ts";
import { isJsonObject } from "./types.ts";

/** Limits belong to the GUI host, rather than to Pi's agent behavior. */
export interface PiProcessOptions extends PiRuntime {
  cwd: string;
  sessionPath?: string;
  requestTimeoutMs?: number;
  interactiveCommandTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxRecordBytes?: number;
  onDiagnostic?: (text: string) => void;
  onListenerError?: (error: Error) => void;
  /** Explicit recovery disables automatic extension discovery, retaining native explicit -e selections. */
  extensionRecovery?: boolean;
}

/** A native CLI extension failure before its public RPC handshake. */
export class PiExtensionStartupError extends Error {
  readonly code = 'extension_startup';
}

interface PendingRequest {
  resolve(value: JsonValue | undefined): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Owns one unmodified Pi CLI process and forwards its documented JSONL protocol. */
export class PiProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private exited: Promise<void> | undefined;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(event: PiEvent) => void>();
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private failure: Error | undefined;
  private diagnosticTail = "";
  private ready = false;

  constructor(private readonly options: PiProcessOptions) {}

  /** Start and use get_state as the readiness handshake, with no timed sleep. */
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Pi process is closed"));
    this.starting ??= this.startProcess();
    return this.starting;
  }

  private async startProcess(): Promise<void> {
    const args = [...this.options.args, "--mode", "rpc"];
    if (this.options.extensionRecovery) args.push('--no-extensions');
    const extension = process.env.PI_DSH_SESSION_EXTENSION ?? fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../runtime/pi-session-controls.ts' : './pi-session-controls.mjs', import.meta.url));
    if (existsSync(extension)) args.push('--extension', extension);
    if (this.options.sessionPath) args.push("--session", this.options.sessionPath);
    const child = spawn(this.options.command, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env, ...(this.options.agentDir ? { PI_CODING_AGENT_DIR: this.options.agentDir } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        const message = `Pi exited (${signal ?? `code ${code}`})${this.diagnosticTail ? `: ${this.diagnosticTail}` : ""}`;
        const extensionFailure = !this.ready && code === 1 && /^Error: Failed to load extension /m.test(stripVTControlCharacters(this.diagnosticTail));
        this.fail(extensionFailure ? new PiExtensionStartupError(message) : new Error(message));
        resolve();
      });
    });
    child.on("error", (error) => this.fail(error));
    child.stdin.on("error", (error) => this.fail(error));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.readChunk(chunk));
    child.stdout.on("end", () => {
      if (this.buffer.trim()) this.fail(new Error("Pi stdout ended with an incomplete JSONL record"));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.diagnosticTail = (this.diagnosticTail + chunk).slice(-4096);
      try { this.options.onDiagnostic?.(chunk); }
      catch (error) { this.reportListenerError(error); }
    });
    await this.send({ type: "get_state" });
    this.ready = true;
  }

  /** Observe native records; listener exceptions cannot break process cleanup. */
  subscribe(listener: (event: PiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Send a public RPC command. Success returns data; a rejected command throws. */
  async request(command: PiCommand): Promise<JsonValue | undefined> {
    await this.start();
    if (command.type === "extension_ui_response") {
      await this.write(command);
      return undefined;
    }
    return this.send(command);
  }

  private send(command: PiCommand): Promise<JsonValue | undefined> {
    if (this.closed || this.failure) return Promise.reject(this.failure ?? new Error("Pi process is closed"));
    const id = `desktop-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeoutMs = command.type.startsWith("get_") ? (this.options.requestTimeoutMs ?? 30_000) : this.options.interactiveCommandTimeoutMs;
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi command ${command.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ ...command, id }).catch((error: unknown) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private write(record: PiCommand): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return Promise.reject(this.failure ?? new Error("Pi stdin is unavailable"));
    return new Promise((resolve, reject) => {
      stdin.write(`${JSON.stringify(record)}\n`, (error) => error ? reject(error) : resolve());
    });
  }

  private readChunk(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > (this.options.maxRecordBytes ?? 32 * 1024 * 1024)) {
        this.fail(new Error("Pi JSONL record exceeded the host transport limit"));
        return;
      }
      try {
        const record: unknown = JSON.parse(line);
        if (!isJsonObject(record) || typeof record.type !== "string") throw new Error("Pi record must have a string type");
        if (record.type === "response") {
          if (typeof record.id !== "string") {
            if (record.success === false) this.fail(new Error(typeof record.error === "string" ? record.error : "Pi rejected an uncorrelated command"));
            continue;
          }
          const pending = this.pending.get(record.id);
          if (!pending) continue;
          this.pending.delete(record.id);
          clearTimeout(pending.timer);
          if (record.success === true) pending.resolve(record.data);
          else pending.reject(new Error(typeof record.error === "string" ? record.error : "Pi command failed"));
        } else this.emit({ ...record, type: record.type });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (Buffer.byteLength(this.buffer) > (this.options.maxRecordBytes ?? 32 * 1024 * 1024)) {
      this.fail(new Error("Pi JSONL record exceeded the host transport limit"));
    }
  }

  private emit(event: PiEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); }
      catch (error) { this.reportListenerError(error); }
    }
  }

  private reportListenerError(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      if (this.options.onListenerError) this.options.onListenerError(failure);
      else console.error("Pi DSH RPC subscriber failed:", failure.message);
    } catch (reportError) {
      console.error("Pi DSH RPC error reporter failed:", reportError instanceof Error ? reportError.message : String(reportError));
    }
  }

  private fail(error: Error): void {
    const firstFailure = this.failure === undefined;
    this.failure ??= error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }
    this.pending.clear();
    if (firstFailure && !this.closed) this.emit({ type: "bridge_error", error: this.failure.message, ...(this.failure instanceof PiExtensionStartupError ? { code: this.failure.code } : {}) });
  }

  /** Close stdin for Pi's orderly shutdown, then terminate and join if needed. */
  dispose(): Promise<void> {
    this.stopping ??= this.stopProcess();
    return this.stopping;
  }

  private async stopProcess(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    this.fail(new Error("Pi process is closed"));
    const child = this.child;
    if (!child || !this.exited) return;
    child.stdin.end();
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, this.options.shutdownTimeoutMs ?? 10_000);
    try { await this.exited; }
    finally {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      this.child = undefined;
    }
  }
}
