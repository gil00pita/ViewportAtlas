import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { newRun } from "../companion/core.mjs";

test("audit sidebar defers device tabs, captures the selected page, and expands the same run", async () => {
  const profile = await mkdtemp(join(tmpdir(), "atlas-sidebar-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html lang="en"><head><title>Sidebar test page</title></head><body><h1>Sidebar test page</h1><p>Real browser evidence</p></body></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: { width: 400, height: 1000 },
      args: [`--disable-extensions-except=${resolve("dist/extension")}`, `--load-extension=${resolve("dist/extension")}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
    const id = new URL(worker.url()).host;
    assert.equal((await worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick, true);
    const url = `http://127.0.0.1:${server.address().port}/`;
    const fixture = newRun(url, [], {});
    // Only the native transport is a fixture; CDP view creation and capture are real.
    await worker.evaluate(({ url, fixture }) => {
      globalThis.sidebarTest = { captures: [], run: null, healthError: false, complete: false };
      chrome.storage.local.set({ currentUrl: url });
      chrome.runtime.connectNative = () => {
        let receive;
        return {
          onMessage: { addListener: (listener) => { receive = listener; } },
          onDisconnect: { addListener: () => {} },
          postMessage: (message) => {
            const state = globalThis.sidebarTest;
            if (message.path === "/health" && state.healthError) {
              receive({ id: message.id, error: "Test companion is disconnected." });
              return;
            }
            let data;
            if (message.path === "/health") data = { connected: true, browser: true, codex: { installed: false, authenticated: false }, platform: "darwin", outputFolder: "/tmp/sidebar-test", miro: false };
            else if (message.path === "/runs" && message.method === "POST") {
              state.captures = message.body.snapshots;
              state.run = { ...fixture, url: message.body.url, devices: message.body.devices, profile: message.body.profile, progress: "Checking the selected page…" };
              data = state.run;
            } else if (message.path === "/runs") data = state.run ? [state.run] : [];
            else if (message.path.startsWith("/runs/")) data = { ...state.run, status: state.complete ? "completed" : "running" };
            receive({ id: message.id, data });
          },
        };
      };
    }, { url, fixture });
    const source = await context.newPage();
    await source.goto(url);
    const tabsBeforePanel = (await worker.evaluate(() => chrome.tabs.query({}))).length;
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const panelUrl = `chrome-extension://${id}/sidepanel.html`;
    await page.goto(panelUrl);
    const audit = page.getByRole("button", { name: "Run audit", exact: true });
    await audit.waitFor().catch(async (error) => {
      throw new Error(`${error.message}\n${await page.locator("body").innerText()}\n${errors.join("\n")}`);
    });
    await page.waitForFunction(() => !document.querySelector(".run-audit").disabled).catch(async (error) => {
      throw new Error(`${error.message}\n${await page.locator("body").innerText()}\n${errors.join("\n")}`);
    });
    assert.equal(await page.locator(".device-canvas").count(), 0);
    assert.equal((await worker.evaluate(() => chrome.tabs.query({}))).length, tabsBeforePanel + 1);
    assert.equal(await page.locator(".extension-target span").textContent(), url);
    await mkdir(".context", { recursive: true });
    await page.screenshot({ path: ".context/audit-sidebar.png" });
    for (const width of [320, 400]) {
      await page.setViewportSize({ width, height: 720 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
      assert(await audit.isVisible());
    }
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await page.screenshot({ path: ".context/audit-sidebar-dark.png" });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    // Exercise saved profile settings through the real controls.
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await page.getByRole("button", { name: "SEO", exact: true }).click();
    await page.getByRole("button", { name: "Tablet", exact: true }).click();
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await audit.click();
    await page.getByText("Checking the selected page…", { exact: true }).waitFor({ timeout: 60000 });
    assert(await page.getByRole("button", { name: "Use current tab" }).isDisabled());
    const captures = await worker.evaluate(() => globalThis.sidebarTest.captures.map((shot) => ({ deviceId: shot.deviceId, png: shot.png.slice(0, 10), title: shot.metadata.title })));
    assert.equal(captures.length, 1);
    assert.equal(captures[0].deviceId, "iphone-15");
    assert.equal(captures[0].title, "Sidebar test page");
    assert(captures[0].png.startsWith("iVBOR"));
    // Closing/reopening the panel restores and continues polling the running audit.
    await page.reload();
    await page.getByText("Checking the selected page…", { exact: true }).waitFor();
    await worker.evaluate(() => { globalThis.sidebarTest.complete = true; });
    await page.locator(".run-status.completed").waitFor();
    const expanded = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open full workspace", exact: true }).first().click();
    const workspace = await expanded;
    await workspace.waitForURL(`**/index.html?*run=${fixture.id}*`);
    assert.equal(new URL(workspace.url()).searchParams.get("url"), url);
    await workspace.locator(".run-status.completed").waitFor();
    await workspace.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await workspace.locator(".app-header").count(), 1);
    assert.equal(await workspace.locator(".sidebar").count(), 1);
    await workspace.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await workspace.screenshot({ path: ".context/audit-full-workspace.png" });
    assert.equal(new URL(workspace.url()).searchParams.get("panel"), null);
    // A new toolbar target updates the existing panel without remounting it.
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: "audit-target", url: "chrome://extensions/" }));
    await page.getByText("This page can’t be audited.", { exact: false }).waitFor();
    assert(await audit.isDisabled());
    await source.bringToFront();
    const current = await page.evaluate(() => chrome.runtime.sendMessage({ type: "api", path: "/current-tab", method: "POST" }));
    // Native toolbar toggles do not grant activeTab; resolve the active website
    // from the already-authorized debugger metadata without attaching to it.
    assert.equal(current.data.url, url);
    await source.goto(`${url}changed`);
    // A native panel can be visible alongside the active website. Simulate
    // reopening that cached document while this test hosts it in a regular tab.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => document.querySelector(".extension-target span").textContent.endsWith("/changed"));
    await page.evaluate(() => { delete document.hidden; });
    await worker.evaluate(() => { globalThis.sidebarTest.healthError = true; });
    await page.reload();
    await page.getByRole("button", { name: "Reconnect companion" }).waitFor();
    assert(await audit.isDisabled());
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    await new Promise((done) => server.close(done));
    await rm(profile, { recursive: true, force: true });
  }
});
