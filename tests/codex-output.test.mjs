import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCodexOutput } from "../companion/codex-output.mjs";
import { execFileSafe } from "../companion/codex.mjs";
import { validateProfile } from "../companion/core.mjs";

const run = () => ({ profile: { ai: true, liveCodexOutput: true } });

test("Codex events arrive before process completion, across UTF-8 and JSONL chunk boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-output-stream-"));
  const acknowledgement = join(root, "received");
  const events = [], errors = [];
  try {
    const source = `
      const fs = require("node:fs");
      process.stdout.write('{"type":"thread.started"}\\n');
      const timer = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(acknowledgement)})) return;
        clearInterval(timer);
        const bytes = Buffer.from(JSON.stringify({type: "item.completed", item: {id: "message", type: "agent_message", text: "Café 🌿"}}) + "\\r\\n");
        const split = bytes.indexOf(Buffer.from("é")) + 1;
        process.stdout.write(bytes.subarray(0, split));
        setTimeout(() => {
          process.stdout.write(bytes.subarray(split));
          process.stdout.write('{"type":"turn.completed"}');
          process.stderr.write("CLI progress\\n");
        }, 10);
      }, 5);
    `;
    await execFileSafe(process.execPath, ["-e", source], {
      timeout: 5000,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "thread.started") writeFileSync(acknowledgement, "acknowledged");
      },
      onStderr: (line) => errors.push(line),
    });
    assert.deepEqual(events.map((event) => event.type), ["thread.started", "item.completed", "turn.completed"]);
    assert.equal(events[1].item.text, "Café 🌿");
    assert.deepEqual(errors, ["CLI progress"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("live output requires both AI analysis and the explicit opt-in", () => {
  for (const profile of [{ ai: true }, { ai: true, liveCodexOutput: false }, { ai: false, liveCodexOutput: true }]) {
    const audit = { profile };
    assert.equal(appendCodexOutput(audit, { type: "thread.started" }), false);
    assert.equal(audit.codexOutput, undefined);
  }
});

test("public messages update in place and unsupported internal events are excluded", () => {
  const audit = run();
  appendCodexOutput(audit, { type: "item.updated", item: { id: "reply", type: "agent_message", text: "Partial response" } });
  appendCodexOutput(audit, { type: "item.completed", item: { id: "reply", type: "agent_message", text: "Complete response" } });
  appendCodexOutput(audit, { type: "item.completed", item: { id: "internal", type: "reasoning", text: "Not a public response" } });
  appendCodexOutput(audit, null);
  assert.equal(audit.codexOutput.length, 1);
  assert.equal(audit.codexOutput[0].message, "Complete response");
});

test("an unsupported managed speed flag is explained once without hiding other warnings or failures", () => {
  const audit = run();
  const message = "Ignoring unknown `features` requirement `ultrafast_mode` from requirements layers: enterprise-managed requirements Ultra Fast mode access (rbac-ultrafast-mode)";
  for (const id of ["policy-1", "policy-2"]) appendCodexOutput(audit, {
    type: "item.completed", item: { id, type: "error", message },
  });
  assert.equal(audit.codexOutput.length, 1);
  assert.equal(audit.codexOutput[0].type, "status");
  assert.equal(audit.codexOutput[0].message, "This Codex CLI does not recognize the optional managed ultrafast_mode flag and has ignored it. Audit analysis can continue.");
  for (const warning of [
    "Ignoring unknown `features` requirement `important_new_policy` from requirements layers: enterprise-managed requirements Baseline",
    "Ignoring unknown `features` requirement `ultrafast_mode` from requirements layers: local requirements",
    "Approval policy does not satisfy enterprise requirements.",
  ]) {
    appendCodexOutput(audit, { type: "item.completed", item: { id: warning, type: "error", message: warning } });
    assert.equal(audit.codexOutput.at(-1).type, "warning");
    assert.equal(audit.codexOutput.at(-1).message, warning);
  }
  appendCodexOutput(audit, { type: "turn.failed", error: { message } });
  assert.equal(audit.codexOutput.at(-1).type, "error", "Fatal failures must never be downgraded");
  const freshRun = run();
  appendCodexOutput(freshRun, { type: "item.completed", item: { id: "policy", type: "error", message } });
  assert.equal(freshRun.codexOutput.length, 1, "Every audit gets its own compatibility notice");
});

test("output redacts credential query strings and extracts nested CLI failures", () => {
  const audit = run();
  appendCodexOutput(audit, { type: "error", message: JSON.stringify({ error: { message: "Unable to inspect https://example.com/?token=secret-value" } }) });
  assert.equal(audit.codexOutput[0].type, "error");
  assert(!audit.codexOutput[0].message.includes("secret-value"));
  assert(audit.codexOutput[0].message.includes("REDACTED"));
});

test("live output stays bounded for audit polling and persisted history", () => {
  const audit = run();
  for (let index = 0; index < 150; index++) appendCodexOutput(audit, { type: "stderr", message: "x".repeat(2000) });
  assert(audit.codexOutput.length <= 100);
  assert(audit.codexOutput.reduce((size, entry) => size + entry.message.length, 0) <= 64000);
  appendCodexOutput(audit, { type: "stderr", message: "y".repeat(20000) });
  assert.equal(audit.codexOutput.at(-1).message.length, 8000);
  assert.equal(audit.codexOutputTruncated, true);
});

test("cancellation preserves output already received", async () => {
  const audit = run();
  const controller = new AbortController();
  await assert.rejects(execFileSafe(process.execPath, ["-e", 'console.log(JSON.stringify({type:"thread.started"})); setInterval(()=>{},1000);'], {
    signal: controller.signal,
    onEvent: (event) => { appendCodexOutput(audit, event); controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(audit.codexOutput[0].message, "Connected to Codex.");
});

test("profile validation accepts legacy profiles and rejects invalid live-output options", () => {
  const profile = { name: "Test", prompt: "", categories: ["UX / UI"], ai: true, fullPage: false, masks: "" };
  assert.equal(validateProfile(profile), profile);
  assert.equal(validateProfile({ ...profile, liveCodexOutput: true }).liveCodexOutput, true);
  assert.throws(() => validateProfile({ ...profile, liveCodexOutput: "yes" }), /Invalid audit profile/);
});
