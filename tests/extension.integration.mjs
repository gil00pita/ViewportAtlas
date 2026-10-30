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
      '<!doctype html><html lang="en"><head><title>Extension fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:1200px;display:flow-root}p{position:absolute;left:20px;top:120px;width:100px;height:50px;margin:0}#density{position:absolute;left:150px;top:120px;width:40px;height:40px;background:red}@media(min-resolution:2dppx){#density{background:lime}}</style></head><body><h1>Extension fixture</h1><a href="/next?query=ok#hash">Next page</a><p data-sensitive>Private field</p><div id="density"></div></body></html>',
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
      assert.equal(info.width, view.device.width * 2);
      assert.equal(info.height, view.device.height * 2);
    }
    // Echo the real captures at the native transport seam; rendering is real Chrome.
    await worker.evaluate(() => {
      chrome.runtime.connectNative = () => {
        let receive;
        return {
          onMessage: { addListener: (listener) => { receive = listener; } },
          onDisconnect: { addListener: () => {} },
          postMessage: (message) => receive({
            id: message.id,
            data: { snapshots: message.body.snapshots },
          }),
        };
      };
    });
    for (const fullPage of [false, true]) {
      const captured = await call("/capture", "POST", { devices, fullPage, ai: fullPage, includePageCode: true });
      assert(!captured.error, captured.error);
      for (const shot of captured.data.snapshots) {
        const device = devices.find((d) => d.id === shot.deviceId);
        const buffer = Buffer.from(shot.png, "base64");
        const info = await sharp(buffer).metadata();
        assert.equal(shot.conditions.deviceScaleFactor, 2);
        if (fullPage) {
          assert(shot.pageCode.html.includes("Extension fixture"));
          assert(shot.pageCode.css.includes("min-resolution: 2dppx"));
          assert(!shot.pageCode.html.includes("Private field"));
        } else assert.equal(shot.pageCode, undefined, "Code must not be collected with AI disabled");
        assert.equal(shot.width, device.width);
        assert.equal(shot.height, fullPage ? 1200 : device.height);
        assert.equal(info.width, device.width * 2);
        assert.equal(info.height, shot.height * 2);
        const pixel = (left, top) => sharp(buffer)
          .extract({ left, top, width: 1, height: 1 })
          .removeAlpha().raw().toBuffer();
        assert.deepEqual([...(await pixel(60, 260))], [52, 78, 80]);
        assert.deepEqual([...(await pixel(320, 260))], [0, 255, 0]);
      }
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
