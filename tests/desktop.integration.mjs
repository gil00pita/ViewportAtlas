import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { _electron } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

let electron, window, server, root, url, views;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function until(read, expected, message = "Condition did not settle") {
  const end = Date.now() + 10000;
  let actual;
  while (Date.now() < end) {
    actual = await read();
    if (typeof expected === "function" ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected)) return actual;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.fail(`${message}: ${JSON.stringify(actual)}`);
}
async function launch() {
  const executablePath = process.env.ATLAS_DESKTOP_EXECUTABLE;
  electron = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [resolve("desktop/entry.cjs")],
    env: { ...env, ATLAS_DESKTOP_STATE_DIR: join(root, "state") }, timeout: 30000 });
  window = await electron.firstWindow();
  await window.waitForFunction(() => window.atlasDesktop);
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.views.length === 3 && !state.busy && state.views.every((view) => view.status === "ready"), "Desktop did not load");
  await until(() => window.locator(".desktop-device-status").allTextContents(), (statuses) => statuses.length === 3 && statuses.every((status) => status === "Ready to follow"), "Workspace UI did not finish loading");
  assert.equal(await window.locator(".desktop-message").getAttribute("role"), "status", "Workspace displayed a startup error");
  views = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
    .filter((view) => view.webContents && view.webContents.getURL().startsWith("atlas://example"))
    .map((view) => view.webContents.id));
  assert.equal(views.length, 3);
}
async function inspect(id, expression) {
  return electron.evaluate(({ webContents }, { id, expression }) => webContents.fromId(id).executeJavaScript(expression), { id, expression });
}
async function values(selector = 'input[name="name"]') {
  return Promise.all(views.map((id) => inspect(id, `document.querySelector(${JSON.stringify(selector)})?.value`)));
}
async function click(id, selector) {
  await electron.evaluate(({ BrowserWindow, app }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
  await until(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), true, "App window did not activate");
  await electron.evaluate(async ({ webContents, BrowserWindow }, { id, selector }) => {
    const wc = webContents.fromId(id);
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents?.id === id);
    const point = await wc.executeJavaScript(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: innerWidth }; })()`);
    wc.focus();
    const scale = view.getBounds().width / point.width;
    for (const type of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type, x: Math.round(point.x * scale), y: Math.round(point.y * scale), button: "left", clickCount: 1 });
  }, { id, selector });
}
async function insert(id, text) {
  await electron.evaluate(async ({ webContents }, { id, text }) => { await webContents.fromId(id).insertText(text); }, { id, text });
}
before(async () => {
  root = await mkdtemp(join(tmpdir(), "atlas-desktop-"));
  const bundle = await build({ entryPoints: ["tests/fixtures/desktop-controlled.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/sign-in") res.setHeader("Set-Cookie", "atlas_login=persisted; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/");
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desktop fixture</title><style>body{margin:12px}input,textarea{display:block;margin:8px 0 16px;min-height:32px;max-width:90%}#private{color:red}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}`;
  await launch();
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  await until(() => values(), ["", "", ""]);
}, { timeout: 60000 });
after(async () => {
  await electron?.close();
  await new Promise((done) => server?.close(done));
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("live browser views retain exact CSS dimensions and isolated privileges", async () => {
  const metrics = await Promise.all(views.map((id) => inspect(id, '({width:innerWidth,height:innerHeight,density:devicePixelRatio,node:typeof require,bridge:typeof window.atlasDesktop})')));
  assert.deepEqual(metrics.map((m) => [m.width, m.height, m.density]), [[393, 852, 2], [820, 1180, 2], [1440, 900, 2]]);
  assert(metrics.every((m) => m.node === "undefined" && m.bridge === "undefined"));
  assert.deepEqual(await Promise.all(views.map((id) => inspect(id, 'document.querySelector("input[name=name]").id'))), ["name-mobile", "name-wide", "name-wide"]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.navigate("file:///etc/passwd")), /HTTP and HTTPS/);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.layout([{ id: "phone", x: -1, y: 0, width: 20, height: 20 }])), /layout/);
});

test("clicking a field and native text entry synchronize React state without stealing source focus", async () => {
  await click(views[0], 'input[name="name"]');
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.activeElement?.name'))), ["name", "name", "name"], "Field focus was not mirrored");
  await insert(views[0], "Hello");
  await until(() => values(), ["Hello", "Hello", "Hello"], "Native typing was not mirrored");
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.querySelector("#name-state").textContent'))), ["Hello", "Hello", "Hello"], "Controlled React state was not updated");
  assert.equal(await electron.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id), views[0]);
  await insert(views[0], " world");
  await until(() => values(), ["Hello world", "Hello world", "Hello world"]);
});

test("resizing the workspace fits every live view without changing responsive breakpoints", async () => {
  const original = await electron.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0];
    const original = owner.getContentSize();
    owner.setContentSize(1100, 760);
    return original;
  });
  try {
    await until(() => window.evaluate(() => {
      const slots = [...document.querySelectorAll("[data-browser-slot]")].map((slot) => slot.getBoundingClientRect());
      return slots.every((slot) => slot.bottom <= innerHeight - 60) && document.documentElement.scrollHeight <= innerHeight;
    }), true, "Browser views overflowed the app window");
    assert.deepEqual(await Promise.all(views.map((id) => inspect(id, "innerWidth"))), [393, 820, 1440]);
    assert.equal(await window.locator(".desktop-message").getAttribute("role"), "status");
  } finally {
    await electron.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), original);
    await until(() => window.evaluate(() => innerWidth), original[0]);
  }
});

test("selection replacement, deletion, Unicode, and switching source preserve field values", async () => {
  await inspect(views[0], 'document.querySelector("input[name=name]").setSelectionRange(6, 11)');
  await insert(views[0], "世界 🌿");
  await until(() => values(), ["Hello 世界 🌿", "Hello 世界 🌿", "Hello 世界 🌿"]);
  await click(views[2], 'input[name="name"]');
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.source === "desktop");
  await inspect(views[2], 'document.querySelector("input[name=name]").setSelectionRange(0, 5)');
  await insert(views[2], "Hi");
  await until(() => values(), ["Hi 世界 🌿", "Hi 世界 🌿", "Hi 世界 🌿"]);
  await electron.evaluate(({ webContents }, id) => {
    const wc = webContents.fromId(id);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
  }, views[2]);
  await until(() => values(), ["H 世界 🌿", "H 世界 🌿", "H 世界 🌿"]);
});

test("textarea input and ordinary UI clicks follow across responsive screens", async () => {
  await click(views[1], "#notes");
  await insert(views[1], "First line\nPasted text: café");
  await until(() => values("#notes"), Array(3).fill("First line\nPasted text: café"));
  await click(views[0], "summary");
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.querySelector("details").open'))), [true, true, true]);
});

test("masked 2× viewport screenshots and a real PDF export through the desktop interface", async () => {
  await electron.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  const result = await window.evaluate(() => window.atlasDesktop.capture());
  assert(result?.runId);
  const run = JSON.parse(await readFile(join(result.root, "run.json"), "utf8"));
  assert.equal(run.status, "completed");
  assert(run.checks.some((check) => check.name === "Automated and AI checks" && check.status === "not_run"));
  for (let index = 0; index < 3; index++) {
    const screenshot = run.screenshots[index];
    const file = join(result.root, "screenshots", `${screenshot.deviceId}.png`);
    const info = await sharp(file).metadata();
    assert.equal(info.width, screenshot.width * 2);
    assert.equal(info.height, screenshot.height * 2);
    const rect = await inspect(views[index], '(() => {const r=document.querySelector("[data-sensitive]").getBoundingClientRect(); return {x:r.x,y:r.y};})()');
    const { data } = await sharp(file).extract({ left: Math.ceil(rect.x * 2) + 4, top: Math.ceil(rect.y * 2) + 4, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data], [52, 78, 80], "Private region was not masked");
    assert.equal(await inspect(views[index], 'document.querySelector("[data-atlas-capture-mask]")'), null);
    assert.equal(await inspect(views[index], 'getComputedStyle(document.querySelector("[data-sensitive]")).visibility'), "visible", "Capture did not restore the private region");
    assert.equal(await inspect(views[index], 'getComputedStyle(document.querySelector("[data-sensitive] input")).visibility'), "visible", "Nested masks did not restore the field");
  }
  const pdf = await readFile(join(result.root, "report.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert(pdf.length > 10000);
  assert.equal(await inspect(views[2], "innerWidth"), 1440, "Capture changed responsive layout");
});

test("consequential clicks run once and visibly pause synchronization", async () => {
  await click(views[0], "#purchase");
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.paused && Boolean(state.problem));
  assert.deepEqual(await Promise.all(views.map((id) => inspect(id, 'Number(document.body.dataset.purchases || 0)'))), [1, 0, 0]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.pause(false)), /Reload views/);
});

test("ambiguous counterparts stop synchronization and a fresh reload recovers", async () => {
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  await until(() => values(), ["", "", ""]);
  await inspect(views[1], '(() => { const input=document.querySelector("input[name=name]"); input.removeAttribute("id"); const duplicate=input.cloneNode(); input.after(duplicate); })()');
  await click(views[0], 'input[name="name"]');
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.paused && state.problem.includes("More than one"));
  await assert.rejects(window.evaluate(() => window.atlasDesktop.capture()), /Resume synchronization|Reload views/);
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  const recovered = await window.evaluate(() => window.atlasDesktop.state());
  assert.equal(recovered.paused, false);
  assert.equal(recovered.problem, "");
});

test("editing while paused requires recovery instead of silently resuming divergent views", async () => {
  await window.evaluate(() => window.atlasDesktop.pause(true));
  await click(views[0], 'input[name="name"]');
  await insert(views[0], "Independent");
  await until(() => values(), ["Independent", "", ""]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.pause(false)), /Reload views/);
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
});

test("persistent website authentication survives app restart", async () => {
  await window.evaluate((url) => window.atlasDesktop.navigate(url), `${url}/sign-in`);
  const cookie = await electron.evaluate(async ({ session }, url) => (await session.fromPartition("persist:atlas-review").cookies.get({ url }))[0], url);
  assert.equal(cookie.value, "persisted");
  await electron.close();
  await launch();
  const restored = await electron.evaluate(async ({ session }, url) => (await session.fromPartition("persist:atlas-review").cookies.get({ url }))[0], url);
  assert.equal(restored.value, "persisted");
});
