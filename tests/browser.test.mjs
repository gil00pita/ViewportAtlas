import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  createViews,
  getView,
  interact,
  listViews,
  closeBrowser,
} from "../companion/browser.mjs";
import { browserEvidence } from "../companion/interaction.mjs";
import {
  prepareCapture,
  writeCapture,
  annotateFinding,
} from "../companion/capture.mjs";
import { newRun } from "../companion/core.mjs";
import { performAudit } from "../companion/audit.mjs";
import { exportToMiro } from "../companion/miro.mjs";
let server, url, root;
const devices = [
  { id: "phone", name: "Phone", width: 393, height: 852, mobile: true },
  { id: "desktop", name: "Desktop", width: 1280, height: 800, mobile: false },
];
const html = `<!doctype html><html lang="en"><head><title>Test fixture</title><meta name="description" content="Representative test page"><style>body{margin:0}header{height:80px;background:white}.desktop{display:block}.mobile{display:none}@media(max-width:600px){.desktop{display:none}.mobile{display:block}}section{height:1200px}#secret{position:absolute;top:120px;left:20px;width:100px;height:50px;background:red}#long{height:17000px}button{padding:12px}</style></head><body><header><nav class="desktop"><a id="desktop-link" href="/destination?query=one#section">Explore</a></nav><nav class="mobile"><a id="mobile-link" href="/destination?query=one#section">Explore</a></nav></header><main><h1>Test page</h1><div id="secret" data-sensitive>TOP SECRET</div><button id="buy" onclick="window.purchases=(window.purchases||0)+1">Buy now</button><button id="save" type="button" onclick="window.changes=(window.changes||0)+1">Open details</button><button id="ambiguous-a">Same name</button><button id="ambiguous-b">Same name</button><button id="hidden" style="display:none">Hidden target</button><button id="spa" type="button" onclick="history.pushState({},'', '/spa?filter=active#panel')">Open route</button><label for="plain">Name</label><input id="plain"><label for="password">Password</label><input id="password" type="password" value="must-not-mirror"><details id="details"><summary>More details</summary><p>Prepared state.</p></details><section id="first"><h2>First section</h2></section><section id="second"><h2>Second section</h2></section><div id="long"></div><img src="data:image/png;base64,iVBORw0KGgo=" /></main></body></html>`;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "atlas-tests-"));
  server = createServer((req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  await createViews(url, devices);
});
after(async () => {
  await closeBrowser();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
});
test("embedding-restricted pages render at exact independent viewports", async () => {
  for (const d of devices) {
    const p = getView(d.id).page;
    assert.equal(await p.evaluate(() => innerWidth), d.width);
    assert.equal(await p.title(), "Test fixture");
  }
  assert.equal((await listViews()).length, 2);
});
test("semantic matching uses corresponding links across different responsive IDs", async () => {
  const descriptor = await getView("desktop").page.evaluate(browserEvidence, {
    type: "describe",
    x: 20,
    y: 10,
  });
  assert.equal(descriptor.href, `${url}/destination?query=one#section`);
  const result = await getView("phone").page.evaluate(browserEvidence, {
    type: "match",
    descriptor,
  });
  assert.equal(result.ok, true);
  await getView("phone").page.waitForURL("**/destination?query=one#section");
  assert(
    getView("phone").page.url().endsWith("/destination?query=one#section"),
  );
});
test("navigation synchronization can be disabled independently of click synchronization", async () => {
  await createViews(url, devices);
  const page = getView("desktop").page;
  const link = await page.locator("#desktop-link").boundingBox();
  await interact(
    "desktop",
    { type: "click", x: link.x + 5, y: link.y + 5 },
    { clicks: true, navigation: false },
  );
  assert(page.url().includes("/destination"));
  assert.equal(getView("phone").page.url(), url + "/");
});
test("ambiguous and hidden elements are not clicked", async () => {
  const p = getView("phone").page;
  const ambiguous = await p.evaluate(browserEvidence, {
    type: "match",
    descriptor: { name: "same name", tag: "button" },
  });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.reason, /more than one/i);
  const hidden = await p.evaluate(browserEvidence, {
    type: "match",
    descriptor: { name: "hidden target", id: "hidden", tag: "button" },
  });
  assert.equal(hidden.ok, false);
  assert.match(hidden.reason, /hidden/i);
});
test("consequential purchase executes once, never in followers", async () => {
  const p = getView("phone").page;
  const b = await p.locator("#buy").boundingBox();
  await interact(
    "phone",
    { type: "click", x: b.x + 10, y: b.y + 10 },
    { clicks: true, navigation: false },
  );
  assert.equal(await p.evaluate(() => window.purchases), 1);
  assert.equal(
    await getView("desktop").page.evaluate(() => window.purchases || 0),
    0,
  );
});
test("SPA query and hash navigation propagates without coordinate mirroring", async () => {
  const p = getView("phone").page;
  const b = await p.locator("#spa").boundingBox();
  await interact(
    "phone",
    { type: "click", x: b.x + 10, y: b.y + 10 },
    { clicks: false, navigation: true },
  );
  for (const d of devices)
    assert(getView(d.id).page.url().endsWith("/spa?filter=active#panel"));
});
test("password fields cannot be edited or synchronized", async () => {
  const p = getView("phone").page;
  await p.locator("#password").focus();
  await assert.rejects(
    () => interact("phone", { type: "input", value: "leak" }, { forms: true }),
    /cannot be edited/i,
  );
  assert.equal(await p.locator("#password").inputValue(), "must-not-mirror");
});
test("shared browser context retains authentication state", async () => {
  await getView("phone")
    .page.context()
    .addCookies([{ name: "session-test", value: "authenticated", url }]);
  assert(
    (await getView("desktop").page.context().cookies(url)).some(
      (c) => c.name === "session-test" && c.value === "authenticated",
    ),
  );
});
test("full-page capture bounds lazy loading, masks pixels, preserves open state, and discloses truncation", async () => {
  const p = getView("phone").page;
  await p.locator("#details").evaluate((e) => (e.open = true));
  await p.evaluate(() => scrollTo(0, 0));
  const capture = await prepareCapture(p, { fullPage: true, masks: "#secret" });
  assert.equal(capture.width, 393);
  assert.equal(capture.height, 16000);
  const pngInfo = await sharp(capture.buffer).metadata();
  assert.equal(pngInfo.height, capture.height);
  assert.equal(pngInfo.width, capture.width);
  await writeCapture(root, "full-page-regression", "phone", capture);
  assert.equal(capture.truncated, true);
  assert(capture.metadata.state.openDetails.includes("details"));
  assert(!JSON.stringify(capture.metadata).includes("TOP SECRET"));
  const pixel = await sharp(capture.buffer)
    .extract({ left: 30, top: 130, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual([...pixel], [52, 78, 80]);
  const invalid = prepareCapture(p, { fullPage: true, masks: "[" });
  await assert.rejects(
    () => invalid,
    /Unexpected token|not a valid|InvalidSelector/i,
  );
});
test("annotation crops retain screenshot coordinate alignment and original images", async () => {
  const run = newRun(url, [devices[0]], { name: "test" });
  const capture = await prepareCapture(getView("phone").page, {
    fullPage: false,
  });
  const runRoot = join(root, "annotations");
  run.screenshots = [await writeCapture(runRoot, run.id, "phone", capture)];
  const original = await readFile(join(runRoot, "screenshots/phone.png"));
  const ev = {
    deviceId: "phone",
    screenshot: run.screenshots[0].path,
    locator: "#secret",
    bounds: { x: 20, y: 120, width: 100, height: 50 },
  };
  await annotateFinding(runRoot, run, { id: "f1", title: "Evidence" }, ev, 0);
  assert(ev.crop.endsWith("/crops/f1-0.png"));
  const crop = await sharp(join(runRoot, "crops/f1-0.png")).metadata();
  assert.equal(crop.width, 136);
  assert.deepEqual(
    await readFile(join(runRoot, "screenshots/phone.png")),
    original,
  );
});
test("real axe checks, evidence export, and readable-section PDF complete without Codex", async () => {
  const profile = {
    id: "test",
    name: "Regression fixture",
    prompt: "Test",
    categories: [
      "Accessibility",
      "Performance",
      "UX / UI",
      "SEO",
      "Best practices",
    ],
    devices: ["phone"],
    ai: false,
    fullPage: false,
    masks: "#secret",
    outputFolder: "",
    exportPdf: true,
  };
  const run = newRun(url, [devices[0]], profile);
  const runRoot = join(root, "audit");
  await performAudit(run, runRoot, { signal: new AbortController().signal });
  assert.equal(run.status, "completed", JSON.stringify(run.checks));
  assert(
    run.checks.some(
      (c) => c.name === "axe-core accessibility" && c.status === "completed",
    ),
  );
  assert(run.findings.some((f) => f.rule === "image-alt"));
  assert(
    run.checks.some((c) => c.name === "Lighthouse" && c.status === "not_run"),
  );
  assert(
    run.checks.some(
      (c) => c.name === "Codex analysis" && c.status === "not_run",
    ),
  );
  const pdf = await readFile(join(runRoot, "report.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert(pdf.length > 5000);
  for (const name of [
    "run.json",
    "findings.json",
    "profile.json",
    "metadata.json",
    "board-export.json",
    "diagnostics.json",
  ])
    assert((await readFile(join(runRoot, name))).length > 0);
});
test("cancelled audits retain explicit status and never present cancellation as a pass", async () => {
  const run = newRun(url, [devices[0]], {
    name: "Cancelled",
    categories: ["Accessibility"],
    ai: false,
    exportPdf: false,
  });
  const control = new AbortController();
  control.abort();
  await performAudit(run, join(root, "cancelled"), { signal: control.signal });
  assert.equal(run.status, "cancelled");
  assert.equal(run.screenshots.length, 0);
  assert.match(run.error, /partial findings|cancelled/i);
});
test("Miro export operation ledger prevents duplicates when retrying completed operations", async () => {
  const dest = join(root, "miro");
  await mkdir(dest);
  const run = {
    id: "run",
    devices: [devices[0]],
    screenshots: [],
    findings: [],
  };
  let calls = 0;
  const transport = async () => ({ id: `object-${++calls}` });
  await exportToMiro(dest, run, "test-board", { transport });
  await exportToMiro(dest, run, "test-board", { transport });
  assert.equal(calls, 1);
});
test("Miro uncertain network outcomes stop retries instead of creating duplicate objects", async () => {
  const dest = join(root, "miro-uncertain");
  await mkdir(dest);
  const run = {
    id: "run",
    devices: [devices[0]],
    screenshots: [],
    findings: [],
  };
  let calls = 0;
  const transport = async () => {
    calls++;
    throw new Error("Connection reset after upload");
  };
  await assert.rejects(
    () => exportToMiro(dest, run, "test-board", { transport }),
    /Connection reset/,
  );
  await assert.rejects(
    () => exportToMiro(dest, run, "test-board", { transport }),
    /uncertain result/,
  );
  assert.equal(calls, 1);
});
