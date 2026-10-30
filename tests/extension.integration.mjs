import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
test("packaged Manifest V3 extension creates real CDP viewports and forwards source interactions", async () => {
  await access("dist/extension/manifest.json");
  const profile = await mkdtemp(join(tmpdir(), "atlas-extension-"));
  const extension = resolve("dist/extension");
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "DENY");
    res.end(
      '<!doctype html><html lang="en"><head><title>Extension fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Extension fixture</h1><a href="/next?query=ok#hash">Next page</a><p data-sensitive>Private field</p></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/index.html`);
    const call = (path, method = "GET", body) =>
      page.evaluate(
        async ({ path, method, body }) =>
          chrome.runtime.sendMessage({ type: "api", path, method, body }),
        { path, method, body },
      );
    const devices = [
      { id: "mobile", name: "Mobile", width: 393, height: 852, mobile: true },
      {
        id: "desktop",
        name: "Desktop",
        width: 1440,
        height: 900,
        mobile: false,
      },
    ];
    const created = await call("/views", "POST", {
      url: `http://127.0.0.1:${server.address().port}`,
      devices,
    });
    assert(!created.error, created.error);
    assert.equal(created.data.length, 2);
    for (const view of created.data) {
      assert(!view.error, view.error);
      assert.match(view.image, /^data:image\/jpeg;base64,/);
      const info = await sharp(
        Buffer.from(view.image.split(",")[1], "base64"),
      ).metadata();
      assert.equal(info.width, view.device.width);
      assert.equal(info.height, view.device.height);
    }
    const navigated = await call("/views/mobile/action", "POST", {
      action: {
        type: "navigate",
        url: `http://127.0.0.1:${server.address().port}/next?query=ok#hash`,
      },
      sync: { navigation: true, clicks: true, scrolling: true, forms: false },
    });
    assert(!navigated.error, navigated.error);
    for (const v of navigated.data)
      assert(v.url.endsWith("/next?query=ok#hash"));
  } finally {
    await context?.close();
    await new Promise((r) => server.close(r));
    await rm(profile, { recursive: true, force: true });
  }
});
