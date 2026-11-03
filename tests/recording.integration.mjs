import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";

test("recording survives iframe updates, idle waits, sidebar closure, reloads, and cross-site navigation", { timeout: 65000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-recording-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html lang="en"><head><title>Recording navigation fixture</title></head><body><h1>Recording fixture</h1><button type="button" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\',\'true\')">Open details</button></body></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let context;
  try {
    context = await chromium.launchPersistentContext(root, {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${resolve("dist/extension")}`, `--load-extension=${resolve("dist/extension")}`],
    });
    context.setDefaultTimeout(5000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const url = `http://127.0.0.1:${server.address().port}/`;
    const source = await context.newPage();
    await source.goto(url);
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.storage.local.set({ currentUrl: url, currentTabId: tab.id });
      globalThis.recordingFrameEvents = [];
      chrome.debugger.onEvent.addListener((source, method, params) => {
        if (method === "Page.navigatedWithinDocument") globalThis.recordingFrameEvents.push(params.url);
      });
      chrome.runtime.connectNative = () => {
        let receive;
        return {
          onMessage: { addListener: (callback) => { receive = callback; } }, onDisconnect: { addListener: () => {} },
          postMessage: (message) => receive({ id: message.id, data: message.path === "/health" ?
            { connected: true, codex: { installed: false, authenticated: false }, browser: true, platform: "darwin", outputFolder: "/tmp/recording-fixture" } : [] }),
        };
      };
    }, url);
    let panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const call = (path, method = "GET", body) => panel.evaluate(async (args) => {
      const response = await chrome.runtime.sendMessage({ type: "api", ...args });
      if (response.error) throw new Error(response.error);
      return response.data;
    }, { path, method, body });
    await call("/flows/record", "POST", {});
    const original = await call("/flows");
    assert(original.recording);
    await source.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "about:blank";
      document.body.appendChild(frame);
    });
    await source.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.readyState === "complete");
    await source.frames()[1].evaluate(() => { location.hash = "embedded-state"; });
    const deadline = Date.now() + 3000;
    let sawFrameEvent = false;
    while (Date.now() < deadline) {
      sawFrameEvent = await worker.evaluate(() => globalThis.recordingFrameEvents.some((url) => url.endsWith("#embedded-state")));
      if (sawFrameEvent) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert(sawFrameEvent, "The regression must exercise a real child-frame navigation event");
    await source.getByRole("button", { name: "Open details" }).click();
    let recordedClick = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await call("/flows");
      assert(state.recording, state.plans[0].error || "Recording disconnected after an iframe navigation");
      if (state.plans[0].steps.some((step) => step.type === "click")) { recordedClick = true; break; }
      await new Promise((done) => setTimeout(done, 30));
    }
    assert(recordedClick, "Top-frame clicks must still be recorded after the iframe changes");
    await call("/flows/checkpoint", "POST", { label: "After embedded update" });
    const state = await call("/flows");
    assert(state.plans[0].steps.every((step) => step.url.startsWith(url)), "Embedded URLs must never become replay destinations");
    assert.equal(state.recording.planId, original.recording.planId);
    await panel.close();
    // No sidebar polling or user actions during this wait. Exercise real elapsed
    // time beyond Chrome's normal 30-second worker-idle threshold.
    await new Promise((done) => setTimeout(done, 35000));
    await source.evaluate(() => history.pushState({}, "", "#main-state"));
    await source.reload();
    await source.getByRole("button", { name: "Open details" }).click();
    panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    let resumed;
    for (let attempt = 0; attempt < 50; attempt++) {
      resumed = await call("/flows");
      assert(resumed.recording, resumed.plans[0].error || "Recording disconnected after reopening the sidebar");
      if (resumed.plans[0].steps.filter((step) => step.type === "click").length === 2) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.equal(resumed.recording.planId, original.recording.planId);
    assert.equal(resumed.plans[0].steps.filter((step) => step.type === "click").length, 2);
    assert(resumed.plans[0].steps.some((step) => step.type === "navigate" && step.url === `${url}#main-state`), "Main-frame SPA navigation must still be recorded");
    await call("/flows/checkpoint", "POST", { label: "After reload and reopen" });
    const crossSiteUrl = url.replace("127.0.0.1", "localhost");
    await source.goto(crossSiteUrl);
    await source.getByRole("button", { name: "Open details" }).click();
    for (let attempt = 0; attempt < 50; attempt++) {
      resumed = await call("/flows");
      assert(resumed.recording, resumed.plans[0].error || "Recording disconnected after cross-site navigation");
      if (resumed.plans[0].steps.filter((step) => step.type === "click").length === 3) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.equal(resumed.plans[0].steps.filter((step) => step.type === "click").length, 3);
    assert(resumed.plans[0].steps.some((step) => step.type === "navigate" && step.url === crossSiteUrl));
    assert.equal(resumed.recording.planId, original.recording.planId);
    // Closing the actual debugged tab exercises Chrome's onDetach callback.
    await source.close();
    let detached;
    for (let attempt = 0; attempt < 50; attempt++) {
      detached = await call("/flows");
      if (!detached.recording) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.equal(detached.recording, null);
    assert.equal(detached.plans[0].interruption.reason, "target_closed");
    assert.match(detached.plans[0].error, /closed/i);
    assert.equal(detached.plans[0].id, original.recording.planId);
    await panel.bringToFront();
    await panel.getByRole("button", { name: "User flow", exact: true }).click();
    await panel.getByRole("button", { name: "Resume recording", exact: true }).waitFor();
    await mkdir(".context", { recursive: true });
    for (const width of [400, 320]) {
      await panel.setViewportSize({ width, height: 900 });
      assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await panel.screenshot({ path: `.context/recording-recovery-${width}.png` });
    }
    const replacement = await context.newPage();
    await replacement.goto(crossSiteUrl);
    await worker.evaluate(async (url) => {
      const targets = await chrome.debugger.getTargets();
      const tab = targets.find((target) => target.url === url);
      await chrome.storage.local.set({ currentTabId: tab.tabId });
      // Update the existing controller's in-memory source using its public API.
    }, crossSiteUrl);
    await replacement.bringToFront();
    await call("/current-tab", "POST", {});
    await panel.getByRole("button", { name: "Resume recording", exact: true }).click();
    await panel.getByText("Recording your website tab", { exact: true }).waitFor();
    const continued = await call("/flows");
    assert.equal(continued.recording.planId, original.recording.planId);
    assert.equal(continued.plans.length, 1, "Resume must append to the saved plan");
    assert.equal(continued.plans[0].interruption, undefined);
    assert(continued.plans[0].steps.some((step) => step.type === "blocked" && /gap/i.test(step.label)));
    await replacement.getByRole("button", { name: "Open details" }).click();
    for (let attempt = 0; attempt < 50; attempt++) {
      resumed = await call("/flows");
      if (resumed.plans[0].steps.filter((step) => step.type === "click").length === 4) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.equal(resumed.plans[0].steps.filter((step) => step.type === "click").length, 4);
    await call("/flows/stop", "POST", {});
  } finally {
    await context?.close();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
