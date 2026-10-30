import { browserEvidence } from "./interaction.mjs";
import { CAPTURE_SCALE, MAX_HEIGHT } from "./capture-settings.mjs";
const HOST = "com.viewportatlas.companion";
let nativePort;
const pending = new Map();
const views = new Map();
let lastSource = "";
let syncOptions = {
  navigation: true,
  clicks: true,
  scrolling: true,
  forms: false,
};
let currentUrl = "";
let mutedUntil = 0;
let auditLocked = false;
const command = (tabId, method, params = {}) =>
  chrome.debugger.sendCommand({ tabId }, method, params);
async function evaluate(tabId, fn, arg) {
  const result = await command(tabId, "Runtime.evaluate", {
    expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text || "Page script failed.");
  return result.result.value;
}
function connectNative() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST);
  nativePort.onMessage.addListener((m) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.data);
  });
  nativePort.onDisconnect.addListener(() => {
    const reason =
      chrome.runtime.lastError?.message ||
      "Companion disconnected. Reinstall the native host or start npm start.";
    nativePort = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  });
  return nativePort;
}
function native(path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          "Companion timed out. Reconnect and inspect audit history for partial evidence.",
        ),
      );
    }, 240000);
    pending.set(id, { resolve, reject, timer });
    try {
      connectNative().postMessage({ id, path, method, body });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}
chrome.action.onClicked.addListener(async (tab) => {
  currentUrl = tab.url || "https://example.com";
  await chrome.storage.local.set({ currentUrl });
  await chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});
async function waitReady(tabId) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await evaluate(tabId, () => document.readyState)) === "complete")
        break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  await evaluate(tabId, () =>
    Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 2000)),
    ]),
  ).catch(() => {});
}
async function describe(v) {
  try {
    const meta = await evaluate(v.tabId, browserEvidence, { type: "metadata" });
    return {
      id: v.id,
      device: v.device,
      url: meta.url,
      title: meta.title,
      error: v.error || "",
      outOfSync: v.outOfSync || "",
      image: await preview(v),
    };
  } catch (e) {
    return {
      id: v.id,
      device: v.device,
      url: v.url,
      error: e.message,
      outOfSync: v.outOfSync || "",
    };
  }
}
async function withMask(tabId, selectors, callback) {
  const key = `atlas-mask-${crypto.randomUUID()}`;
  await evaluate(
    tabId,
    ({ selectors, key }) => {
      const elements = [...document.querySelectorAll(selectors)];
      for (const e of elements) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const overlay = document.createElement("div");
        overlay.dataset.atlasMask = key;
        Object.assign(overlay.style, {
          position: "absolute",
          top: `${r.y + scrollY}px`,
          left: `${r.x + scrollX}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          background: "#344e50",
          zIndex: "2147483647",
          pointerEvents: "none",
        });
        document.documentElement.appendChild(overlay);
      }
    },
    { selectors, key },
  );
  try {
    return await callback();
  } finally {
    await evaluate(
      tabId,
      (key) =>
        document
          .querySelectorAll(`[data-atlas-mask="${key}"]`)
          .forEach((e) => e.remove()),
      key,
    ).catch(() => {});
  }
}
const masks =
  'input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]';
async function preview(v) {
  return withMask(v.tabId, masks, async () => {
    const r = await command(v.tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 78,
      captureBeyondViewport: false,
    });
    return `data:image/jpeg;base64,${r.data}`;
  });
}
async function createViews(url, devices) {
  if (auditLocked) throw new Error("Wait for the active audit to finish.");
  if (
    !/^https?:\/\//.test(url) ||
    !Array.isArray(devices) ||
    !devices.length ||
    devices.length > 8
  )
    throw new Error("Choose a valid HTTP(S) page and 1–8 device views.");
  mutedUntil = Date.now() + 30000;
  for (const v of views.values()) {
    await chrome.debugger.detach({ tabId: v.tabId }).catch(() => {});
    await chrome.tabs.remove(v.tabId).catch(() => {});
  }
  views.clear();
  const items = await Promise.all(
    devices.map(async (device) => {
      const tab = await chrome.tabs.create({
        url: "about:blank",
        active: false,
      });
      const v = {
        id: device.id,
        tabId: tab.id,
        device,
        url,
        error: "",
        outOfSync: "",
      };
      views.set(v.id, v);
      try {
        await chrome.debugger.attach({ tabId: tab.id }, "1.3");
        await command(tab.id, "Page.enable");
        await command(tab.id, "Runtime.enable");
        await command(tab.id, "Emulation.setDeviceMetricsOverride", {
          width: device.width,
          height: device.height,
          deviceScaleFactor: CAPTURE_SCALE,
          mobile: device.mobile,
          screenWidth: device.width,
          screenHeight: device.height,
        });
        await command(tab.id, "Page.navigate", { url });
        await waitReady(tab.id);
      } catch (e) {
        v.error = e.message;
      }
      return describe(v);
    }),
  );
  mutedUntil = Date.now() + 500;
  return items;
}
async function navigation(tabId, url) {
  if (!/^https?:\/\//.test(url))
    throw new Error("This destination cannot be previewed. Open it in Chrome.");
  await command(tabId, "Page.navigate", { url });
  await waitReady(tabId);
}
async function action(id, action, sync) {
  const source = views.get(id);
  if (!source) throw new Error("View disconnected. Reload your workspace.");
  if (auditLocked) throw new Error("Wait for the audit before browsing.");
  lastSource = id;
  syncOptions = sync;
  mutedUntil = Date.now() + 10000;
  const followers = [...views.values()].filter((v) => v.id !== id);
  const old = await evaluate(source.tabId, () => location.href);
  try {
    if (action.type === "click") {
      const descriptor = await evaluate(source.tabId, browserEvidence, {
        type: "describe",
        x: action.x,
        y: action.y,
      });
      await command(source.tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: action.x,
        y: action.y,
        button: "left",
        clickCount: 1,
      });
      await command(source.tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: action.x,
        y: action.y,
        button: "left",
        clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 300));
      if (
        sync.clicks &&
      (descriptor?.role!=="link"||sync.navigation) &&
        descriptor &&
        !descriptor.risky &&
        !descriptor.sensitive
      ) {
        for (const v of followers) {
          try {
            const r = await evaluate(v.tabId, browserEvidence, {
              type: "match",
              descriptor,
            });
            v.outOfSync = r.ok ? "" : r.reason;
          } catch {
            v.outOfSync =
              "The page changed before the action could be matched.";
          }
        }
      }
    } else if (action.type === "scroll") {
      await command(source.tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: source.device.width / 2,
        y: source.device.height / 2,
        deltaX: 0,
        deltaY: Math.max(-2000, Math.min(2000, action.deltaY)),
      });
      await new Promise((r) => setTimeout(r, 150));
      if (sync.scrolling) {
        const position = await evaluate(source.tabId, browserEvidence, {
          type: "scroll-info",
        });
        for (const v of followers)
          await evaluate(v.tabId, browserEvidence, {
            type: "scroll-to",
            ...position,
          });
      }
    } else if (action.type === "input") {
      const result = await evaluate(source.tabId, browserEvidence, action);
      if (!result.ok) throw new Error(result.reason);
      if (sync.forms) {
        for (const v of followers) {
          const m = await evaluate(v.tabId, browserEvidence, {
            type: "match",
            descriptor: result.descriptor,
          });
          if (m.ok) await evaluate(v.tabId, browserEvidence, action);
          else v.outOfSync = m.reason;
        }
      }
    } else if (action.type === "resync") {
      await navigation(source.tabId, action.url);
      source.outOfSync = "";
    } else if (action.type === "navigate")
      await navigation(source.tabId, action.url);
    else if (action.type === "reload") {
      await command(source.tabId, "Page.reload");
      await waitReady(source.tabId);
    } else if (["back", "forward"].includes(action.type)) {
      const history = await command(source.tabId, "Page.getNavigationHistory");
      const entry =
        history.entries[
          history.currentIndex + (action.type === "back" ? -1 : 1)
        ];
      if (entry) {
        await command(source.tabId, "Page.navigateToHistoryEntry", {
          entryId: entry.id,
        });
        await waitReady(source.tabId);
      }
    }
    const url = await evaluate(source.tabId, () => location.href);
    if (sync.navigation && url !== old)
      for (const v of followers) {
        const current = await evaluate(v.tabId, () => location.href);
        if (current !== url) {
          await navigation(v.tabId, url);
          v.outOfSync = "";
        }
      }
    return await Promise.all([...views.values()].map(describe));
  } finally {
    mutedUntil = Date.now() + 700;
  }
}
let axeSource;
async function snapshots(devices, profile) {
  const results = [];
  mutedUntil = Date.now() + 60000;
  for (const d of devices) {
    const v = views.get(d.id);
    if (!v)
      throw new Error(`${d.name} disconnected. Reconnect before capture.`);
    const selectors = [masks, profile.masks].filter(Boolean).join(",");
    await evaluate(
      v.tabId,
      (selectors) => document.querySelectorAll(selectors).length,
      selectors,
    );
    const initial = await evaluate(v.tabId, () => ({ x: scrollX, y: scrollY }));
    if (profile.fullPage) {
      for (let i = 0; i < 16; i++) {
        const end = await evaluate(
          v.tabId,
          (y) => {
            scrollTo(0, y);
            return (
              scrollY + innerHeight >= document.documentElement.scrollHeight - 5
            );
          },
          i * 900,
        );
        await new Promise((r) => setTimeout(r, 90));
        if (end) break;
      }
    }
    await evaluate(v.tabId, (p) => scrollTo(p.x, p.y), initial);
    const layout = await command(v.tabId, "Page.getLayoutMetrics");
    const height = profile.fullPage
      ? Math.min(MAX_HEIGHT, Math.ceil(layout.cssContentSize.height))
      : d.height;
    const metadata = await evaluate(v.tabId, browserEvidence, {
      type: "metadata",
      masks: selectors,
    });
    const maskedText = await evaluate(
      v.tabId,
      (selectors) =>
        [...document.querySelectorAll(selectors)]
          .map((e) => e.textContent?.trim())
          .filter(Boolean),
      selectors,
    );
    for (const entry of [...metadata.headings, ...metadata.links])
      for (const text of maskedText) {
        if (entry.text?.includes(text)) entry.text = "[MASKED]";
        if (entry.name?.includes(text)) entry.name = "[MASKED]";
      }
    let axe = null;
    const bounds = {};
    if (profile.categories?.includes("Accessibility")) {
      if (!axeSource) {
        const response = await fetch(chrome.runtime.getURL("axe.min.js"));
        if (!response.ok)
          throw new Error("Bundled axe-core could not be loaded.");
        axeSource = await response.text();
      }
      await command(v.tabId, "Runtime.evaluate", { expression: axeSource });
      axe = await evaluate(
        v.tabId,
        async (selectors) => {
          const result = await window.axe.run(
            { exclude: [selectors] },
            {
              runOnly: {
                type: "tag",
                values: [
                  "wcag2a",
                  "wcag2aa",
                  "wcag21a",
                  "wcag21aa",
                  "best-practice",
                ],
              },
            },
          );
          return {
            testEngine: result.testEngine,
            violations: result.violations,
            passes: result.passes.map((x) => ({ id: x.id })),
            incomplete: result.incomplete.map((x) => ({
              id: x.id,
              help: x.help,
            })),
          };
        },
        selectors,
      );
      for (const violation of axe.violations)
        for (const node of violation.nodes.slice(0, 20)) {
          try {
            const b = await evaluate(
              v.tabId,
              (selector) => {
                const el = document.querySelector(selector);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                  x: r.x + scrollX,
                  y: r.y + scrollY,
                  width: r.width,
                  height: r.height,
                };
              },
              node.target.join(" "),
            );
            if (b && !profile.fullPage) {
              b.x -= initial.x;
              b.y -= initial.y;
            }
            bounds[node.target.join(" > ")] = b;
          } catch {}
        }
    }
    const png = await withMask(v.tabId, selectors, async () => {
      const shot = await command(v.tabId, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: profile.fullPage,
        ...(profile.fullPage
          ? { clip: { x: 0, y: 0, width: d.width, height, scale: 1 } }
          : {}),
      });
      return shot.data;
    });
    results.push({
      deviceId: d.id,
      png,
      width: d.width,
      height,
      truncated: profile.fullPage && layout.cssContentSize.height > MAX_HEIGHT,
      metadata,
      axe,
      bounds,
      conditions: {
        engine: "Chrome via chrome.debugger",
        deviceScaleFactor: CAPTURE_SCALE,
        fullPage: profile.fullPage,
        maskSelectors: selectors,
        maxHeight: MAX_HEIGHT,
        initialScroll: initial,
        initialState: metadata.state,
        capturedAt: new Date().toISOString(),
      },
    });
  }
  mutedUntil = Date.now() + 1000;
  return results;
}
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (
    !["Page.frameNavigated", "Page.navigatedWithinDocument"].includes(method) ||
    Date.now() < mutedUntil ||
    !syncOptions.navigation
  )
    return;
  const view = [...views.values()].find((v) => v.tabId === source.tabId);
  if (!view || view.id !== lastSource || params.frame?.parentId) return;
  const url = params.frame?.url || params.url;
  if (!url?.match(/^https?:\/\//)) return;
  mutedUntil = Date.now() + 15000;
  try {
    for (const v of views.values())
      if (v.id !== view.id) await navigation(v.tabId, url);
  } catch {
    view.outOfSync = "Navigation could not be synchronized.";
  } finally {
    mutedUntil = Date.now() + 500;
  }
});
chrome.debugger.onDetach.addListener((source) => {
  const v = [...views.values()].find((v) => v.tabId === source.tabId);
  if (v)
    v.error =
      "Chrome detached the debugger. Reload views to reconnect. Opening DevTools can detach the extension.";
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.type !== "api" ||
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  )
    return;
  handle(message).then(
    (data) => sendResponse({ data }),
    (e) => sendResponse({ error: e.message }),
  );
  return true;
});
async function handle({ path, method = "GET", body }) {
  if (path === "/current-tab") {
    if (!currentUrl)
      currentUrl =
        (await chrome.storage.local.get("currentUrl")).currentUrl ||
        "https://example.com";
    return { url: currentUrl };
  }
  if (path === "/views" && method === "POST")
    return createViews(body.url, body.devices);
  if (path === "/views") return Promise.all([...views.values()].map(describe));
  const match = path.match(/^\/views\/([^/]+)\/action$/);
  if (match) return action(match[1], body.action, body.sync);
  if (path === "/health") {
    const h = await native(path);
    return { ...h, extension: true };
  }
  if (path === "/runs" && method === "POST") {
    auditLocked = true;
    try {
      const evidence = await snapshots(body.devices, body.profile);
      const r = await native(path, method, { ...body, snapshots: evidence });
      return r;
    } catch (e) {
      auditLocked = false;
      throw e;
    }
  }
  if (path === "/capture" && method === "POST") {
    const shots = await snapshots(body.devices, { ...body, categories: [] });
    return native("/capture", method, { ...body, snapshots: shots });
  }
  const result = await native(path, method, body);
  if (path.match(/^\/runs\/[^/]+$/) && result.status !== "running")
    auditLocked = false;
  return result;
}
