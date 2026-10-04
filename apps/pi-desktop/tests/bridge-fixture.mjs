/** Deterministic subprocess fixture for the GUI's public RPC transport. */
import { randomUUID } from "node:crypto";

let sessionId = randomUUID();
let buffer = "";
let first;
let messages = [];
let entries = [];
let leafId = null;
let running = false;
let pending = [];
let name;
let contextUsage;
let contextTokens;
const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const respond = (command, data) => emit({ type: "response", id: command.id, command: command.type, success: true, data });
const state = () => ({ sessionId, thinkingLevel: "medium", isStreaming: running, isCompacting: false, pendingMessageCount: pending.length, messageCount: messages.length, sessionName: name });
const addEntry = (message) => {
  const entry = { type: "message", id: randomUUID(), parentId: leafId, timestamp: new Date().toISOString(), message };
  entries.push(entry);
  leafId = entry.id;
};

function command(record) {
  switch (record.type) {
    case "get_session_stats": respond(record, { contextUsage, tokens: contextTokens }); break;
    case "test_context":
      contextUsage = record.value; contextTokens = record.tokens;
      if (record.breakdown) emit({ type: 'extension_ui_request', id: randomUUID(), method: 'setStatus', statusKey: 'pi-desktop:context-v1', statusText: JSON.stringify(record.breakdown) });
      respond(record, {}); break;
    case "test_context_start": running = true; emit({ type: 'agent_start' }); respond(record, {}); break;
    case "test_context_message": {
      const message = { role: 'assistant', content: [{ type: 'text', text: 'Reply ' + messages.length }], timestamp: messages.length + 1, stopReason: record.stopReason };
      messages.push(message); addEntry(message); emit({ type: 'message_start', message }); emit({ type: 'message_end', message }); respond(record, {}); break;
    }
    case "test_context_settle": running = false; emit({ type: 'agent_settled' }); respond(record, {}); break;
    case "get_state": respond(record, state()); break;
    case "get_messages": respond(record, { messages }); break;
    case "get_entries": respond(record, { entries, leafId }); break;
    case "get_available_models": respond(record, { models: [{ id: "fixture", provider: "fixture", name: "Fixture model", reasoning: true }] }); break;
    case "get_available_thinking_levels": respond(record, { levels: ["off", "medium"] }); break;
    case "get_commands": respond(record, { commands: [] }); break;
    case "first": first = record; break;
    case "second": respond(record, { order: "second" }); respond(first, { order: "first" }); break;
    case "unicode":
      emit({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "left\u2028right\u2029end" }], timestamp: 1 } });
      respond(record, {});
      break;
    case "exit": process.exit(23); break;
    case "failure": emit({ type: "response", id: record.id, command: record.type, success: false, error: "Intentional rejection" }); break;
    case "set_session_name": name = record.name; respond(record, {}); break;
    case "new_session": sessionId = randomUUID(); messages = []; entries = []; leafId = null; respond(record, { cancelled: false }); break;
    case "thinking_summary": {
      running = true;
      emit({ type: "agent_start" });
      emit({ type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } });
      emit({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
      if (typeof record.delta === "string") emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: record.delta } });
      emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: record.summary } });
      respond(record, {});
      break;
    }
    case "prompt": {
      running = true;
      respond(record, { disposition: "started" });
      emit({ type: "agent_start" });
      const user = { role: "user", content: record.message, timestamp: 1 };
      emit({ type: "message_start", message: user }); emit({ type: "message_end", message: user });
      messages.push(user); addEntry(user);
      emit({ type: "message_start", message: { role: "assistant", content: [], timestamp: 2, stopReason: "pending" } });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 }, usage: { output: 0 } });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello\u2028" }, usage: { output: 1 } });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "world" }, usage: { output: 2 } });
      emit({ type: "extension_ui_request", id: "dialog-1", method: "confirm", title: "Continue", message: "Fixture question" });
      break;
    }
    case "extension_ui_response": {
      const assistant = { role: "assistant", content: [{ type: "text", text: "Hello\u2028world" }], timestamp: 2, stopReason: "stop" };
      messages.push(assistant); addEntry(assistant);
      emit({ type: "message_end", message: assistant });
      emit({ type: "agent_end", messages: [assistant], willRetry: false });
      running = false;
      emit({ type: "agent_settled" });
      break;
    }
    case "steer": pending.push(record.message); emit({ type: "queue_update", steering: pending, followUp: [] }); respond(record, { disposition: "queued" }); break;
    case "abort": running = false; emit({ type: "agent_settled" }); respond(record, {}); break;
    case "clear_queue": { const steering = pending; pending = []; emit({ type: "queue_update", steering: [], followUp: [] }); respond(record, { steering, followUp: [] }); break; }
    default: respond(record, {}); break;
  }
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) command(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
