import { randomUUID } from "node:crypto";
import { redactText } from "./core.mjs";

const MAX_ENTRIES = 100;
const MAX_CHARACTERS = 64000;
const MAX_MESSAGE = 8000;

function describeEvent(event) {
  const statuses = {
    "thread.started": "Connected to Codex.",
    "turn.started": "Codex is analyzing the captured evidence.",
    "turn.completed": "Codex analysis finished.",
  };
  if (statuses[event?.type]) return { type: "status", message: statuses[event.type] };
  if (event?.type === "stderr") return { type: "status", message: event.message };
  if (["error", "turn.failed"].includes(event?.type)) {
    let message = event.error?.message || event.message;
    try {
      const error = JSON.parse(message);
      message = error.error?.message || error.message || message;
    } catch {}
    return { type: "error", message };
  }
  if (!["item.started", "item.updated", "item.completed"].includes(event?.type)) return;
  const item = event.item;
  if (item?.type === "agent_message") {
    return { id: item.id && `item:${item.id}`, type: "message", message: item.text };
  }
  if (item?.type === "error") {
    const prefix = "Ignoring unknown `features` requirement `ultrafast_mode` from requirements layers: ";
    // This CLI has explicitly ignored an optional speed flag. Keep one notice,
    // without downgrading any other policy warning or a fatal turn failure.
    if (typeof item.message === "string" && item.message.startsWith(prefix) &&
      item.message.slice(prefix.length).split(", ").every((layer) => /^enterprise-managed requirements [^\r\n]+$/.test(layer))) {
      return {
        id: "notice:unsupported-managed-ultrafast-mode",
        type: "status",
        message: "This Codex CLI does not recognize the optional managed ultrafast_mode flag and has ignored it. Audit analysis can continue.",
      };
    }
    return { id: item.id && `item:${item.id}`, type: "warning", message: item.message };
  }
}

export function appendCodexOutput(run, event) {
  if (!run.profile.ai || !run.profile.liveCodexOutput) return false;
  const output = describeEvent(event);
  if (typeof output?.message !== "string" || !output.message.trim()) return false;
  const message = redactText(output.message);
  const entries = run.codexOutput ||= [];
  const entry = {
    id: output.id || randomUUID(),
    type: output.type,
    message: message.slice(0, MAX_MESSAGE),
    at: new Date().toISOString(),
  };
  if (message.length > MAX_MESSAGE) run.codexOutputTruncated = true;
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index >= 0 && entries[index].type === entry.type && entries[index].message === entry.message) return false;
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  let size = entries.reduce((total, item) => total + item.message.length, 0);
  while (entries.length > MAX_ENTRIES || size > MAX_CHARACTERS) {
    size -= entries.shift().message.length;
    run.codexOutputTruncated = true;
  }
  return true;
}
