#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const port = Number(process.env.ATLAS_PORT || 4318);
const state = process.env.ATLAS_STATE_DIR || join(homedir(), ".viewport-atlas");
const server = resolve(dirname(fileURLToPath(import.meta.url)), "server.mjs");
let pending = Buffer.alloc(0);
let chain = Promise.resolve();
function send(value) {
  const json = Buffer.from(JSON.stringify(value));
  if (json.length > 950000) {
    send({
      id: value.id,
      error:
        "Native response exceeds the safe message limit. Use the local companion workspace to inspect large reports.",
    });
    return;
  }
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  process.stdout.write(Buffer.concat([length, json]));
}
async function ready() {
  for (let i = 0; i < 35; i++) {
    try {
      const token = await readFile(join(state, "native-token"), "utf8");
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { "x-atlas-token": token },
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) return token;
    } catch {}
    if (i === 0) {
      const child = spawn(process.execPath, [server], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    "Local companion did not start. Run npm start and reconnect.",
  );
}
async function handle(message) {
  try {
    if (
      typeof message.path !== "string" ||
      !/^\/(health|runs(?:\/[^?#]*)?|capture|folder|miro\/boards)$/.test(
        message.path,
      ) ||
      message.path.includes("..")
    )
      throw new Error("Unsupported native request.");
    const token = await ready();
    const response = await fetch(
      `http://127.0.0.1:${port}/api${message.path}`,
      {
        method: message.method || "GET",
        headers: { "x-atlas-token": token, "Content-Type": "application/json" },
        body: message.body ? JSON.stringify(message.body) : undefined,
        signal: AbortSignal.timeout(240000),
      },
    );
    const result = await response.json();
    send(
      response.ok
        ? { id: message.id, data: result }
        : {
            id: message.id,
            error: result.error || "Companion operation failed.",
          },
    );
  } catch (e) {
    send({ id: message.id, error: e.message });
  }
}
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const size = pending.readUInt32LE(0);
    if (size > 48_000_000) {
      process.exit(1);
    }
    if (pending.length < size + 4) break;
    const payload = pending.subarray(4, size + 4);
    pending = pending.subarray(size + 4);
    try {
      const message = JSON.parse(payload);
      chain = chain.then(() => handle(message));
    } catch {
      send({ error: "Invalid native message." });
    }
  }
});
