import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";

test("recorded flow replays real UI and navigation, queues every screen before reports finish, and survives panel reload", { timeout: 120000 }, async () => {
  const profileRoot = await mkdtemp(join(tmpdir(), "atlas-flow-"));
  let missingTarget = false;
  let nextRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/next") nextRequests++;
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html lang="en"><head><title>${req.url === "/next" ? "Next screen" : "Journey start"}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
      <h1>${req.url === "/next" ? "Next screen" : "Journey start"}</h1>
      <button type="button" aria-expanded="false" aria-controls="panel" onclick="this.setAttribute('aria-expanded','true');document.getElementById('panel').hidden=false">${missingTarget ? "Open something else" : "Open details"}</button>
      <div id="panel" role="dialog" aria-label="Details" hidden><label>Name <input id="name" type="text"></label><p id="message"></p></div>
      <label>Password <input id="password" type="password" value="DO-NOT-RECORD"></label>
      <div data-sensitive><button type="button">Open private region</button></div>
      <a href="/next">Next page</a>
      <script>document.getElementById('name').addEventListener('input',e=>document.getElementById('message').textContent=e.target.value);</script>
    </body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileRoot, {
      channel: "chromium", headless: true, viewport: { width: 400, height: 1000 },
      args: [`--disable-extensions-except=${resolve("dist/extension")}`, `--load-extension=${resolve("dist/extension")}`],
    });
    context.setDefaultTimeout(15000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const url = `http://127.0.0.1:${server.address().port}/`;
    const source = await context.newPage();
    await source.goto(url);
    // Native transport fixture deliberately withholds completion until ALL
    // screens have arrived. A replay that waits per report will time out.
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.storage.local.set({ currentUrl: url, currentTabId: tab.id });
      globalThis.flowTest = { runs: [], evidence: [], cancelled: false, hold: false };
      chrome.runtime.connectNative = () => {
        let receive;
        return {
          onMessage: { addListener: (fn) => { receive = fn; } }, onDisconnect: { addListener: () => {} },
          postMessage: (message) => {
            const state = globalThis.flowTest;
            let data;
            if (message.path === "/health") data = { connected: true, browser: true, codex: { installed: false, authenticated: false }, platform: "darwin", outputFolder: "/tmp/flow-test", miro: false };
            else if (message.path === "/runs" && message.method === "POST") {
              const body = message.body;
              data = { schemaVersion: 1, id: `flow-screen-${state.runs.length + 1}`, title: body.flow.screenName, url: body.url, createdAt: new Date().toISOString(), status: "running", progress: "Analyzing saved evidence", devices: body.devices, profile: body.profile, flow: body.flow, findings: [], checks: [], screenshots: [] };
              state.runs.push(data);
              state.evidence.push(body.snapshots.map((shot) => ({ deviceId: shot.deviceId, url: shot.metadata.url, state: shot.metadata.state, png: shot.png.slice(0, 8) })));
            } else if (message.path === "/runs") data = state.runs;
            else if (message.path.endsWith("/cancel")) { state.cancelled = true; data = { cancelled: true }; }
            else if (message.path.startsWith("/runs/")) {
              const run = state.runs.find((run) => message.path === `/runs/${run.id}`);
              data = { ...run, status: state.cancelled ? "cancelled" : state.runs.length >= 3 && !state.hold ? "completed" : "running" };
            }
            receive({ id: message.id, data });
          },
        };
      };
    }, url);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    const call = (path, method = "GET", body) => page.evaluate(async (args) => {
      const response = await chrome.runtime.sendMessage({ type: "api", ...args });
      if (response.error) throw new Error(response.error);
      return response.data;
    }, { path, method, body });
    const until = async (predicate, timeout = 30000) => {
      const end = Date.now() + timeout;
      let state;
      while (Date.now() < end) {
        // Poll persisted worker progress so this also verifies execution while
        // the sidebar document is inactive or reloading.
        state = await worker.evaluate(async () => (await chrome.storage.local.get("atlasFlows")).atlasFlows);
        if (predicate(state)) return state;
        await new Promise((done) => setTimeout(done, 100));
      }
      const targets = await worker.evaluate(() => chrome.debugger.getTargets());
      throw new Error(`Flow state timed out: ${JSON.stringify(state?.job)}\nTargets: ${JSON.stringify(targets.filter((target) => target.attached))}`);
    };
    await page.getByRole("button", { name: "User flow", exact: true }).click();
    await page.getByRole("button", { name: "Record a new flow" }).click();
    await page.getByText("Recording your website tab", { exact: true }).waitFor();
    await source.getByRole("button", { name: "Open details", exact: true }).click();
    await source.getByLabel("Name", { exact: true }).fill("Example reviewer");
    await source.getByLabel("Name", { exact: true }).press("Tab");
    await until((state) => state.plans[0]?.steps.some((step) => step.type === "input"));
    await call("/flows/checkpoint", "POST", { label: "Details open" });
    await source.getByRole("link", { name: "Next page" }).click();
    await source.waitForURL(`${url}next`);
    await until((state) => state.plans[0]?.steps.some((step) => step.type === "navigate"));
    await call("/flows/checkpoint", "POST", { label: "Next screen" });
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await page.getByRole("button", { name: "Record a new flow" }).waitFor();
    const recorded = await call("/flows");
    assert.equal(recorded.plans[0].steps.filter((step) => step.type === "checkpoint").length, 3);
    assert.equal(recorded.plans[0].steps.filter((step) => step.type === "click").length, 2);
    assert(!JSON.stringify(recorded).includes("DO-NOT-RECORD"));
    await page.bringToFront();
    await mkdir(".context", { recursive: true });
    await page.screenshot({ path: ".context/flow-planner.png" });
    await page.setViewportSize({ width: 320, height: 720 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await page.screenshot({ path: ".context/flow-planner-dark.png" });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    const devices = [
      { id: "mobile", name: "Mobile", width: 393, height: 852, mobile: true },
      { id: "desktop", name: "Desktop", width: 1280, height: 800, mobile: false },
    ];
    const profile = { id: "flow-test", name: "Flow test", categories: ["SEO"], devices: devices.map((d) => d.id), ai: false, prompt: "", masks: "[data-sensitive]", fullPage: false, exportPdf: false, outputFolder: "" };
    // A previously used workspace source must not mirror replay navigation a
    // second time; replay owns and advances each device independently.
    await call("/views", "POST", { url, devices });
    await call("/views/desktop/action", "POST", { action: { type: "scroll", deltaY: 1 }, sync: { navigation: true, clicks: true, scrolling: true, forms: false } });
    await call("/flows/run", "POST", { devices, profile });
    await page.reload();
    await page.bringToFront();
    const done = await until((state) => {
      if (state.job?.status === "failed") throw new Error(state.job.error);
      return state.job?.status === "completed";
    }, 60000);
    assert.equal(done.job.screens.length, 3, JSON.stringify(done));
    assert(done.job.screens.every((screen) => screen.status === "completed"));
    const evidence = await worker.evaluate(() => globalThis.flowTest.evidence);
    assert.equal(evidence.length, 3);
    assert(evidence.every((screen) => screen.length === 2 && screen.every((shot) => shot.png.startsWith("iVBOR"))));
    assert(evidence[1].every((shot) => shot.url === url));
    assert(evidence[2].every((shot) => shot.url === `${url}next`));
    assert.equal(nextRequests, 3, "One recording navigation and exactly one replay navigation per device");
    await page.setViewportSize({ width: 400, height: 1000 });
    await page.getByText("3 screen reports ready", { exact: true }).waitFor();
    await page.locator(".flow-job").scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.screenshot({ path: ".context/flow-results.png" });
    // A missing target stops replay and retains any previously queued report.
    missingTarget = true;
    await call("/flows/run", "POST", { devices: devices.slice(0, 1), profile });
    const failed = await until((state) => state.job?.status === "failed");
    assert.match(failed.job.error, /Mobile.*step.*open details/i);
    assert.equal(failed.job.screens.length, 1);
    assert.equal(failed.job.screens[0].status, "completed");
    // Cancellation is tested on another run of the saved plan.
    missingTarget = false;
    await call("/flows/run", "POST", { devices: devices.slice(0, 1), profile });
    await call("/flows/cancel", "POST", {});
    await until((state) => state.job?.status === "cancelled");
    // Private interactions are visible as unresolved steps, without their data.
    await call("/flows/record", "POST", { masks: "[data-sensitive]" });
    await source.getByRole("button", { name: "Open private region" }).click();
    await source.getByLabel("Password", { exact: true }).fill("ANOTHER-PRIVATE-VALUE");
    await source.getByLabel("Password", { exact: true }).press("Tab");
    await until((state) => state.plans[0].steps.some((step) => step.type === "blocked"));
    await call("/flows/stop", "POST", {});
    const privatePlan = await call("/flows");
    assert(!JSON.stringify(privatePlan).includes("DO-NOT-RECORD"));
    assert(!JSON.stringify(privatePlan).includes("ANOTHER-PRIVATE-VALUE"));
    await assert.rejects(call("/flows/run", "POST", { devices, profile }), /manual review/);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    await new Promise((done) => server.close(done));
    await rm(profileRoot, { recursive: true, force: true });
  }
});
