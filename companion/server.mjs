import express from "express";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { randomBytes } from "node:crypto";
import {
  createViews,
  listViews,
  preview,
  interact,
  getView,
  closeBrowser,
} from "./browser.mjs";
import {
  validateUrl,
  validateDevices,
  validateProfile,
  newRun,
  safePath,
  redactUrl,
} from "./core.mjs";
import { prepareCapture, writeCapture } from "./capture.mjs";
import { performAudit, saveRun, atomicJson } from "./audit.mjs";
import { validateFinding } from "./schema.mjs";
import { codexStatus, execFileSafe } from "./codex.mjs";
import { generatePdf } from "./pdf.mjs";
import { listBoards, exportToMiro } from "./miro.mjs";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PORT = Number(process.env.ATLAS_PORT || 4318);
const stateDir =
  process.env.ATLAS_STATE_DIR || join(homedir(), ".viewport-atlas");
const outputDir =
  process.env.ATLAS_OUTPUT_DIR ||
  join(homedir(), "Documents", "Viewport Atlas");
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await mkdir(outputDir, { recursive: true });
const tokenPath = join(stateDir, "native-token");
let token;
try {
  token = await readFile(tokenPath, "utf8");
} catch {
  token = randomBytes(32).toString("hex");
  await writeFile(tokenPath, token, { mode: 0o600 });
}
let installedExtension;
try {
  installedExtension = (
    await readFile(join(stateDir, "extension-id"), "utf8")
  ).trim();
} catch {}
const runs = new Map();
const roots = new Map();
const controllers = new Map();
const exportLocks = new Set();
let browserQueue = Promise.resolve();
const withBrowser = (fn) => {
  const result = browserQueue.then(fn);
  browserQueue = result.catch(() => {});
  return result;
};
let registry = {};
try {
  registry = JSON.parse(await readFile(join(stateDir, "runs.json"), "utf8"));
} catch {}
for (const [id, root] of Object.entries(registry)) {
  try {
    const r = JSON.parse(await readFile(join(root, "run.json"), "utf8"));
    if (r.status === "running") {
      r.status = "failed";
      r.error =
        "Companion stopped during this run. Partial evidence was retained; start a new audit to retry.";
      await saveRun(root, r, { pdf: false });
    }
    runs.set(id, r);
    roots.set(id, root);
  } catch {}
}
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host))
    return res.status(403).json({ error: "Loopback host required." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const origin = req.get("origin");
  const extension =
    installedExtension && origin === `chrome-extension://${installedExtension}`;
  const local =
    origin &&
    [
      `http://127.0.0.1:${PORT}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ].includes(origin);
  const native = req.get("x-atlas-token") === token;
  const crossSite = req.get("sec-fetch-site") === "cross-site";
  if (req.path.startsWith("/api") || req.path.startsWith("/evidence")) {
    if (
      !native &&
      ((origin && !local && !extension) ||
        (crossSite && !extension) ||
        (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
          !local &&
          !extension))
    )
      return res.status(403).json({
        error:
          "This request did not originate from your local Viewport Atlas workspace.",
      });
    if (extension) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "48mb" }));
const route = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    next(e);
  }
};
const getRun = (id) => {
  const r = runs.get(id);
  if (!r) throw new Error("Audit not found.");
  return r;
};
const register = async (r, root) => {
  runs.set(r.id, r);
  roots.set(r.id, root);
  registry[r.id] = root;
  await atomicJson(join(stateDir, "runs.json"), registry);
  await saveRun(root, r, { pdf: false });
};
let codexCache = null;
let codexCacheAt = 0;
app.get(
  "/api/health",
  route(async (req, res) => {
    if (Date.now() - codexCacheAt > 10000) {
      codexCache = await codexStatus();
      codexCacheAt = Date.now();
    }
    let browser = true;
    try {
      await access((await import("playwright")).chromium.executablePath());
    } catch {
      browser = false;
    }
    res.json({
      connected: true,
      codex: codexCache,
      browser,
      platform: platform(),
      outputFolder: outputDir,
      miro: Boolean(process.env.MIRO_ACCESS_TOKEN),
      extension: false,
    });
  }),
);
app.post(
  "/api/views",
  route(async (req, res) => {
    if (controllers.size)
      throw new Error(
        "Wait for the current audit or cancel it before replacing views.",
      );
    res.json(
      await withBrowser(() =>
        createViews(
          validateUrl(req.body.url),
          validateDevices(req.body.devices),
        ),
      ),
    );
  }),
);
app.get(
  "/api/views",
  route(async (req, res) => res.json(await listViews())),
);
app.get(
  "/api/views/:id/image",
  route(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("image/jpeg").send(await preview(req.params.id));
  }),
);
app.post(
  "/api/views/:id/action",
  route(async (req, res) => {
    if (controllers.size)
      throw new Error(
        "Pause browsing until the audit finishes to keep evidence consistent.",
      );
    const { action, sync } = req.body;
    const allowed = [
      "click",
      "scroll",
      "input",
      "navigate",
      "back",
      "forward",
      "reload",
      "resync",
    ];
    if (!action || !allowed.includes(action.type))
      throw new Error("Unsupported browser action.");
    if (
      action.type === "click" &&
      (!Number.isFinite(action.x) || !Number.isFinite(action.y))
    )
      throw new Error("Invalid click coordinates.");
    if (action.type === "scroll" && !Number.isFinite(action.deltaY))
      throw new Error("Invalid scroll delta.");
    res.json(
      await withBrowser(() => interact(req.params.id, action, sync || {})),
    );
  }),
);
app.post(
  "/api/capture",
  route(async (req, res) => {
    validateDevices(req.body.devices);
    const id = `capture-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const root = join(outputDir, id);
    const shots = [];
    for (const d of req.body.devices) {
      let c;
      if (req.body.snapshots) {
        const snapshot = req.body.snapshots.find((s) => s.deviceId === d.id);
        if (
          !snapshot ||
          typeof snapshot.png !== "string" ||
          !snapshot.png.startsWith("iVBOR")
        )
          throw new Error("Missing extension capture.");
        c = { ...snapshot, buffer: Buffer.from(snapshot.png, "base64") };
      } else
        c = await prepareCapture(getView(d.id).page, {
          fullPage: req.body.fullPage,
          masks: req.body.masks,
        });
      shots.push(await writeCapture(root, id, d.id, c));
    }
    roots.set(id, root);
    res.json({ screenshots: shots });
  }),
);
app.post(
  "/api/runs",
  route(async (req, res) => {
    if (controllers.size)
      throw new Error(
        "An audit is already running. Cancel it or wait for it to finish.",
      );
    const url = validateUrl(req.body.url);
    const devices = validateDevices(req.body.devices);
    const profile = validateProfile(req.body.profile);
    const destination = profile.outputFolder || outputDir;
    if (!isAbsolute(destination))
      throw new Error("The output folder must be an absolute path.");
    await mkdir(destination, { recursive: true });
    const run = newRun(redactUrl(url), devices, profile);
    const root = join(destination, run.id);
    run.outputFolder = root;
    const previous = [...runs.values()]
      .filter(
        (r) =>
          r.url === run.url &&
          r.status === "completed" &&
          !r.checks.some((check) => check.status === "failed") &&
          r.profile.ai === profile.ai &&
          r.profile.fullPage === profile.fullPage &&
          r.profile.masks === profile.masks &&
          (!profile.ai || r.profile.prompt === profile.prompt) &&
          JSON.stringify([...r.profile.categories].sort()) ===
            JSON.stringify([...profile.categories].sort()) &&
          JSON.stringify(r.devices.map((d) => [d.id, d.width, d.height])) ===
            JSON.stringify(devices.map((d) => [d.id, d.width, d.height])),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    await register(run, root);
    const controller = new AbortController();
    controllers.set(run.id, controller);
    res.status(202).json(run);
    withBrowser(() =>
      performAudit(run, root, {
        signal: controller.signal,
        snapshots: req.body.snapshots,
        previous,
      }),
    )
      .catch((e) => {
        run.status = "failed";
        run.error = e.message;
        return saveRun(root, run, { pdf: false });
      })
      .finally(() => controllers.delete(run.id));
  }),
);
app.get("/api/runs", (req, res) =>
  res.json(
    [...runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ codexOutput, ...run }) => run),
  ),
);
app.get(
  "/api/runs/:id",
  route(async (req, res) => res.json(getRun(req.params.id))),
);
app.post(
  "/api/runs/:id/cancel",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    controllers.get(r.id)?.abort(new Error("Audit cancelled by user."));
    res.json({ cancelled: true });
  }),
);
app.patch(
  "/api/runs/:id/findings/:finding",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    if (r.status === "running")
      throw new Error("Wait for the audit before editing findings.");
    const finding = validateFinding(req.body);
    if (
      finding.id !== req.params.finding ||
      !r.findings.some((f) => f.id === finding.id)
    )
      throw new Error("Finding ID does not match this run.");
    r.findings = r.findings.map((f) => (f.id === finding.id ? finding : f));
    await saveRun(roots.get(r.id), r);
    res.json(r);
  }),
);
app.post(
  "/api/runs/:id/findings",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    if (r.status === "running")
      throw new Error("Wait for the audit before editing findings.");
    const f = validateFinding(req.body);
    if (f.source !== "manual" || r.findings.some((x) => x.id === f.id))
      throw new Error("A unique manual observation is required.");
    r.findings.push(f);
    await saveRun(roots.get(r.id), r);
    res.json(r);
  }),
);
app.post(
  "/api/runs/:id/merge",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    if (r.status === "running")
      throw new Error("Wait for the audit before merging findings.");
    const { sourceId, targetId } = req.body;
    const source = r.findings.find((f) => f.id === sourceId),
      target = r.findings.find((f) => f.id === targetId);
    if (!source || !target || sourceId === targetId)
      throw new Error("Choose two different findings.");
    target.devices = [...new Set([...target.devices, ...source.devices])];
    target.evidence.push(...source.evidence);
    target.impact = `${target.impact}\n\nMerged observation: ${source.title}. ${source.impact}`;
    target.recommendation = `${target.recommendation}\n\n${source.recommendation}`;
    r.findings = r.findings.filter((f) => f.id !== sourceId);
    await saveRun(roots.get(r.id), r);
    res.json(r);
  }),
);
app.get(
  "/api/runs/:id/report.pdf",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    if (r.status === "running")
      throw new Error("Wait for the audit before generating its report.");
    const layout = req.query.layout ?? "original";
    const path = await generatePdf(roots.get(r.id), r, layout);
    req.query.inline === "1"
      ? res.type("application/pdf").sendFile(path, { dotfiles: "allow" })
      : res.download(path, `Viewport-Atlas-${r.id}${layout === "a4" ? "-A4" : ""}.pdf`, { dotfiles: "allow" });
  }),
);
app.post(
  "/api/runs/:id/open",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    const folder = roots.get(r.id);
    const cmd =
      platform() === "darwin"
        ? "open"
        : platform() === "win32"
          ? "explorer.exe"
          : "xdg-open";
    await execFileSafe(cmd, [folder], { timeout: 10000 });
    res.json({ opened: true });
  }),
);
app.post(
  "/api/folder",
  route(async (req, res) => {
    if (platform() !== "darwin")
      throw new Error(
        "Enter an absolute folder path in the destination field on this platform.",
      );
    const { stdout } = await execFileSafe(
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Choose your Viewport Atlas output folder")',
      ],
      { timeout: 120000 },
    );
    res.json({ path: stdout.trim() });
  }),
);
app.get(
  "/api/miro/boards",
  route(async (req, res) => res.json(await listBoards())),
);
app.post(
  "/api/runs/:id/miro",
  route(async (req, res) => {
    const r = getRun(req.params.id);
    if (r.status === "running")
      throw new Error("Wait for the audit before exporting.");
    const key = `${r.id}:${req.body.boardId}`;
    if (exportLocks.has(key))
      throw new Error("This board export is already running.");
    exportLocks.add(key);
    try {
      res.json(await exportToMiro(roots.get(r.id), r, req.body.boardId));
    } finally {
      exportLocks.delete(key);
    }
  }),
);
app.use(
  "/evidence",
  route(async (req, res) => {
    const pieces = req.path.split("/").filter(Boolean);
    const root = roots.get(pieces.shift());
    if (!root) throw new Error("Evidence package not found.");
    const file = safePath(root, pieces.join("/"));
    if (!/\.(png|jpe?g|pdf|json)$/i.test(file))
      throw new Error("Unsupported evidence file.");
    res.sendFile(file, { dotfiles: "allow" });
  }),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Unknown companion operation." }),
);
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: project,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(join(project, "dist/web")));
  app.use(express.static(join(project, "public")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(join(project, "dist/web/index.html")),
  );
}
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 400).json({
    error: err.message || "The companion could not complete this operation.",
  });
});
const server = app.listen(PORT, "127.0.0.1", () =>
  console.log(`Viewport Atlas is ready at http://127.0.0.1:${PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    for (const c of controllers.values()) c.abort();
    await closeBrowser();
    server.close(() => process.exit(0));
  });
