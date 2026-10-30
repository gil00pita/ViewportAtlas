import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSafe, codexArgs } from "../companion/codex.mjs";
import * as codex from "../companion/codex.mjs";
import { aiSchema } from "../companion/schema.mjs";

test("Codex failures include the fatal JSONL error instead of stdin progress", async () => {
  const message = "The selected model is not supported for this account.";
  const script = `
    process.stderr.write("Reading prompt from stdin...\\n");
    console.log(JSON.stringify({type: "item.completed", item: {type: "error", message: "A nonfatal warning"}}));
    console.log(JSON.stringify({type: "turn.failed", error: {message: ${JSON.stringify(message)}}}));
    process.exitCode = 1;
  `;
  await assert.rejects(execFileSafe(process.execPath, ["-e", script]), {
    message: `${process.execPath} exited with code 1. ${message}`,
  });
});

test("process failures without JSONL retain stderr diagnostics", async () => {
  await assert.rejects(
    execFileSafe(process.execPath, ["-e", 'process.stderr.write("bad option"); process.exitCode = 2;']),
    /exited with code 2\. bad option/,
  );
});

test("Codex JSON schema declares types and requires all object properties", () => {
  const check = (schema, path = "root") => {
    if (schema.anyOf) {
      schema.anyOf.forEach((branch, index) => check(branch, `${path}.anyOf[${index}]`));
      return;
    }
    assert(schema.type, `${path} needs an explicit type`);
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, path);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), path);
      for (const [key, value] of Object.entries(schema.properties)) check(value, `${path}.${key}`);
    }
    if (schema.items) check(schema.items, `${path}[]`);
  };
  check(aiSchema);
});

test("model selection reads only the top-level Codex model", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-codex-model-"));
  const config = join(root, "config.toml");
  try {
    await writeFile(config, 'model = "configured-model" # user choice\n[mcp_servers.example]\ncommand = "never-run"\nmodel = "nested-model"\n');
    assert.equal(await codex.readCodexModel(config), "configured-model");
    await writeFile(config, "model = 'literal-model'\n[profiles.other]\nmodel = 'other-model'\n");
    assert.equal(await codex.readCodexModel(config), "literal-model");
    await writeFile(config, '[profiles.other]\nmodel = "other-model"\n');
    assert.equal(await codex.readCodexModel(config), undefined);
    assert.equal(await codex.readCodexModel(join(root, "missing.toml")), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex passes the selected model explicitly while retaining isolation", () => {
  const args = codexArgs("/work", "/schema", "/result", [], "configured-model");
  assert.equal(args[args.indexOf("--model") + 1], "configured-model");
  assert(args.includes("--ignore-user-config"));
  assert(args.includes("mcp_servers={}"));
  assert(args.includes("read-only"));
});
