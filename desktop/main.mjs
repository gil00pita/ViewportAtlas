import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, autoUpdater } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, stat, rm, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { BrowserWorkspace } from "./browser-workspace.mjs";
import { captureWorkspace } from "./capture.mjs";
import { assetHandler } from "./protocol.mjs";
import { EXAMPLE_URL, WORKSPACE_URL } from "./constants.mjs";
import { validateDevices, exportFileName } from "../companion/core.mjs";
import { ReviewStore } from "./review-store.mjs";
import { ReviewWorkspace } from "./review-workspace.mjs";
import { DesktopFlows } from "./flows.mjs";
import { prepareImport, applyImport, exportProject } from "./data-transfer.mjs";
import { validateMapping, mappedPreparation } from "./mappings.mjs";
import { DesktopUpdates } from "./updates.mjs";
import { browserEvidence } from "../companion/interaction.mjs";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
let window, workspace, lastExport, operation = false;
let operationDone;
let starting = false;
let store, review, flows, quitting = false;
let stagedImport, updates;
const activeDownloads = new Set();
const downloadJobs = new Set();
let downloadRoot;

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== WORKSPACE_URL)
    throw new Error("This operation is available only to the Viewport Atlas workspace.");
}
function register(name, handler) {
  ipcMain.handle(`desktop:${name}`, async (event, ...args) => {
    trusted(event);
    return handler(...args);
  });
}

async function exclusive(fn, allowPendingDownload = false) {
  if (starting || operation || review?.active || flows?.running || workspace?.flowReplaying) throw new Error("Wait for the current operation or cancel the audit/flow before continuing.");
  if (!allowPendingDownload && workspace?.pendingDownload) throw new Error("Save or cancel the website download before continuing.");
  operation = true;
  operationDone = Promise.resolve().then(fn);
  try { return await operationDone; } finally { operation = false; operationDone = undefined; }
}

async function createWindow() {
  starting = true;
  try {
  const sites = await websiteSession();
  const owner = new BrowserWindow({ width: 1500, height: 1000, minWidth: 1000, minHeight: 720,
    title: "Viewport Atlas", backgroundColor: "#F4F7F6", icon: join(project, "public/icons/icon-128.png"),
    webPreferences: { preload: join(project, "desktop/preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window = owner;
  owner.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/miro\.com\/app\/board\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  owner.webContents.on("will-navigate", (event) => event.preventDefault());
  const browser = makeBrowser(owner, sites);
  workspace = browser;
  owner.on("closed", () => {
    browser.close();
    if (window === owner) { workspace?.close(); workspace = undefined; window = undefined; }
  });
  owner.on("close", (event) => {
    if ((operation || review?.active || flows?.running || flows?.recording || workspace?.pendingDownload || activeDownloads.size || downloadJobs.size || store.pendingWrites) && !quitting) {
      event.preventDefault();
      stopOperations().then(() => owner.close()).catch(console.error);
    }
  });
  await owner.loadURL(WORKSPACE_URL);
  await browser.create(store.preferences["atlas-devices"]?.filter(d => !d.hidden));
  await browser.navigate(store.project.url || EXAMPLE_URL);
  await updateMasks();
  } finally { starting = false; workspace?.publish(); }
}

async function websiteSession() {
  const selected = store.project;
  const partition = selected.id === "default" && !selected.temporary ? "persist:atlas-review" : `${selected.temporary ? "" : "persist:"}atlas-project-${selected.id}`;
  const sites = session.fromPartition(partition);
  if (!await sites.protocol.isProtocolHandled("atlas")) sites.protocol.handle("atlas", assetHandler("example", join(project, "public"), { example: true }));
  sites.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  sites.setPermissionCheckHandler(() => false);
  if (!sites.atlasManaged) sites.on("will-download", (event, item, contents) => {
    if (!workspace || workspace.closed || workspace.session !== sites) { event.preventDefault(); return; }
    if (workspace.pendingDownload) { event.preventDefault(); return; }
    const browser = workspace;
    const record = { item, filename: item.getFilename().slice(0, 200), stage: join(downloadRoot, `${randomUUID()}.download`), completed: false, destination: null };
    let finish;
    record.finished = new Promise(resolve => { finish = resolve; });
    browser.pendingDownload = record;
    item.setSavePath(record.stage); item.pause(); activeDownloads.add(item);
    item.once("done", (_event, state) => {
      activeDownloads.delete(item);
      record.completed = state === "completed";
      const job = (async () => {
        if (record.completed && record.destination && !record.cancelled) await finishDownload(browser, record);
        else if (!record.completed || record.cancelled) { await rm(record.stage, { force: true }); if (browser.pendingDownload === record) browser.pendingDownload = null; }
      })().catch(error => { browser.problem = `Download could not be saved: ${error.message}`; }).finally(() => { downloadJobs.delete(job); finish(); browser.publish(); });
      downloadJobs.add(job);
    });
    const source = [...workspace.views.values()].find(entry => entry.view.webContents === contents) || [...workspace.views.values()][0];
    workspace.interrupt(source, "A website download is paused. Choose its destination in the workspace to save it once. Other viewports remain paused.");
  });
  sites.atlasManaged = true;
  return sites;
}

function makeBrowser(owner, sites) {
  const browser = new BrowserWorkspace(owner, sites, (state) => {
    if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send("desktop:changed", { ...state, busy: state.busy || starting, lastExport, projects: store.summary(), update: updates?.state });
  });
  browser.mappings = store.project.mappings;
  browser.onAction = action => { flows?.accept(action); if (action.type === "navigate") { store.project.url = action.url; void store.persist().catch(console.error); } };
  browser.onInterrupt = reason => { void flows?.interrupt(reason)?.catch(console.error); if (browser.capturing) review?.active?.controller.abort(new Error(reason)); };
  return browser;
}

async function updateMasks() {
  if (!workspace || flows?.recording || flows?.running) return;
  const profiles = store.preferences["atlas-profiles"] || [];
  const profile = profiles.find(p => p.id === store.preferences["atlas-profile-id"]) || profiles[0];
  // Invalid saved selectors leave a recoverable paused workspace on startup.
  // The browser adapter exposes the problem; no unmasked actions are accepted.
  await workspace.setMasks(profile?.masks || "").catch(() => {});
}

async function finishDownload(browser, record) {
  await copyFile(record.stage, record.destination); await rm(record.stage, { force: true });
  if (browser.pendingDownload === record) browser.pendingDownload = null;
  browser.publish();
}
async function cancelDownload() {
  const record = workspace?.pendingDownload;
  if (!record) return;
  record.cancelled = true;
  if (!record.completed) { try { record.item.cancel(); } catch {} }
  let timer;
  await Promise.race([record.finished, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
  clearTimeout(timer);
  activeDownloads.delete(record.item);
  await Promise.allSettled([...downloadJobs]);
  if (!record.destination) await rm(record.stage, { force: true });
  if (workspace.pendingDownload === record) workspace.pendingDownload = null;
  workspace.publish();
}
async function stopOperations() { await flows?.stop(); await review?.stop(); await cancelDownload(); await operationDone?.catch(() => {}); await store?.queue; }

async function projectOperation(action, body = {}) {
  if (action === "list") return store.summary();
  return exclusive(async () => {
    if (flows.recording) throw new Error("Stop the recording before changing project sessions.");
    if (workspace.pendingDownload) throw new Error("Save or cancel the website download before changing project sessions.");
    await workspace.queue;
    const url = workspace.url;
    if (action === "create") await store.createProject(body.name, body.temporary);
    else if (action === "select") await store.selectProject(body.id);
    else if (action !== "clear-login") throw new Error("Unsupported project operation.");
    const oldSession = workspace.session;
    workspace.close();
    if (action === "clear-login") { await oldSession.clearData(); await oldSession.clearCache(); await oldSession.closeAllConnections(); }
    workspace = makeBrowser(window, await websiteSession());
    workspace.setPresentation(false);
    await workspace.create(store.preferences["atlas-devices"]?.filter(d => !d.hidden));
    await workspace.navigate(action === "clear-login" ? url : store.project.url || EXAMPLE_URL);
    await updateMasks();
    lastExport = undefined;
    window.webContents.once("did-finish-load", () => workspace.setPresentation(true));
    setImmediate(() => { if (!window.isDestroyed()) window.webContents.reload(); });
    return store.summary();
  });
}

async function configure(devices) {
  validateDevices(devices);
  const visible = devices.filter(d => !d.hidden);
  if (!visible.length) throw new Error("Keep at least one device visible.");
  const current = [...workspace.views.values()].map(v => v.device);
  if (JSON.stringify(current) === JSON.stringify(visible)) return workspace.state();
  const url = workspace.url, shown = workspace.presentationVisible !== false;
  const sites = workspace.session;
  await workspace.queue;
  workspace.close();
  workspace = makeBrowser(window, sites);
  workspace.setPresentation(false);
  await workspace.create(visible);
  await workspace.navigate(url);
  await updateMasks();
  workspace.setPresentation(shown);
  return workspace.state();
}

app.whenReady().then(async () => {
  store = await new ReviewStore(join(app.getPath("userData"), "reviews")).open();
  downloadRoot = join(app.getPath("userData"), "download-staging");
  await rm(downloadRoot, { recursive: true, force: true });
  await mkdir(downloadRoot, { recursive: true, mode: 0o700 });
  review = new ReviewWorkspace({ store, browser: () => workspace, window: () => window,
    outputFolder: join(app.getPath("documents"), "Viewport Atlas"), dialog, shell, configure, exclusive });
  flows = new DesktopFlows({ store, browser: () => workspace, review });
  const release = await readFile(join(project, 'desktop/release.json'), 'utf8').then(JSON.parse).catch(() => ({ signed: false }));
  updates = new DesktopUpdates({ updater: autoUpdater, version: app.getVersion(), platform: process.platform, arch: process.arch,
    enabled: app.isPackaged && release.signed === true && !process.env.ATLAS_DESKTOP_STATE_DIR && ["darwin", "win32"].includes(process.platform),
    busy: () => Boolean(operation || review.active || flows.running || flows.recording || review.exports.size || activeDownloads.size || workspace?.pendingDownload || workspace?.pending || workspace?.popups.size || downloadJobs.size || store.pendingWrites), changed: () => workspace?.publish() });
  const assets = assetHandler("workspace", join(project, "dist/desktop"));
  protocol.handle("atlas", request => new URL(request.url).hostname === "evidence" ? review.evidence(request) : assets(request));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ]));
  register("state", () => ({ ...workspace.state(), busy: workspace.state().busy || starting, lastExport, projects: store.summary(), update: updates.state }));
  register("update", action => { if (action === "check") return updates.check(); if (action === "install") return updates.install(); throw new Error("Unsupported update operation."); });
  register("navigate", (url) => exclusive(async () => { const state = await workspace.navigate(url); store.project.url = workspace.url; await store.persist(); await updateMasks(); return state; }));
  register("history", (command) => exclusive(() => workspace.history(command)));
  register("retry", () => exclusive(() => workspace.retry()));
  register("popup", () => workspace.allowPopup());
  register("download", () => exclusive(async () => {
    const pending = workspace.pendingDownload;
    if (!pending) throw new Error("No website download is waiting.");
    workspace.setVisible(false);
    try {
      const result = await dialog.showSaveDialog(window, { title: "Choose a destination for this website download", defaultPath: exportFileName(pending.filename) });
      if (result.canceled || !result.filePath) return;
      if (workspace.pendingDownload !== pending) throw new Error("This download was cancelled while the destination was being chosen.");
      pending.destination = result.filePath;
      if (pending.completed) await finishDownload(workspace, pending); else pending.item.resume();
      workspace.problem = "The website download is being saved once. Reload the prepared views when you are ready to resume synchronization.";
      workspace.publish();
    } finally { workspace.setVisible(true); }
  }, true));
  register("cancel-download", cancelDownload);
  register("exclude", (id, excluded) => exclusive(() => workspace.exclude(id, excluded)));
  register("test-mode", origin => exclusive(() => workspace.setTestOrigin(origin)));
  register("mapping", mapping => exclusive(async () => {
    validateMapping(mapping);
    const entry = workspace.views.get(mapping.viewId);
    if (!entry) throw new Error("Choose an open viewport.");
    if (!mapping.selector) {
      store.project.mappings = store.project.mappings.filter(m => m.viewId !== mapping.viewId || m.source !== mapping.source);
      workspace.mappings = store.project.mappings; await store.persist(); workspace.publish(); return;
    }
    const valid = await workspace.run(entry, `(() => {
      const target = document.querySelectorAll(${JSON.stringify(mapping.selector)});
      if (target.length !== 1) return false;
      const describe = ${browserEvidence};
      const d = describe({ type:'describe-element', element:target[0], desktop:true, masks:${JSON.stringify(workspace.masks)} });
      if (!d || d.risky || d.sensitive) return false;
      ${mapping.prepare ? `(${mappedPreparation})(${JSON.stringify(mapping)}, ${JSON.stringify(workspace.masks)}, describe);` : ""}
      return true;
    })()`);
    if (!valid) throw new Error("The mapping is missing, ambiguous, private, or consequential. Prepare the view and choose a safe counterpart.");
    store.project.mappings = [...store.project.mappings.filter(m => m.viewId !== mapping.viewId || m.source !== mapping.source), { source: mapping.source, viewId: mapping.viewId, selector: mapping.selector, prepare: mapping.prepare || "" }];
    workspace.mappings = store.project.mappings; await store.persist(); workspace.publish();
  }));
  register("project", projectOperation);
  register("data", (action, body = {}) => exclusive(async () => {
    if (flows.recording) throw new Error("Stop recording before importing or exporting project data.");
    if (action === "export") return review.saveFile("viewport-atlas-project.json", JSON.stringify(exportProject(store), null, 2));
    if (action === "preview-import") {
      workspace.setPresentation(false);
      const chosen = await dialog.showOpenDialog(window, { title: "Import Viewport Atlas data", properties: ["openFile"], filters: [{ name: "Viewport Atlas JSON", extensions: ["json"] }] });
      if (chosen.canceled) return null;
      const file = chosen.filePaths[0];
      if ((await stat(file)).size > 32000000) throw new Error("Choose a migration package smaller than 32 MB.");
      const data = await readFile(file, "utf8");
      stagedImport = { ...await prepareImport(JSON.parse(data), file, store), projectId: store.selectedId };
      return { token: stagedImport.token, counts: stagedImport.counts };
    }
    if (action === "apply-import") {
      if (!stagedImport || body.token !== stagedImport.token || stagedImport.projectId !== store.selectedId) throw new Error("Preview the import again before applying it.");
      const result = await applyImport(stagedImport, store); stagedImport = null;
      workspace.mappings = store.project.mappings;
      window.webContents.once("did-finish-load", () => workspace.setPresentation(true));
      setImmediate(() => window.webContents.reload()); return result;
    }
    throw new Error("Unsupported data operation.");
  }));
  register("layout", (slots) => workspace.layout(slots));
  register("pause", (paused) => exclusive(() => workspace.setPaused(paused)));
  register("presentation", (visible) => workspace.setPresentation(visible));
  register("configure", (devices) => exclusive(() => configure(devices)));
  register("preferences", () => store.preferences);
  register("preference", async (key, value) => { await store.setPreference(key, value); if (["atlas-profiles", "atlas-profile-id"].includes(key)) await updateMasks(); });
  register("review", (path, method = "GET", body) => typeof path === "string" && path.startsWith("/flows") ? flows.request(path, method, body) : review.request(path, method, body));
  register("pdf", (id, layout, preview) => review.exportPdf(id, layout, preview));
  register("save", (name, data) => exclusive(() => review.saveFile(name, data)));
  register("capture", () => exclusive(async () => {
    const browser = workspace;
    browser.setVisible(false);
    try {
      const result = await dialog.showOpenDialog(window, { title: "Choose a folder for viewport evidence", properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || !result.filePaths[0]) return null;
      const destination = result.filePaths[0];
      await mkdir(destination, { recursive: true });
      lastExport = await captureWorkspace(browser, destination);
      const run = JSON.parse(await readFile(join(lastExport.root, "run.json"), "utf8"));
      await store.register(run, lastExport.root);
      browser.publish();
      return lastExport;
    } finally { browser.setVisible(true); }
  }));
  register("reveal", () => { if (lastExport) shell.showItemInFolder(join(lastExport.root, "report.pdf")); });
  await createWindow();
  app.on("activate", () => { if (!window) createWindow().catch(console.error); });
}).catch((error) => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on("before-quit", (event) => {
  if (quitting || (!operation && !review?.active && !flows?.running && !flows?.recording && !activeDownloads.size && !workspace?.pendingDownload && !downloadJobs.size && !store?.pendingWrites)) return;
  event.preventDefault();
  stopOperations().then(() => { quitting = true; app.quit(); }).catch(error => { console.error(error); quitting = true; app.quit(); });
});
