import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUrl,
  validateDevices,
  validateProfile,
  safePath,
  mergeFindings,
  compareFindings,
  redactUrl,
} from "../companion/core.mjs";
import { clipBounds } from "../companion/capture.mjs";
import { validateFinding, validateAiResult } from "../companion/schema.mjs";
import { codexArgs } from "../companion/codex.mjs";
import { browserFindings } from "../companion/audit.mjs";
const finding = (id = "a", overrides = {}) => ({
  id,
  title: "Button has no accessible name",
  category: "Accessibility",
  severity: "high",
  url: "https://example.com/",
  devices: ["mobile"],
  evidence: [
    {
      deviceId: "mobile",
      screenshot: "/evidence/run/screenshots/mobile.png",
      locator: "#action",
      bounds: { x: 1, y: 2, width: 100, height: 30 },
    },
  ],
  impact: "Action cannot be identified by a screen reader.",
  recommendation: "Provide an accessible name.",
  source: "axe-core",
  confidence: 1,
  status: "unverified",
  rule: "button-name",
  ...overrides,
});
test("only HTTP(S) URLs without embedded credentials can be navigated", () => {
  assert.equal(
    validateUrl("https://example.com/path?q=one#two"),
    "https://example.com/path?q=one#two",
  );
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "https://user:secret@example.com",
    "invalid",
  ])
    assert.throws(() => validateUrl(value));
});
test("custom viewport dimensions and unique IDs are bounded", () => {
  const d = { id: "mobile", name: "Phone", width: 393, height: 852 };
  assert.equal(validateDevices([d]).length, 1);
  for (const devices of [
    [],
    [d, d],
    [{ ...d, width: 10000 }],
    [{ ...d, id: "../../outside" }],
  ])
    assert.throws(() => validateDevices(devices));
});
test("evidence paths cannot escape a run directory", () => {
  assert.equal(safePath("/tmp/run", "crops/a.png"), "/tmp/run/crops/a.png");
  for (const p of ["../secret", "/etc/passwd", "crops/../../secret"])
    assert.throws(() => safePath("/tmp/run", p));
});
test("duplicate rules retain distinct device evidence and combine device IDs", () => {
  const result = mergeFindings([
    finding(),
    finding("b", {
      devices: ["desktop"],
      evidence: [
        {
          deviceId: "desktop",
          screenshot: "desktop.png",
          locator: "#action",
          bounds: null,
        },
      ],
    }),
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(new Set(result[0].devices), new Set(["mobile", "desktop"]));
  assert.equal(result[0].evidence.length, 2);
  assert.equal(
    mergeFindings([
      finding(),
      finding("b", {
        evidence: [
          {
            deviceId: "desktop",
            screenshot: "desktop.png",
            locator: "#other",
            bounds: null,
          },
        ],
      }),
    ]).length,
    2,
  );
});
test("history comparison distinguishes new, resolved, recurring, and dismissed issues", () => {
  assert.deepEqual(
    compareFindings(
      [finding("old"), finding("shared")],
      [
        finding("new"),
        finding("shared"),
        finding("dismissed", { status: "dismissed" }),
      ],
    ),
    { new: ["new"], resolved: ["old"], recurring: ["shared"] },
  );
});
test("query credentials are removed before evidence enters a report", () => {
  const url = redactUrl(
    "https://example.com/?auth=abc&session_id=secret&search=flowers#section",
  );
  assert(!url.includes("abc"));
  assert(!url.includes("secret"));
  assert(url.includes("search=flowers"));
});
test("crop mapping clips to actual screenshot pixels without negative rectangles", () => {
  assert.deepEqual(
    clipBounds({ x: -10, y: 5, width: 100, height: 50 }, 200, 100),
    { left: 0, top: 0, width: 136, height: 86 },
  );
  assert.equal(
    clipBounds({ x: 250, y: 5, width: 100, height: 50 }, 200, 100),
    null,
  );
  assert.equal(
    clipBounds({ x: NaN, y: 0, width: 1, height: 1 }, 200, 100),
    null,
  );
});
test("finding schema rejects invalid confidence, missing evidence fields, and fabricated sources", () => {
  assert.equal(
    validateFinding(finding()).title,
    "Button has no accessible name",
  );
  for (const f of [
    finding("a", { confidence: 2 }),
    finding("a", { source: "fake" }),
    finding("a", { evidence: [{ deviceId: "mobile" }] }),
  ])
    assert.throws(() => validateFinding(f));
});
test("Codex runs with image attachments and no shell, inherited config, hooks, or connectors", () => {
  const args = codexArgs("/tmp/a", "/tmp/schema", "/tmp/result", [
    "/tmp/image.png",
  ]);
  assert(args.includes("--ignore-user-config"));
  assert(args.includes("--ignore-rules"));
  assert(args.includes("shell_tool"));
  assert(args.includes("read-only"));
  assert(args.includes("mcp_servers={}"));
  assert.equal(args[args.indexOf("--image") + 1], "/tmp/image.png");
  assert(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});
test("browser checks report observations without inventing scores", () => {
  const issues = browserFindings(
    {
      url: "https://example.com",
      title: "",
      description: "",
      h1: 0,
      overflow: true,
    },
    "mobile",
    "s.png",
  );
  assert.equal(issues.length, 4);
  assert(
    issues.every((f) => f.source === "browser" && f.status === "unverified"),
  );
  assert(!JSON.stringify(issues).includes("score"));
});

test("manual observations are not automatically declared resolved", () => {
  assert.deepEqual(
    compareFindings([finding("manual", { source: "manual" })], []),
    { new: [], resolved: [], recurring: [] },
  );
});
