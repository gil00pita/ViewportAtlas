import { chromium } from "playwright";
import { browserEvidence } from "./interaction.mjs";
import { validateUrl, validateDevices } from "./core.mjs";
import { CAPTURE_SCALE } from "./capture-settings.mjs";
let browser;
let context;
const views = new Map();
let lastSource = "";
let lastSync = {};
let mutedUntil = 0;
export async function getBrowser() {
  if (!browser?.isConnected()) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      deviceScaleFactor: CAPTURE_SCALE,
      serviceWorkers: "block",
    });
    await context.route(/^(file|chrome|devtools):/, (route) => route.abort());
  }
  return context;
}
export function getView(id) {
  const view = views.get(id);
  if (!view)
    throw new Error(
      "This view has disconnected. Reload the workspace to reconnect.",
    );
  return view;
}
export async function createViews(url, devices) {
  validateUrl(url);
  validateDevices(devices);
  const ctx = await getBrowser();
  for (const v of views.values()) await v.page.close().catch(() => {});
  views.clear();
  return Promise.all(
    devices.map(async (device) => {
      const page = await ctx.newPage();
      await page.setViewportSize({
        width: device.width,
        height: device.height,
      });
      const v = { id: device.id, device, page, outOfSync: "", error: "" };
      views.set(v.id, v);
      page.on("framenavigated", async (frame) => {
        if (
          frame !== page.mainFrame() ||
          v.id !== lastSource ||
          !lastSync.navigation ||
          Date.now() < mutedUntil
        )
          return;
        mutedUntil = Date.now() + 15000;
        try {
          const destination = validateUrl(page.url());
          for (const other of views.values())
            if (other.id !== v.id && other.page.url() !== destination)
              await other.page.goto(destination, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
              });
        } catch {
          v.outOfSync = "Delayed navigation could not be synchronized.";
        } finally {
          mutedUntil = Date.now() + 500;
        }
      });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.evaluate(() =>
          Promise.race([
            document.fonts.ready,
            new Promise((r) => setTimeout(r, 2000)),
          ]),
        );
      } catch (e) {
        v.error = e.message.split("\n")[0];
      }
      return serialize(v);
    }),
  );
}
export async function serialize(v) {
  return {
    id: v.id,
    device: v.device,
    url: v.page.url(),
    title: await v.page.title().catch(() => ""),
    error: v.error,
    outOfSync: v.outOfSync,
  };
}
export async function listViews() {
  return Promise.all([...views.values()].map(serialize));
}
export async function preview(id) {
  const v = getView(id);
  return v.page.screenshot({
    type: "jpeg",
    quality: 82,
    timeout: 10000,
    animations: "disabled",
    mask: [
      v.page.locator(
        'input[type="password"],input[autocomplete*="cc-"],[data-sensitive]',
      ),
    ],
    maskColor: "#334d50",
  });
}
export async function interact(id, action, sync) {
  const source = getView(id);
  lastSource = id;
  lastSync = sync;
  mutedUntil = Date.now() + 10000;
  const followers = [...views.values()].filter((v) => v.id !== id);
  const previous = source.page.url();
  let descriptor;
  if (action.type === "click") {
    descriptor = await source.page.evaluate(browserEvidence, {
      type: "describe",
      x: action.x,
      y: action.y,
    });
    await source.page.mouse.click(action.x, action.y, { timeout: 5000 });
    await source.page.waitForTimeout(300);
    if (
      sync.clicks &&
      (descriptor?.role !== "link" || sync.navigation) &&
      descriptor &&
      !descriptor.risky &&
      !descriptor.sensitive
    ) {
      for (const v of followers) {
        try {
          const result = await v.page.evaluate(browserEvidence, {
            type: "match",
            descriptor,
          });
          v.outOfSync = result.ok ? "" : result.reason;
        } catch {
          v.outOfSync = "Page changed before the action could be matched.";
        }
      }
    }
  } else if (action.type === "scroll") {
    await source.page.mouse.wheel(
      0,
      Math.max(-2000, Math.min(2000, action.deltaY)),
    );
    await source.page.waitForTimeout(100);
    if (sync.scrolling) {
      const position = await source.page.evaluate(browserEvidence, {
        type: "scroll-info",
      });
      await Promise.all(
        followers.map((v) =>
          v.page.evaluate(browserEvidence, { type: "scroll-to", ...position }),
        ),
      );
    }
  } else if (action.type === "input") {
    const result = await source.page.evaluate(browserEvidence, action);
    if (!result.ok) throw new Error(result.reason);
    if (sync.forms) {
      for (const v of followers) {
        const r = await v.page.evaluate(browserEvidence, {
          type: "match",
          descriptor: result.descriptor,
        });
        if (r.ok) await v.page.evaluate(browserEvidence, action);
        else v.outOfSync = r.reason;
      }
    }
  } else if (action.type === "navigate") {
    await source.page.goto(validateUrl(action.url), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } else if (action.type === "back")
    await source.page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
  else if (action.type === "forward")
    await source.page.goForward({
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  else if (action.type === "reload")
    await source.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  else if (action.type === "resync") {
    await source.page.goto(validateUrl(action.url), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    source.outOfSync = "";
  }
  if (sync.navigation && source.page.url() !== previous) {
    await Promise.all(
      followers.map(async (v) => {
        if (v.page.url() !== source.page.url()) {
          try {
            await v.page.goto(validateUrl(source.page.url()), {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            v.outOfSync = "";
          } catch (e) {
            v.outOfSync = e.message.split("\n")[0];
          }
        }
      }),
    );
  }
  mutedUntil = Date.now() + 700;
  return listViews();
}
export async function closeBrowser() {
  await browser?.close();
  views.clear();
  browser = undefined;
}
export { views };
