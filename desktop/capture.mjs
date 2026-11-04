import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRun, redactUrl } from "../companion/core.mjs";
import { DEFAULT_MASKS, writeCapture } from "../companion/capture.mjs";
import { generatePdf } from "../companion/pdf.mjs";

export async function captureWorkspace(workspace, destination) {
  await workspace.queue;
  if (workspace.paused) throw new Error("Resume synchronization or reload views before capturing a synchronized screen set.");
  if (workspace.problem) throw new Error("Reload views before capturing a synchronized screen set.");
  const entries = [...workspace.views.values()];
  if (entries.some((entry) => entry.status !== "ready")) throw new Error("Wait for every page to finish loading before capturing.");
  const profile = { name: "Desktop viewport capture", prompt: "", categories: [], devices: entries.map((entry) => entry.device.id),
    ai: false, fullPage: false, masks: DEFAULT_MASKS, exportPdf: true, outputFolder: destination };
  const run = newRun(redactUrl(workspace.url), entries.map((entry) => entry.device), profile);
  run.title = entries[0].view.webContents.getTitle() || "Desktop viewport capture";
  run.summary = "Current viewport screenshots captured from the standalone desktop app. No audit or AI checks were run.";
  run.checks = [{ name: "Desktop viewport capture", status: "completed", detail: "Masked current-viewport PNGs at 2× pixel density. Full-page capture is not part of this first milestone." },
    { name: "Automated and AI checks", status: "not_run", detail: "Audit integration is scheduled for a later desktop migration milestone." }];
  const root = join(destination, run.id);
  await mkdir(root, { recursive: true });
  workspace.busy = true;
  workspace.capturing = true;
  workspace.setVisible(false);
  workspace.publish();
  try {
    for (const entry of entries) {
      const wc = entry.view.webContents;
      let overlay;
      try {
        await workspace.emulate(entry, 1);
        overlay = await wc.debugger.sendCommand("Runtime.evaluate", {
          contextId: entry.context,
          expression: `(async () => {
            await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
            const root = document.createElement('div');
            root.dataset.atlasCaptureMask = 'true';
            const hidden = [];
            const seen = new Set();
            globalThis.__atlasCaptureState = { root, hidden };
            for (const el of document.querySelectorAll(${JSON.stringify(DEFAULT_MASKS)})) {
              for (const rect of el.getClientRects()) {
                const mask = document.createElement('div');
                Object.assign(mask.style, { position: 'fixed', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', background: '#344e50', zIndex: '2147483647', pointerEvents: 'none' });
                root.append(mask);
              }
              for (const node of [el, ...el.querySelectorAll('*')]) {
                if (seen.has(node)) continue;
                seen.add(node);
                if (hidden.length >= 20000) throw new Error('Too many private elements to mask safely.');
                hidden.push({ node, value: node.style.getPropertyValue('visibility'), priority: node.style.getPropertyPriority('visibility') });
                node.style.setProperty('visibility', 'hidden', 'important');
              }
            }
            document.documentElement.append(root);
            root.getBoundingClientRect();
            return { width: innerWidth, height: innerHeight, density: devicePixelRatio, x: scrollX, y: scrollY };
          })()`, returnByValue: true, awaitPromise: true,
        });
        const actual = overlay.result.value;
        if (overlay.exceptionDetails || actual?.width !== entry.device.width || actual?.height !== entry.device.height || actual?.density !== 2)
          throw new Error("Browser viewport dimensions do not match the requested capture.");
        const shot = await wc.debugger.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
          clip: { x: actual.x, y: actual.y, width: entry.device.width, height: entry.device.height, scale: 1 } });
        run.screenshots.push(await writeCapture(root, run.id, entry.device.id, {
          buffer: Buffer.from(shot.data, "base64"), width: entry.device.width, height: entry.device.height,
          truncated: false, conditions: { deviceScaleFactor: 2 },
        }));
      } finally {
        if (entry.context) await wc.debugger.sendCommand("Runtime.evaluate", {
          contextId: entry.context, expression: `(() => {
            const state = globalThis.__atlasCaptureState;
            if (!state) return;
            for (const {node, value, priority} of state.hidden) {
              if (value) node.style.setProperty('visibility', value, priority);
              else node.style.removeProperty('visibility');
            }
            state.root.remove();
            delete globalThis.__atlasCaptureState;
          })()`,
        }).catch(() => {});
        if (!wc.isDestroyed()) await workspace.emulate(entry);
      }
    }
    run.status = "completed";
    run.progress = "Viewport evidence exported";
    await generatePdf(root, run);
    await writeFile(join(root, "run.json"), JSON.stringify(run, null, 2));
    return { root, runId: run.id };
  } catch (error) {
    run.status = "failed";
    run.error = error.message;
    await writeFile(join(root, "run.json"), JSON.stringify(run, null, 2));
    throw error;
  } finally {
    workspace.busy = false;
    workspace.capturing = false;
    workspace.setVisible(true);
    workspace.publish();
  }
}
