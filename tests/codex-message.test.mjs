import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { validateAiResult } from "../companion/schema.mjs";

// Run the production parser on every supported Node version, including Node 22.
const source = await readFile(new URL("../src/codex-message.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { readCodexObservations } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const observation = {
  severity: "high", title: "The menu obscures the purchase button",
  impact: "People on narrow screens cannot complete their purchase.",
  recommendation: "Close the menu after navigation and keep the purchase button visible.",
};

test("live structured output accepts all five priorities and preserves literal issue text", () => {
  const findings = ["critical", "high", "medium", "low", "info"].map((severity) => ({
    ...observation, severity, title: '<button onclick="alert(1)">Buy</button> is obscured',
  }));
  assert.deepEqual(readCodexObservations(JSON.stringify({ summary: "Review", findings })), findings);
  assert.deepEqual(readCodexObservations('```json\n' + JSON.stringify({ findings }) + '\n```'), findings);
  assert.deepEqual(readCodexObservations('{"summary":"No issues","findings":[]}'), []);
});

test("incomplete or invalid live findings are never presented as complete observations", () => {
  for (const value of [
    "Reviewing screenshots.", '{"findings":[', "null", '{"findings":null}',
    ...[
      { ...observation, severity: "urgent" },
      { ...observation, severity: ["high"] },
      { ...observation, title: " " },
      { ...observation, impact: null },
      { ...observation, recommendation: "" },
      null,
    ].map((finding) => JSON.stringify({ findings: [finding] })),
  ]) assert.equal(readCodexObservations(value), null, value);
});

test("validated Codex results require the four fields for every finding", () => {
  const finding = {
    ...observation, id: "menu", category: "UX / UI", url: "https://example.com/",
    devices: ["phone"], evidence: [], source: "codex", confidence: 0.8, status: "unverified",
  };
  assert.equal(validateAiResult({ summary: "Review", findings: [finding] }).findings.length, 1);
  for (const field of ["title", "impact", "recommendation", "severity"]) {
    for (const value of ["", "   ", undefined]) {
      assert.throws(() => validateAiResult({ summary: "Review", findings: [{ ...finding, [field]: value }] }), /Codex result rejected/);
    }
  }
});
