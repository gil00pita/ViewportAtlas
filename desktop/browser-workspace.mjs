import { WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
import { browserEvidence } from "../companion/interaction.mjs";
import { validateUrl } from "../companion/core.mjs";
import { installRecorder } from "./recorder.mjs";
import { DEVICES, EXAMPLE_URL } from "./constants.mjs";

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
  }

  state() {
    return { url: this.url, paused: this.paused, problem: this.problem, source: this.source, busy: this.busy || this.initializing,
      sequence: this.sequence, views: (this.initializing ? [] : [...this.views.values()]).map((v) => ({
        device: v.device, status: v.status, detail: v.detail, acknowledged: v.acknowledged,
      })) };
  }

  publish() { if (!this.closed && !this.initializing) this.changed(this.state()); }

  async create() {
    for (const device of DEVICES) {
      const view = new WebContentsView({ webPreferences: {
        session: this.session, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, backgroundThrottling: false,
      } });
      view.setBackgroundColor("#FFFFFF");
      this.window.contentView.addChildView(view);
      const entry = { view, device, status: "loading", detail: "Opening page…", acknowledged: 0,
        context: null, binding: `atlas_${randomUUID().replaceAll("-", "")}`, scale: 1, bounds: null };
      this.views.set(device.id, entry);
      const wc = view.webContents;
      wc.setWindowOpenHandler(() => {
        this.interrupt(entry, "Opening another window is not supported in this first desktop milestone.");
        return { action: "deny" };
      });
      wc.on("will-navigate", (event, url) => {
        try { reviewUrl(url); } catch { event.preventDefault(); this.interrupt(entry, "This page tried to open an unsupported address."); }
      });
      wc.on("will-redirect", (event, url) => {
        try { reviewUrl(url); } catch { event.preventDefault(); this.interrupt(entry, "This redirect uses an unsupported address."); }
      });
      wc.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { entry.context = null; entry.status = "loading"; this.publish(); }
      });
      wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3) this.interrupt(entry, `Page could not load: ${description}`);
      });
      wc.on("did-finish-load", () => {
        if (this.closed || !wc.debugger.isAttached()) return;
        this.emulate(entry).then(() => {
          if (this.closed) return;
          if (entry.status !== "out-of-sync") { entry.status = "ready"; entry.detail = "Ready for interaction"; }
          this.publish();
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
    this.problem = reason;
    this.paused = true;
    this.publish();
  }

  receive(source, payload) {
    if (this.busy || typeof payload !== "string" || payload.length > 20000) return;
    let action;
    try { action = JSON.parse(payload); } catch { return; }
    if (!["focus", "edit", "click", "blocked"].includes(action.type)) return;
    if (this.paused) {
      if (!this.problem) this.interrupt(source, "Views were used independently while paused. Reload views to restart synchronization.");
      return;
    }
    if (action.type === "blocked") { this.interrupt(source, String(action.reason || "This interaction needs manual preparation.").slice(0, 240)); return; }
    if (!action.target || typeof action.target !== "object" || action.target.sensitive || action.target.risky) return;
    if (action.type === "edit" && (typeof action.value !== "string" || action.value.length > 4000)) return;
    const generation = this.generation;
    const sequence = ++this.sequence;
    this.source = source.device.id;
    this.queue = this.queue.then(async () => {
      if (this.paused || this.generation !== generation) return;
      for (const follower of this.views.values()) {
        if (follower === source) continue;
        follower.status = "applying";
        this.publish();
        try {
          const result = await this.evaluate(follower, { ...action, descriptor: action.target, type: action.type === "click" ? "match" : action.type });
          if (!result?.ok) { this.interrupt(follower, result?.reason || "The matching control could not be prepared."); return; }
          follower.acknowledged = sequence;
          follower.status = "ready";
          follower.detail = "Following your interactions";
        } catch {
          this.interrupt(follower, "The page changed before its control could be matched. Reload views to restart.");
          return;
        }
      }
      source.acknowledged = sequence;
      source.status = "ready";
      source.detail = "Interaction source";
      this.publish();
    }).catch(() => this.interrupt(source, "Synchronization stopped. Reload views to restart."));
  }

  async evaluate(entry, action) {
    if (!entry.context) throw new Error("The page is not ready for interaction.");
    const response = await entry.view.webContents.debugger.sendCommand("Runtime.evaluate", {
      contextId: entry.context,
      expression: `(async () => {
        const state = globalThis.__atlasSync;
        if (state) state.applying = true;
        try { return (${browserEvidence})(${JSON.stringify(action)}); }
        finally { await new Promise(resolve => setTimeout(resolve, 0)); if (state) state.applying = false; }
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error("Page evaluation failed.");
    return response.result.value;
  }

  async navigate(url) {
    if (this.initializing) throw new Error("Wait for the browser workspace to finish opening.");
    const destination = reviewUrl(url);
    this.generation++;
    await this.queue;
    this.url = destination;
    this.problem = "";
    this.paused = false;
    this.source = "";
    this.busy = true;
    this.publish();
    try {
      await Promise.all([...this.views.values()].map(async (entry) => {
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

  async layout(slots) {
    if (!Array.isArray(slots) || slots.length !== DEVICES.length) throw new Error("Invalid browser view layout.");
    const [width, height] = this.window.getContentSize();
    const ids = new Set();
    for (const slot of slots) {
      const entry = this.views.get(slot.id);
      if (!entry || ids.has(slot.id) || ![slot.x, slot.y, slot.width, slot.height].every(Number.isFinite) ||
        slot.width < 1 || slot.height < 1 || slot.x < 0 || slot.y < 0 || slot.x + slot.width > width + 2 || slot.y + slot.height > height + 2)
        throw new Error("Browser views must fit inside the workspace.");
      ids.add(slot.id);
    }
    for (const slot of slots) {
      const entry = this.views.get(slot.id);
      entry.scale = Math.min(slot.width / entry.device.width, slot.height / entry.device.height, 1);
      entry.bounds = { x: Math.round(slot.x), y: Math.round(slot.y),
        width: Math.max(1, Math.round(entry.device.width * entry.scale)), height: Math.max(1, Math.round(entry.device.height * entry.scale)) };
      entry.view.setBounds(entry.bounds);
      if (!this.busy && !this.initializing) await this.emulate(entry);
    }
  }

  emulate(entry, scale = entry.scale) {
    return entry.view.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
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
    for (const entry of this.views.values()) entry.view.setVisible(visible);
  }
  close() {
    this.closed = true;
    this.generation++;
    for (const entry of this.views.values()) if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    this.views.clear();
  }
}
