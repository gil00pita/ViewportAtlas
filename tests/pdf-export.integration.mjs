import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { newRun } from "../companion/core.mjs";

test("packaged extension previews and downloads PDFs through the protected companion", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-pdf-export-"));
  let context, child;
  try {
    context = await chromium.launchPersistentContext(join(root, "chrome"), {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${resolve("dist/extension")}`,
        `--load-extension=${resolve("dist/extension")}`,
      ],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const state = join(root, "state"), output = join(root, "run");
    await mkdir(state);
    await mkdir(output);
    const run = newRun("https://example.com/", [
      { id: "desktop", name: "Desktop", width: 400, height: 320, mobile: false },
    ], {
      id: "pdf-test", name: "PDF regression fixture", categories: ["SEO"],
      devices: ["desktop"], prompt: "", ai: false, exportPdf: false,
    });
    run.status = "completed";
    run.title = "PDF export regression fixture";
    // A deterministic 2x PNG makes the PDF larger than native messaging's 1MB response limit.
    const pixels = Buffer.alloc(800 * 640 * 3);
    let seed = 123456;
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    await mkdir(join(output, "screenshots"));
    await sharp(pixels, { raw: { width: 800, height: 640, channels: 3 } })
      .png().toFile(join(output, "screenshots/desktop.png"));
    run.screenshots = [{ deviceId: "desktop", path: `/evidence/${run.id}/screenshots/desktop.png`, width: 400, height: 320, deviceScaleFactor: 2, truncated: false }];
    await writeFile(join(output, "run.json"), JSON.stringify(run));
    await writeFile(join(state, "runs.json"), JSON.stringify({ [run.id]: output }));
    await writeFile(join(state, "extension-id"), id);
    const portServer = createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    const start = async () => {
      if (!child || child.exitCode !== null) child = spawn(process.execPath, [resolve("companion/server.mjs")], {
        env: { ...process.env, ATLAS_PORT: String(port), ATLAS_STATE_DIR: state, ATLAS_OUTPUT_DIR: output },
        stdio: "ignore",
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Companion did not start");
    };
    const stop = async () => {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    };
    await start();
    let failPdf = false;
    // Preserve browser request headers while using an isolated real companion.
    await context.route("http://127.0.0.1:4318/**", async (route) => {
      const url = new URL(route.request().url());
      if (failPdf) return route.fulfill({ status: 500, json: { error: "PDF generation failed in the regression fixture." } });
      try {
        const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
        await route.fulfill({ response });
      } catch {
        await route.fulfill({ status: 503, json: { error: "Companion is stopped." } });
      }
    });
    let nativeHealthRequests = 0;
    worker.on("console", async (message) => {
      if (!message.text().startsWith("pdf-test-health:")) return;
      const id = message.text().slice("pdf-test-health:".length);
      nativeHealthRequests++;
      await start();
      await worker.evaluate((id) => globalThis.pdfHealthReplies[id](), id);
    });
    // Only native JSON transport is stubbed; the PDF HTTP route and browser are real.
    await worker.evaluate((run) => {
      globalThis.pdfHealthReplies = {};
      chrome.runtime.connectNative = () => {
        let receive;
        return {
          onMessage: { addListener: (listener) => { receive = listener; } },
          onDisconnect: { addListener: () => {} },
          postMessage: ({ id, path }) => {
            if (path === "/health") {
              globalThis.pdfHealthReplies[id] = () => {
                receive({ id, data: { connected: true, browser: true, codex: { installed: true, authenticated: true }, miro: false } });
                delete globalThis.pdfHealthReplies[id];
              };
              console.log(`pdf-test-health:${id}`);
            } else receive({ id, data: path === "/runs" ? [run] : run });
          },
        };
      };
    }, run);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/index.html`);
    await page.getByRole("button", { name: "Audit history", exact: true }).click();
    await page.getByRole("button", { name: "View report", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const initialHealthRequests = nativeHealthRequests;
    await stop();
    const response = context.waitForEvent("response", { predicate: (r) => r.url().includes("/report.pdf"), timeout: 5000 });
    const popup = page.waitForEvent("popup");
    await page.getByText("Preview PDF", { exact: true }).click();
    assert.equal((await response).status(), 200, "Extension PDF preview request must be authorized");
    const preview = await popup;
    await preview.waitForURL(/^blob:/, { timeout: 5000 });
    assert(nativeHealthRequests > initialHealthRequests, "Preview must reconnect a stopped companion");
    await preview.close();
    await stop();
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
    await page.getByText("PDF report", { exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `Viewport-Atlas-${run.id}.pdf`);
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert(bytes.length > 1_000_000);
    assert.equal(await download.failure(), null);
    failPdf = true;
    const failedPopup = page.waitForEvent("popup");
    await page.getByText("Preview PDF", { exact: true }).click();
    const failedPreview = await failedPopup;
    await page.getByText("PDF generation failed in the regression fixture.", { exact: true }).waitFor();
    assert(failedPreview.isClosed(), "A failed preview must close its temporary tab");
    await page.evaluate(() => { window.open = () => null; });
    await page.getByText("Preview PDF", { exact: true }).click();
    await page.getByText("Allow pop-ups for Viewport Atlas to preview the PDF, or download the report instead.", { exact: true }).waitFor();
    failPdf = false;
    const blockedPopupDownload = page.waitForEvent("download", { timeout: 5000 });
    await page.getByText("PDF report", { exact: true }).click();
    assert.equal(await (await blockedPopupDownload).failure(), null);
    const standalone = await context.newPage();
    await standalone.goto(base);
    await standalone.getByRole("button", { name: "Audit history", exact: true }).click();
    await standalone.getByRole("button", { name: "View report", exact: true }).click();
    await standalone.getByRole("button", { name: "Export", exact: true }).click();
    const standaloneDownload = standalone.waitForEvent("download", { timeout: 5000 });
    await standalone.getByText("PDF report", { exact: true }).click();
    const standalonePdf = await standaloneDownload;
    assert.equal((await readFile(await standalonePdf.path())).subarray(0, 5).toString(), "%PDF-");
    // Untrusted navigation remains blocked after fixing extension exports.
    const rejected = await fetch(`${base}/api/runs/${run.id}/report.pdf`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(rejected.status, 403);
  } finally {
    await context?.close();
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
