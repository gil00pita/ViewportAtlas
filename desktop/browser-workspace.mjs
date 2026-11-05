import { WebContentsView, screen } from "electron";
import { randomUUID } from "node:crypto";
import { browserEvidence } from "../companion/interaction.mjs";
import { validateUrl } from "../companion/core.mjs";
import { installRecorder } from "./recorder.mjs";
import { DEVICES, EXAMPLE_URL } from "./constants.mjs";
import { pageCommand } from "./cdp.mjs";
import { mappedPreparation } from "./mappings.mjs";

const WORLD = "viewport-atlas-sync";
export function reviewUrl(value) {
  return value === EXAMPLE_URL ? value : validateUrl(value);
}

export class BrowserWorkspace {
  constructor(window, websiteSession, changed) {
    this.window = window;
    this.session = websiteSession;
    this.changed = changed;
    this.views = new Map();
    this.url = EXAMPLE_URL;
    this.paused = false;
    this.problem = "";
    this.source = "";
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.busy = false;
    this.generation = 0;
    this.initializing = true;
    this.pending = 0;
    this.mappings = [];
    this.masks = "";
    this.excluded = new Set();
    this.latencies = [];
    this.pendingSources = new Map();
    this.popups = new Set();
  }

  state() {
    return { url: this.url, paused: this.paused, problem: this.problem, source: this.source, busy: this.busy || this.initializing || Boolean(this.flowReplaying),
      sequence: this.sequence, pending: this.pending, latency: this.latency(), mappings: this.mappings, download: this.pendingDownload ? { filename: this.pendingDownload.filename, armed: Boolean(this.pendingDownload.destination) } : null, popup: this.pendingPopup ? { host: new URL(this.pendingPopup).host, armed: Boolean(this.allowPopupOrigin) } : null, testOrigin: this.testOrigin || "", canRetry: Boolean(this.failure), views: (this.initializing ? [] : [...this.views.values()]).map((v) => ({
        device: v.device, status: v.status, detail: v.detail, acknowledged: v.acknowledged, excluded: this.excluded.has(v.device.id),
      })) };
  }

  publish() { if (!this.closed && !this.initializing) this.changed(this.state()); }
  latency() {
    const values = [...this.latencies].sort((a,b) => a-b);
    return { samples: values.length, p95: values.length ? values[Math.ceil(values.length * .95) - 1] : 0 };
  }

  async create(devices = DEVICES) {
    for (const device of devices) {
      const view = new WebContentsView({ webPreferences: {
        session: this.session, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, backgroundThrottling: false,
      } });
      view.setBackgroundColor("#FFFFFF");
      this.window.contentView.addChildView(view);
      const entry = { view, device, status: "loading", detail: "Opening page…", acknowledged: 0,
        context: null, generation: 0, navigationRevision: 0, binding: `atlas_${randomUUID().replaceAll("-", "")}`, scale: 1, bounds: null };
      this.views.set(device.id, entry);
      const wc = view.webContents;
      wc.setWindowOpenHandler(({ url }) => {
        try { reviewUrl(url); } catch { this.interrupt(entry, "This window requested an unsupported address."); return { action: "deny" }; }
        if (this.allowPopupOrigin === new URL(url).origin && this.popups.size < 1) {
          this.allowPopupOrigin = null; this.pendingPopup = null;
          return { action: "allow", overrideBrowserWindowOptions: { parent: this.window, width: 720, height: 820,
            webPreferences: { session: this.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } };
        }
        this.pendingPopup = url;
        this.interrupt(entry, "A page requested another window. Allow it once from the workspace, then repeat the window link. Other views stay paused during sign-in.");
        return { action: "deny" };
      });
      wc.on("did-create-window", popup => {
        this.popups.add(popup);
        popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        for (const event of ["will-navigate", "will-redirect"]) popup.webContents.on(event, (navigation, url) => { try { reviewUrl(url); } catch { navigation.preventDefault(); } });
        popup.on("closed", () => { this.popups.delete(popup); this.publish(); });
        this.publish();
      });
      wc.on("will-navigate", (event, url) => {
        try { reviewUrl(url); } catch { event.preventDefault(); this.interrupt(entry, "This page tried to open an unsupported address."); }
      });
      wc.on("will-redirect", (event, url) => {
        try { reviewUrl(url); } catch { event.preventDefault(); this.interrupt(entry, "This redirect uses an unsupported address."); }
      });
      wc.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && (this.busy || entry.delivering || this.initializing)) entry.followingNavigation = true;
        if (mainFrame) entry.navigationRevision++;
        if (mainFrame && !inPlace) { entry.context = null; entry.generation++; entry.status = "loading"; this.publish(); }
      });
      const navigated = (url, inPlace) => {
        entry.navigationRevision++;
        const following = entry.followingNavigation;
        entry.followingNavigation = false;
        if (this.closed || this.busy || entry.delivering || this.initializing || following) return;
        this.receive(entry, JSON.stringify({ type: "navigate", url, inPlace }));
      };
      wc.on("did-navigate", (_event, url) => navigated(url, false));
      wc.on("did-navigate-in-page", (_event, url, mainFrame) => { if (mainFrame) navigated(url, true); });
      wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
        if (mainFrame) entry.followingNavigation = false;
        if (mainFrame && code !== -3) this.interrupt(entry, `Page could not load: ${description}`);
      });
      wc.on("did-finish-load", () => {
        if (this.closed || !wc.debugger.isAttached()) return;
        this.emulate(entry).then(async () => {
          if (this.closed) return;
          if (!entry.context) await this.restoreWorld(entry);
          if (entry.status !== "out-of-sync") { entry.status = "ready"; entry.detail = "Ready for interaction"; }
          this.publish();
          await this.run(entry, `if (globalThis.__atlasSync) { globalThis.__atlasSync.masks = ${JSON.stringify(this.masks)}; globalThis.__atlasSync.testOrigin = ${JSON.stringify(this.testOrigin || "")}; }`);
        }).catch(() => this.interrupt(entry, "Viewport emulation disconnected. Reload the application to reconnect."));
      });
      wc.on("render-process-gone", () => this.interrupt(entry, "This browser view stopped. Reload views to reconnect."));
      // A new native view has no renderer target until its first navigation.
      await wc.loadURL("about:blank");
      wc.debugger.attach("1.3");
      wc.debugger.on("detach", () => this.interrupt(entry, "Browser instrumentation disconnected. Reload the application to reconnect."));
      wc.debugger.on("message", (_event, method, params) => {
        if (method === "Page.frameNavigated" && !params.frame.parentId) entry.mainFrame = params.frame.id;
        if (method === "Runtime.executionContextCreated" && params.context.name === WORLD && params.context.auxData?.frameId === entry.mainFrame)
          entry.context = params.context.id;
        if (method === "Runtime.executionContextsCleared") entry.context = null;
        if (method === "Runtime.bindingCalled" && params.name === entry.binding && params.executionContextId === entry.context)
          this.receive(entry, params.payload);
      });
      await wc.debugger.sendCommand("Runtime.enable");
      await wc.debugger.sendCommand("Page.enable");
      await wc.debugger.sendCommand("Runtime.addBinding", { name: entry.binding, executionContextName: WORLD });
      await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        worldName: WORLD,
        source: `(${installRecorder})(${browserEvidence}, ${JSON.stringify(entry.binding)})`,
      });
      await this.emulate(entry);
    }
    this.initializing = false;
    this.publish();
  }

  interrupt(entry, reason) {
    if (this.closed) return;
    entry.status = "out-of-sync";
    entry.detail = reason;
    if (this.excluded.has(entry.device.id)) { this.publish(); return; }
    this.problem = reason;
    this.paused = true;
    this.onInterrupt?.(reason);
    this.publish();
  }

  receive(source, payload) {
    if (this.busy || this.flowReplaying || source.delivering || this.excluded.has(source.device.id) || typeof payload !== "string" || payload.length > 20000) return;
    let action;
    try { action = JSON.parse(payload); } catch { return; }
    if (!["focus", "blur", "edit", "control", "click", "double-click", "scroll", "key", "hover", "drag", "navigate", "blocked"].includes(action.type)) return;
    // Losing focus in an old view is not a new interaction source.
    if (action.type === "blur" && source.device.id !== this.source) return;
    if (this.paused) {
      if ((action.type === "edit" && !action.selectionOnly) || ["control", "navigate"].includes(action.type)) this.failure = null;
      if (!this.problem) this.interrupt(source, "Views were used independently while paused. Reload views to restart synchronization.");
      return;
    }
    if (action.type === "blocked") { this.interrupt(source, String(action.reason || "This interaction needs manual preparation.").slice(0, 240)); return; }
    if (!["scroll", "key", "navigate"].includes(action.type) && (!action.target || typeof action.target !== "object" || action.target.sensitive || action.target.risky)) return;
    if (action.type === "scroll" && (![action.ratio, action.xRatio].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || typeof action.selector !== "string" || action.selector.length > 500)) return;
    if (action.type === "key" && action.key !== "Escape") return;
    if (action.type === "navigate") {
      try { reviewUrl(action.url); } catch { this.interrupt(source, "This navigation uses an unsupported address."); return; }
      this.url = action.url;
    }
    if (action.type === "edit" && (typeof action.value !== "string" || action.value.length > 4000)) return;
    const critical = !["hover", "scroll", "blur"].includes(action.type) && !action.selectionOnly;
    if (critical && [...this.pendingSources].some(([id, count]) => id !== source.device.id && count > 0)) {
      this.failure = null;
      this.interrupt(source, "The interaction source changed before earlier actions were acknowledged. Your source stays open; prepare the views or replay the saved journey before continuing.");
      return;
    }
    const generation = this.generation;
    const sequence = ++this.sequence;
    const started = performance.now();
    if (critical) this.pendingSources.set(source.device.id, (this.pendingSources.get(source.device.id) || 0) + 1);
    this.source = source.device.id;
    this.pending++;
    this.onAction?.({ ...action, sequence, source: source.device.id, generation: source.generation });
    this.queue = this.queue.then(async () => {
      if (this.paused || this.generation !== generation) return;
      for (const follower of this.views.values()) {
        if (this.paused || this.generation !== generation) return;
        if (action.type === "blur" && this.source !== source.device.id) break;
        if (follower === source || this.excluded.has(follower.device.id)) continue;
        follower.status = "applying";
        this.publish();
        try {
          follower.delivering = true;
          const result = await this.deliver(follower, action);
          if (!result?.ok) { this.failure = result?.ok === false ? { sequence, action } : null; this.interrupt(follower, result?.reason || "The matching control could not be prepared."); return; }
          follower.acknowledged = sequence;
          follower.status = "ready";
          follower.detail = "Following your interactions";
        } catch (error) {
          this.interrupt(follower, `Synchronization stopped: ${error.message}`);
          return;
        } finally { follower.delivering = false; }
      }
      source.acknowledged = sequence;
      source.status = "ready";
      source.detail = "Interaction source";
      if (!["navigate", "hover", "scroll"].includes(action.type)) { this.latencies.push(performance.now() - started); if (this.latencies.length > 500) this.latencies.shift(); }
      this.publish();
    }).catch(() => this.interrupt(source, "Synchronization stopped. Reload views to restart.")).finally(() => {
      this.pending--;
      if (critical) this.pendingSources.set(source.device.id, this.pendingSources.get(source.device.id) - 1);
      this.publish();
    });
  }

  async ready(entry) {
    const deadline = Date.now() + 10000;
    while (!entry.context || entry.view.webContents.isLoadingMainFrame()) {
      if (this.closed || Date.now() > deadline) throw new Error("The page was not ready within 10 seconds.");
      if (!entry.context && !entry.view.webContents.isLoadingMainFrame()) await this.restoreWorld(entry);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }

  async restoreWorld(entry) {
    const cdp = entry.view.webContents.debugger;
    const { frameTree } = await cdp.sendCommand("Page.getFrameTree");
    entry.mainFrame = frameTree.frame.id;
    const world = await cdp.sendCommand("Page.createIsolatedWorld", { frameId: entry.mainFrame, worldName: WORLD });
    entry.context = world.executionContextId;
    await this.run(entry, `(${installRecorder})(${browserEvidence}, ${JSON.stringify(entry.binding)})`);
    await this.run(entry, `globalThis.__atlasSync.applying = false; globalThis.__atlasSync.masks = ${JSON.stringify(this.masks)}; globalThis.__atlasSync.testOrigin = ${JSON.stringify(this.testOrigin || "")}`);
  }

  async waitNavigation(entry, url, trigger) {
    const revision = entry.navigationRevision;
    await trigger();
    const deadline = Date.now() + 10000;
    while (entry.navigationRevision === revision || entry.view.webContents.getURL() !== url || !entry.context || entry.view.webContents.isLoadingMainFrame()) {
      if (this.closed || Date.now() > deadline) throw new Error(`Navigation did not settle on ${entry.device.name} (address matched: ${entry.view.webContents.getURL() === url}, context ready: ${Boolean(entry.context)}, loading: ${entry.view.webContents.isLoadingMainFrame()}, navigation observed: ${entry.navigationRevision !== revision}).`);
      if (!entry.context && !entry.view.webContents.isLoadingMainFrame()) await this.restoreWorld(entry);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }

  async deliver(entry, action) {
    const wc = entry.view.webContents;
    if (action.type === "navigate") {
      await this.ready(entry);
      if (wc.getURL() !== action.url) {
        const history = wc.navigationHistory.getAllEntries(), current = wc.navigationHistory.getActiveIndex();
        const previous = history.findLastIndex((item, index) => index < current && item.url === action.url);
        const next = history.findIndex((item, index) => index > current && item.url === action.url);
        if (previous >= 0 || next >= 0) await this.waitNavigation(entry, action.url, () => wc.navigationHistory.goToIndex(previous >= 0 ? previous : next));
        else if (action.inPlace && new URL(wc.getURL()).origin === new URL(action.url).origin) {
          await this.run(entry, `(history.pushState(null, '', ${JSON.stringify(action.url)}), dispatchEvent(new PopStateEvent('popstate')), true)`);
        } else await wc.loadURL(reviewUrl(action.url));
      }
      await this.ready(entry);
      return { ok: wc.getURL() === action.url, reason: "Navigation did not reach the corresponding address." };
    }
    await this.ready(entry);
    if (action.type === "key") {
      await this.nativeInput(entry, async () => {
        await pageCommand(entry, "Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await pageCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      });
      return { ok: true };
    }
    const mapping = this.mappings.find(m => m.viewId === entry.device.id && m.source === (action.target?.testId || action.target?.id || action.target?.href));
    const request = { ...action, descriptor: action.target, selector: mapping?.selector || action.selector,
      type: ["click", "double-click"].includes(action.type) ? "match" : action.type === "hover" ? "resolve" : action.type,
      doubleClick: action.type === "double-click" };
    if (mapping?.prepare) await this.run(entry, `(${mappedPreparation})(${JSON.stringify(mapping)}, ${JSON.stringify(this.masks)}, ${browserEvidence}, true)`);
    let result = await this.evaluate(entry, request);
    if (!result?.ok && /hidden|No corresponding/.test(result?.reason || "")) {
      const prepared = await this.evaluate(entry, { ...request, type: "prepare" });
      if (prepared?.prepared) {
        entry.detail = `Opened ${prepared.prepared}`;
        const deadline = Date.now() + 3000;
        do {
          result = await this.evaluate(entry, request);
          if (result?.ok) break;
          await new Promise(resolve => setTimeout(resolve, 30));
        } while (Date.now() < deadline);
      }
    }
    if (action.type === "hover" && result?.ok) await this.nativeInput(entry, () => wc.sendInputEvent({ type: "mouseMove", x: Math.round(result.x * entry.scale), y: Math.round(result.y * entry.scale) }));
    return result;
  }

  async nativeInput(entry, apply) {
    await this.run(entry, 'globalThis.__atlasSync.applying = true');
    try { await apply(); }
    finally {
      // Native input acknowledgements can precede trusted DOM events.
      await this.run(entry, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { globalThis.__atlasSync.applying = false; resolve(); })))');
    }
  }

  async run(entry, expression) {
    const response = await pageCommand(entry, "Runtime.evaluate", { contextId: entry.context, expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || "The page could not apply this action.");
    return response.result.value;
  }

  async setMasks(masks) {
    this.masks = masks;
    const entries = [...this.views.values()].filter(entry => entry.context);
    try {
      await Promise.all(entries.map(entry => this.run(entry, `document.querySelectorAll(${JSON.stringify(masks || ':root')}).length`)));
      await Promise.all(entries.map(entry => this.run(entry, `globalThis.__atlasSync.masks = ${JSON.stringify(masks)}`)));
    } catch (error) {
      if (entries[0]) this.interrupt(entries[0], "Privacy masks could not be applied. Correct the active profile's selectors in Audit settings, then reload views before continuing.");
      throw error;
    }
  }

  async setTestOrigin(origin) {
    if (origin !== "") {
      const target = new URL(reviewUrl(origin));
      if (target.origin !== new URL(this.url).origin) throw new Error("Choose the exact origin of the currently open test environment.");
      origin = target.origin;
    }
    this.testOrigin = origin;
    await Promise.all([...this.views.values()].filter(entry => entry.context).map(entry => this.run(entry, `globalThis.__atlasSync.testOrigin = ${JSON.stringify(origin)}`)));
    this.publish();
  }

  allowPopup() {
    if (!this.pendingPopup) throw new Error("No supported popup is waiting for approval.");
    this.allowPopupOrigin = new URL(this.pendingPopup).origin;
    this.problem = "The next popup from this host is allowed once. Repeat the website's window link, finish sign-in, then reload the views.";
    this.publish();
  }

  async retry() {
    await this.queue;
    if (!this.failure) throw new Error("This interruption has no safely retryable action. Reload or replay the saved journey.");
    const { action, sequence } = this.failure;
    const results = await Promise.allSettled([...this.views.values()].filter(entry => entry.device.id !== this.source && !this.excluded.has(entry.device.id) && entry.acknowledged < sequence).map(async entry => {
      entry.delivering = true;
      try {
        const result = await this.deliver(entry, action);
        if (!result?.ok) throw new Error(result?.reason || "The counterpart is still unavailable.");
        entry.acknowledged = sequence;
      } finally { entry.delivering = false; }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    this.failure = null; this.paused = false; this.problem = "";
    const source = this.views.get(this.source); if (source) source.acknowledged = sequence;
    for (const entry of this.views.values()) { entry.status = "ready"; entry.detail = "Recovered after manual preparation"; }
    this.publish(); return this.state();
  }

  async exclude(id, excluded) {
    if (!this.views.has(id) || typeof excluded !== "boolean") throw new Error("Choose an open viewport to exclude.");
    await this.queue;
    if (excluded) {
      if (this.views.size - this.excluded.size <= 1 && !this.excluded.has(id)) throw new Error("Keep at least one synchronized viewport.");
      this.excluded.add(id);
      if (this.failure) await this.retry();
    } else {
      this.excluded.delete(id);
      await this.navigate(this.url);
    }
    this.publish();
  }

  async evaluate(entry, action) {
    if (!entry.context) throw new Error("The page is not ready for interaction.");
    const response = await pageCommand(entry, "Runtime.evaluate", {
      contextId: entry.context,
      expression: `(async () => {
        const state = globalThis.__atlasSync;
        if (state) state.applying = true;
        try { if (state) state.masks = ${JSON.stringify(this.masks)}; return (${browserEvidence})(${JSON.stringify({ ...action, desktop: true, masks: this.masks, testMode: Boolean(this.testOrigin) && new URL(entry.view.webContents.getURL()).origin === this.testOrigin })}); }
        finally { await new Promise(resolve => setTimeout(resolve, 0)); if (state) state.applying = false; }
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error("Page evaluation failed.");
    return response.result.value;
  }

  async navigate(url, selectedIds) {
    if (this.initializing) throw new Error("Wait for the browser workspace to finish opening.");
    const destination = reviewUrl(url);
    this.generation++;
    await this.queue;
    this.url = destination;
    this.problem = "";
    this.failure = null;
    this.pendingPopup = null; this.allowPopupOrigin = null;
    this.pendingDownload = null; this.downloadPermit = null;
    this.paused = false;
    this.source = "";
    this.busy = true;
    this.publish();
    try {
      await Promise.all([...this.views.values()].filter(entry => !selectedIds || selectedIds.has(entry.device.id)).map(async (entry) => {
        entry.status = "loading";
        entry.detail = "Opening page…";
        try {
          await this.emulate(entry);
          await entry.view.webContents.loadURL(destination);
          await this.emulate(entry);
          entry.status = "ready";
          entry.detail = "Ready for interaction";
        } catch (error) { this.interrupt(entry, `Page could not load: ${error.message}`); }
      }));
    } finally { this.busy = false; this.publish(); }
    return this.state();
  }

  async history(command) {
    if (!["back", "forward", "reload"].includes(command)) throw new Error("Invalid browser history command.");
    await this.queue;
    this.busy = true; this.publish();
    try {
      const source = (this.views.get(this.source) || [...this.views.values()][0]).view.webContents;
      const sourceHistory = source.navigationHistory.getAllEntries(), sourceIndex = source.navigationHistory.getActiveIndex();
      const target = command === "reload" ? source.getURL() : sourceHistory[sourceIndex + (command === "back" ? -1 : 1)]?.url;
      if (!target) throw new Error("The source has no corresponding history entry.");
      await Promise.all([...this.views.values()].map(async entry => {
        const wc = entry.view.webContents;
        const current = wc.navigationHistory.getActiveIndex(), history = wc.navigationHistory.getAllEntries();
        const index = command === "back" ? history.findLastIndex((item, i) => i < current && item.url === target) : history.findIndex((item, i) => i > current && item.url === target);
        if (command !== "reload" && index < 0) throw new Error("A viewport has no corresponding history entry.");
        await this.waitNavigation(entry, target, () => {
          if (command === "reload") wc.reload();
          else wc.navigationHistory.goToIndex(index);
        });
      }));
      const urls = [...this.views.values()].map(entry => entry.view.webContents.getURL());
      if (!urls.every(url => url === urls[0])) throw new Error("Viewports reached different history entries. Prepare them before resuming.");
      this.url = urls[0];
    } catch (error) { this.interrupt([...this.views.values()][0], error.message); throw error; }
    finally { this.busy = false; this.publish(); }
    return this.state();
  }

  async layout(slots) {
    if (!Array.isArray(slots) || slots.length !== this.views.size) throw new Error("Invalid browser view layout.");
    const [width, height] = this.window.getContentSize();
    const ids = new Set();
    for (const slot of slots) {
      const entry = this.views.get(slot.id);
      if (!entry || ids.has(slot.id) || ![slot.x, slot.y, slot.width, slot.height].every(Number.isFinite) ||
        slot.width < 1 || slot.height < 1 || slot.x < 0 || slot.y < 0 || slot.x + slot.width > width + 2 || slot.y + slot.height > height + 2)
        { this.setVisible(false); throw new Error("Browser views must fit inside the workspace."); }
      ids.add(slot.id);
    }
    for (const slot of slots) {
      const entry = this.views.get(slot.id);
      entry.scale = Math.min(slot.width / entry.device.width, slot.height / entry.device.height, 1);
      entry.bounds = { x: Math.round(slot.x), y: Math.round(slot.y),
        width: Math.max(1, Math.round(entry.device.width * entry.scale)), height: Math.max(1, Math.round(entry.device.height * entry.scale)) };
      entry.view.setBounds(this.captureBounds(entry));
      if (!this.busy && !this.initializing) await this.emulate(entry);
    }
    this.setVisible(true);
  }

  emulate(entry, scale = entry.scale) {
    return pageCommand(entry, "Emulation.setDeviceMetricsOverride", {
      width: entry.device.width, height: entry.device.height, screenWidth: entry.device.width,
      screenHeight: entry.device.height, deviceScaleFactor: 2, mobile: false, scale,
    });
  }

  setPaused(paused) {
    if (typeof paused !== "boolean") throw new Error("Invalid synchronization state.");
    if (!paused && this.problem) throw new Error("Reload views to restart after a mismatch. Unsaved page state will be lost.");
    this.paused = paused;
    this.publish();
    return this.state();
  }

  setVisible(visible) {
    if (this.closed) return;
    const [width, height] = this.window.isDestroyed() ? [0, 0] : this.window.getContentSize();
    for (const entry of this.views.values()) {
      const bounds = entry.bounds;
      const fits = bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 2 && bounds.y + bounds.height <= height + 2;
      // Hidden native views can stop submitting screenshot surfaces.
      // Keep it painting outside the clipped content area only during capture.
      const painting = this.capturing && bounds;
      if (bounds) entry.view.setBounds(this.captureBounds(entry));
      entry.view.setVisible(Boolean(painting || (visible && this.presentationVisible !== false && !this.capturing && fits)));
    }
  }
  captureBounds(entry) {
    if (!this.capturing) return entry.bounds;
    // Match the screenshot's 2× pixels in native display units, including 1× displays.
    const density = screen.getDisplayMatching(this.window.getBounds()).scaleFactor;
    const width = Math.ceil(entry.device.width * 2 / density), height = Math.ceil(entry.device.height * 2 / density);
    return { ...entry.bounds, x: -width - 20, width, height };
  }
  setPresentation(visible) {
    if (typeof visible !== "boolean") throw new Error("Invalid browser presentation state.");
    this.presentationVisible = visible;
    this.setVisible(visible);
  }
  close() {
    this.closed = true;
    this.generation++;
    for (const popup of this.popups) if (!popup.isDestroyed()) popup.destroy();
    for (const entry of this.views.values()) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(entry.view);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    }
    this.views.clear();
  }
}
