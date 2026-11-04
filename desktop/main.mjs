import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { BrowserWorkspace } from "./browser-workspace.mjs";
import { captureWorkspace } from "./capture.mjs";
import { assetHandler } from "./protocol.mjs";
import { EXAMPLE_URL, WORKSPACE_URL } from "./constants.mjs";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
let window, workspace, lastExport, operation = false;

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

async function exclusive(fn) {
  if (operation) throw new Error("Wait for the current operation to finish.");
  operation = true;
  try { return await fn(); } finally { operation = false; }
}

async function createWindow() {
  const sites = session.fromPartition("persist:atlas-review");
  if (!await sites.protocol.isProtocolHandled("atlas")) sites.protocol.handle("atlas", assetHandler("example", join(project, "public"), { example: true }));
  sites.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  sites.setPermissionCheckHandler(() => false);
  sites.on("will-download", (event) => {
    event.preventDefault();
    if (workspace) { workspace.paused = true; workspace.problem = "Downloads are not supported in this first desktop milestone."; workspace.publish(); }
  });
  const owner = new BrowserWindow({ width: 1500, height: 1000, minWidth: 1000, minHeight: 720,
    title: "Viewport Atlas", backgroundColor: "#F4F7F6", icon: join(project, "public/icons/icon-128.png"),
    webPreferences: { preload: join(project, "desktop/preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window = owner;
  owner.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  owner.webContents.on("will-navigate", (event) => event.preventDefault());
  const browser = new BrowserWorkspace(owner, sites, (state) => {
    if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send("desktop:changed", { ...state, lastExport });
  });
  workspace = browser;
  owner.on("closed", () => {
    browser.close();
    if (window === owner) { workspace = undefined; window = undefined; }
  });
  await owner.loadURL(WORKSPACE_URL);
  await browser.create();
  await browser.navigate(EXAMPLE_URL);
}

app.whenReady().then(async () => {
  protocol.handle("atlas", assetHandler("workspace", join(project, "dist/desktop")));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ]));
  register("state", () => ({ ...workspace.state(), lastExport }));
  register("navigate", (url) => exclusive(() => workspace.navigate(url)));
  register("layout", (slots) => workspace.layout(slots));
  register("pause", (paused) => workspace.setPaused(paused));
  register("capture", () => exclusive(async () => {
    const browser = workspace;
    browser.setVisible(false);
    try {
      const result = await dialog.showOpenDialog(window, { title: "Choose a folder for viewport evidence", properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || !result.filePaths[0]) return null;
      const destination = result.filePaths[0];
      await mkdir(destination, { recursive: true });
      lastExport = await captureWorkspace(browser, destination);
      browser.publish();
      return lastExport;
    } finally { browser.setVisible(true); }
  }));
  register("reveal", () => { if (lastExport) shell.showItemInFolder(join(lastExport.root, "report.pdf")); });
  await createWindow();
  app.on("activate", () => { if (!window) createWindow().catch(console.error); });
}).catch((error) => { console.error(error); app.exit(1); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
