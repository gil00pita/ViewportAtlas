import { join, isAbsolute } from "node:path";
import { readFile, copyFile, writeFile } from "node:fs/promises";
import { newRun, redactUrl, validateDevices, validateProfile, safePath, exportFileName } from "../companion/core.mjs";
import { performAudit, saveRun } from "../companion/audit.mjs";
import { validateFinding } from "../companion/schema.mjs";
import { codexStatus } from "../companion/codex.mjs";
import { generatePdf } from "../companion/pdf.mjs";
import { listBoards, exportToMiro } from "../companion/miro.mjs";
import { captureAuditDevice } from "./audit-capture.mjs";

// Only trusted workspace operations enter here. The browser adapter stays in main.
export class ReviewWorkspace {
  constructor({ store, browser, outputFolder, dialog, shell, window, configure, exclusive }) {
    Object.assign(this, { store, browser, outputFolder, dialog, shell, window, configure, exclusive });
    this.active = null;
    this.exports = new Set();
  }
  async start(devices, profile, { flow } = {}) {
    if (this.active) throw new Error("Wait for the current audit or cancel it before starting another.");
    validateDevices(devices);
    validateProfile(profile);
    const browser = this.browser();
    await browser.queue;
    if (browser.busy || browser.paused || browser.problem || [...browser.views.values()].some(v => !browser.excluded?.has(v.device.id) && v.status !== "ready")) throw new Error("Resume synchronization and wait for every view before auditing.");
    if (devices.some(d => {
      if (browser.excluded?.has(d.id)) return true;
      const current = browser.views.get(d.id)?.device;
      return !current || current.width !== d.width || current.height !== d.height;
    })) throw new Error("Return to the live workspace to open your selected devices before auditing.");
    const destination = profile.outputFolder || this.outputFolder;
    if (typeof destination !== "string" || !isAbsolute(destination)) throw new Error("Choose an absolute output folder.");
    const run = newRun(redactUrl(browser.url), structuredClone(devices), structuredClone(profile));
    if (flow) run.flow = flow;
    const root = join(destination, run.id);
    run.outputFolder = root;
    const controller = new AbortController();
    const active = { run, controller, done: null };
    this.active = active;
    browser.busy = true;
    browser.capturing = true;
    browser.setVisible(false);
    browser.publish();
    try {
      active.registering = this.store.register(run, root);
      await active.registering;
    } catch (error) {
      this.active = null;
      browser.busy = false; browser.capturing = false; browser.setVisible(true); browser.publish();
      throw error;
    }
    const previous = this.store.history().find(r => r.id !== run.id && r.status === "completed" && r.url === run.url &&
      !r.checks.some(c => c.status === "failed") && JSON.stringify(r.devices) === JSON.stringify(run.devices) &&
      JSON.stringify(r.profile) === JSON.stringify(run.profile));
    active.done = performAudit(run, root, {
      signal: controller.signal, previous,
      captureDevice: (device, settings, signal) => captureAuditDevice(browser, device, settings, signal),
    }).catch(async error => {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = error.message;
      await saveRun(root, run, { pdf: false });
    }).finally(() => {
      if (this.active === active) this.active = null;
      browser.busy = false; browser.capturing = false; browser.setVisible(true); browser.publish();
    });
    active.done.catch(console.error);
    return structuredClone(run);
  }
  async stop() {
    const active = this.active;
    active?.controller.abort();
    await active?.registering;
    await active?.done;
    await this.store.queue;
  }
  editable(id) {
    const run = this.store.get(id);
    if (run.status === "running" || this.active?.run.id === id) throw new Error("Wait for the audit before editing findings or exporting.");
    return run;
  }
  async exportPdf(id, layout, preview) {
    const run = this.editable(id);
    return this.exclusive(async () => {
      const file = await generatePdf(this.store.roots.get(id), run, layout);
      if (preview) {
        const error = await this.shell.openPath(file);
        if (error) throw new Error(error);
        return;
      }
      const result = await this.dialog.showSaveDialog(this.window(), { title: "Export PDF report", defaultPath: `Viewport-Atlas-${id}${layout === "a4" ? "-A4" : ""}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!result.canceled && result.filePath) await copyFile(file, result.filePath);
    });
  }
  async saveFile(name, data) {
    if (typeof name !== "string" || name.length > 200 || typeof data !== "string" || data.length > 32000000) throw new Error("Invalid export file.");
    name = exportFileName(name);
    const result = await this.dialog.showSaveDialog(this.window(), { defaultPath: name });
    if (!result.canceled && result.filePath) await writeFile(result.filePath, data);
  }
  async evidence(request) {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.hostname !== "evidence") return new Response(null, { status: 403 });
      const [id, ...pieces] = decodeURIComponent(url.pathname).split("/").filter(Boolean);
      const root = this.store.project.runIds.includes(id) && this.store.roots.get(id);
      const file = pieces.join("/");
      if (!root || !/^(screenshots\/[\w-]+\.png|(?:crops|annotated)\/[\w.-]+\.png|[\w-]+\.json)$/.test(file)) return new Response(null, { status: 404 });
      return new Response(await readFile(safePath(root, file)), { headers: { "Content-Type": file.endsWith(".png") ? "image/png" : file.endsWith(".svg") ? "image/svg+xml" : "application/json", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
    } catch { return new Response(null, { status: 404 }); }
  }
  async request(path, method = "GET", body = {}) {
    if (typeof path !== "string" || path.length > 1000 || !["GET", "POST", "PATCH"].includes(method) || JSON.stringify(body)?.length > 1000000) throw new Error("Invalid review operation.");
    if (path === "/health" && method === "GET") return {
      connected: true, browser: true, codex: await codexStatus(), platform: process.platform,
      outputFolder: this.outputFolder, miro: Boolean(process.env.MIRO_ACCESS_TOKEN), extension: false,
    };
    if (path === "/views" && method === "GET") return [...this.browser().views.values()].map(v => ({ id: v.device.id, device: v.device, url: v.view.webContents.getURL() }));
    if (path === "/runs" && method === "GET") return this.store.history();
    if (path === "/runs" && method === "POST") return this.exclusive(() => this.start(body.devices, body.profile));
    if (path === "/folder" && method === "POST") {
      const result = await this.dialog.showOpenDialog(this.window(), { title: "Choose your report folder", properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || !result.filePaths[0]) throw new Error("Folder selection cancelled.");
      return { path: result.filePaths[0] };
    }
    if (path === "/miro/boards" && method === "GET") return listBoards();
    const match = path.match(/^\/runs\/([\w-]+)(?:\/(cancel|open|findings|merge|miro|evidence)(?:\/([\w-]+))?)?$/);
    if (!match) throw new Error("This operation is not available in the desktop review workspace.");
    const [, id, action, findingId] = match;
    const run = this.store.get(id), root = this.store.roots.get(id);
    if (!action && method === "GET") return this.active?.run.id === id ? { ...run, status: "running", progress: run.status === "running" ? run.progress : "Saving reports…" } : run;
    if (action === "cancel" && method === "POST") {
      if (this.active?.run.id === id) this.active.controller.abort();
      return { cancelled: true };
    }
    this.editable(id);
    if (action === "open" && method === "POST") {
      const error = await this.shell.openPath(root);
      if (error) throw new Error(error);
      return { opened: true };
    }
    if (action === "evidence" && method === "POST") {
      const prefix = `/evidence/${id}/`;
      if (typeof body.path !== "string" || !body.path.startsWith(prefix)) throw new Error("Choose evidence from this report.");
      const file = body.path.slice(prefix.length);
      if (!/^(screenshots|crops|annotated)\/[\w-]+\.png$/.test(file)) throw new Error("Unsupported evidence file.");
      const error = await this.shell.openPath(safePath(root, file));
      if (error) throw new Error(error);
      return { opened: true };
    }
    if (action === "miro" && method === "POST") {
      const key = `${id}:${body.boardId}`;
      if (this.exports.has(key)) throw new Error("This board export is already running.");
      this.exports.add(key);
      try { return await exportToMiro(root, run, body.boardId); } finally { this.exports.delete(key); }
    }
    if (action === "findings" && ["PATCH", "POST"].includes(method)) {
      const finding = validateFinding(body);
      if (method === "PATCH") {
        if (finding.id !== findingId || !run.findings.some(f => f.id === findingId)) throw new Error("Finding ID does not match this run.");
        run.findings = run.findings.map(f => f.id === findingId ? finding : f);
      } else {
        if (finding.source !== "manual" || run.findings.some(f => f.id === finding.id)) throw new Error("A unique manual observation is required.");
        run.findings.push(finding);
      }
    } else if (action === "merge" && method === "POST") {
      const source = run.findings.find(f => f.id === body.sourceId), target = run.findings.find(f => f.id === body.targetId);
      if (!source || !target || source === target) throw new Error("Choose two different findings.");
      target.devices = [...new Set([...target.devices, ...source.devices])];
      target.evidence.push(...source.evidence);
      target.impact += `\n\nMerged observation: ${source.title}. ${source.impact}`;
      target.recommendation += `\n\n${source.recommendation}`;
      run.findings = run.findings.filter(f => f !== source);
    } else throw new Error("Unsupported review operation.");
    await saveRun(root, run);
    return run;
  }
}
