import { privateElements } from "../companion/privacy-page.mjs";
import { pageCommand, captureScreenshot } from "./cdp.mjs";
import axe from "axe-core";
import { DEFAULT_MASKS } from "../companion/capture.mjs";
import { MAX_HEIGHT } from "../companion/capture-settings.mjs";
import { browserEvidence } from "../companion/interaction.mjs";
import { collectPageCode } from "../companion/page-code.mjs";

async function evaluate(entry, expression, signal, timeout = 35000) {
  if (!entry.context) throw new Error("The page is not ready for evidence capture.");
  const response = await pageCommand(entry, "Runtime.evaluate", {
    contextId: entry.context, expression, awaitPromise: true, returnByValue: true,
  }, { signal, timeout });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || "Page evidence evaluation failed.");
  return response.result.value;
}

export async function captureAuditDevice(workspace, device, profile, signal) {
  signal?.throwIfAborted();
  const entry = workspace.views.get(device.id);
  if (!entry || entry.device.width !== device.width || entry.device.height !== device.height) throw new Error("Open the selected device dimensions in the live workspace before auditing.");
  const context = entry.context;
  const read = (expression) => {
    if (entry.context !== context) throw new Error("The page navigated during capture. Run a new audit after every view is ready.");
    return evaluate(entry, expression, signal);
  };
  const masks = [DEFAULT_MASKS, profile.masks].filter(Boolean).join(",");
  let initial;
  try {
    await workspace.emulate(entry, 1);
    initial = await read(`(async () => {
      document.querySelectorAll(${JSON.stringify(masks)});
      await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
      return { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight };
    })()`);
    if (profile.fullPage) {
      for (let step = 0; step < 16; step++) {
        signal?.throwIfAborted();
        const end = await read(`(async () => {
          scrollTo(0, ${Math.min(step * 900, MAX_HEIGHT)});
          await new Promise(resolve => setTimeout(resolve, 90));
          return scrollY + innerHeight >= document.documentElement.scrollHeight - 5;
        })()`);
        if (end) break;
      }
    }
    await read(`(async () => { scrollTo(${initial.x}, ${initial.y}); await new Promise(resolve => setTimeout(resolve, 100)); })()`);
    const metadata = await read(`(${browserEvidence})(${JSON.stringify({ type: "metadata", masks })})`);
    const pageCode = profile.ai && profile.includePageCode
      ? await read(`(${collectPageCode})(${JSON.stringify({ masks })})`) : undefined;
    let result, bounds = {};
    if (profile.categories.includes("Accessibility")) {
      await read(axe.source);
      const checked = await read(`(async () => {
        const masks = ${JSON.stringify(masks)};
        const result = await Promise.race([
          axe.run({ exclude: [masks] }, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Accessibility checks exceeded 30 seconds.')), 30000))
        ]);
        const bounds = {};
        for (const violation of result.violations) for (const node of violation.nodes.slice(0, 20)) {
          try {
            const element = document.querySelector(node.target.join(' '));
            if (!element || element.closest(masks)) continue;
            const rect = element.getBoundingClientRect();
            bounds[node.target.join(' > ')] = { x: rect.x ${profile.fullPage ? "+ scrollX" : ""}, y: rect.y ${profile.fullPage ? "+ scrollY" : ""}, width: rect.width, height: rect.height };
          } catch {}
        }
        // Node HTML and accessible text never leave the isolated evidence world.
        return { axe: { testEngine: result.testEngine, violations: result.violations.map(v => ({ id:v.id, impact:v.impact, help:v.help, description:v.description, helpUrl:v.helpUrl,
          nodes:v.nodes.slice(0,20).map(n => ({ target:n.target, failureSummary:n.failureSummary })) })), passes: result.passes.map(v => ({ id:v.id })), incomplete: result.incomplete.map(v => ({ help:v.help })) }, bounds };
      })()`);
      result = checked.axe;
      bounds = checked.bounds;
    }
    signal?.throwIfAborted();
    const metrics = await read(`(() => {
      const selectors = ${JSON.stringify(masks)};
      const hidden = [], root = document.createElement('div'), style = document.createElement('style');
      globalThis.__atlasCaptureState = { hidden, root, style };
      root.dataset.atlasCaptureMask = 'true';
      style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
      const seen = new Set();
      const privateNodes = ${privateElements};
      for (const el of privateNodes(selectors)) {
        for (const rect of el.getClientRects()) {
          const mask = document.createElement('div');
          Object.assign(mask.style, { position:'absolute', left:rect.x + scrollX + 'px', top:rect.y + scrollY + 'px', width:rect.width + 'px', height:rect.height + 'px', background:'#344e50', zIndex:'2147483647', pointerEvents:'none' });
          root.append(mask);
        }
        const descendants = (root) => [...root.querySelectorAll('*')].flatMap(n => [n, ...(n.shadowRoot ? descendants(n.shadowRoot) : [])]);
              for (const node of [el, ...descendants(el), ...(el.shadowRoot ? descendants(el.shadowRoot) : [])]) {
          if (seen.has(node)) continue;
          if (hidden.length >= 20000) throw new Error('Too many private elements to mask safely.');
          seen.add(node);
          hidden.push({node, value:node.style.getPropertyValue('visibility'), priority:node.style.getPropertyPriority('visibility')});
          node.style.setProperty('visibility','hidden','important');
        }
      }
      document.documentElement.append(style, root);
      root.getBoundingClientRect();
      return {width:innerWidth, height:innerHeight, density:devicePixelRatio, documentHeight:document.documentElement.scrollHeight, x:scrollX, y:scrollY};
    })()`);
    if (metrics.width !== device.width || metrics.height !== device.height || metrics.density !== 2) throw new Error("Browser dimensions do not match the requested evidence.");
    const height = profile.fullPage ? Math.min(Math.max(metrics.documentHeight, device.height), MAX_HEIGHT) : device.height;
    const shot = await captureScreenshot(entry, {
      format: "png", captureBeyondViewport: profile.fullPage,
      clip: { x: profile.fullPage ? 0 : metrics.x, y: profile.fullPage ? 0 : metrics.y, width: device.width, height, scale: 1 },
    }, { signal, timeout: 20000 });
    signal?.throwIfAborted();
    if (entry.context !== context) throw new Error("The page navigated during evidence capture.");
    return { axe: result, bounds, capture: {
      buffer: Buffer.from(shot.data, "base64"), width: device.width, height,
      truncated: profile.fullPage && metrics.documentHeight > MAX_HEIGHT, metadata, ...(pageCode ? { pageCode } : {}),
      conditions: { engine: "Chromium", deviceScaleFactor: 2, fullPage: profile.fullPage, maxHeight: MAX_HEIGHT,
        maskSelectors: masks, initialScroll: initial, initialState: metadata.state, animation: "disabled during capture", lazyLoadLimit: 16, capturedAt: new Date().toISOString() },
    } };
  } finally {
    if (!entry.view.webContents.isDestroyed()) {
      await evaluate(entry, `(() => {
        const state = globalThis.__atlasCaptureState;
        if (state) {
          for (const {node,value,priority} of state.hidden) {
            if (value) node.style.setProperty('visibility',value,priority); else node.style.removeProperty('visibility');
          }
          state.root.remove(); state.style.remove(); delete globalThis.__atlasCaptureState;
        }
        ${initial ? `scrollTo(${initial.x},${initial.y});` : ""}
      })()`, undefined, 5000).catch(() => {});
      await workspace.emulate(entry);
    }
  }
}
