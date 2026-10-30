import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { browserEvidence } from "./interaction.mjs";
import { collectPageCode } from "./page-code.mjs";
import { CAPTURE_SCALE, MAX_HEIGHT } from "./capture-settings.mjs";
export { MAX_HEIGHT } from "./capture-settings.mjs";
const MAX_CAPTURE_PIXELS = 3840 * MAX_HEIGHT * CAPTURE_SCALE ** 2;
export const DEFAULT_MASKS =
  'input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]';
export async function prepareCapture(
  page,
  { fullPage = true, masks = "", ai = false, includePageCode = false } = {},
  signal,
) {
  const selectors = [DEFAULT_MASKS, masks].filter(Boolean).join(",");
  // Validate selectors before writing any evidence. Invalid masking is a hard failure.
  await page.locator(selectors).count();
  await page.evaluate(() =>
    Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 2000)),
    ]),
  );
  const state = await page.evaluate(() => ({
    x: scrollX,
    y: scrollY,
    height: document.documentElement.scrollHeight,
    deviceScaleFactor: devicePixelRatio,
  }));
  if (fullPage) {
    for (let i = 0; i < 16; i++) {
      signal?.throwIfAborted();
      const next = Math.min(i * 900, MAX_HEIGHT);
      await page.evaluate((y) => scrollTo(0, y), next);
      await page.waitForTimeout(90);
      const end = await page.evaluate(
        () =>
          scrollY + innerHeight >= document.documentElement.scrollHeight - 5,
      );
      if (end) break;
    }
  }
  await page.evaluate(({ x, y }) => scrollTo(x, y), state);
  await page.waitForTimeout(100);
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const vp = page.viewportSize();
  // Bound the clip in CSS pixels and retain the renderer's native pixel density.
  const captureHeight = fullPage ? Math.min(height, MAX_HEIGHT) : vp.height;
  const buffer = await page.screenshot({
    type: "png",
    scale: "device",
    animations: "disabled",
    caret: "hide",
    mask: [page.locator(selectors)],
    maskColor: "#344e50",
    ...(fullPage
      ? {
          clip: { x: 0, y: 0, width: vp.width, height: captureHeight },
          fullPage: true,
        }
      : {}),
    timeout: 20000,
  });
  const metadata = await page.evaluate(browserEvidence, {
    type: "metadata",
    masks: selectors,
  });
  const pageCode = ai && includePageCode ? await page.evaluate(collectPageCode, { masks: selectors }) : undefined;
  // Text in masked regions is not collected; metadata headings/links are independently minimized.
  const maskedText = await page
    .locator(selectors)
    .evaluateAll((elements) =>
      elements.map((e) => e.textContent?.trim()).filter(Boolean),
    );
  for (const item of [...metadata.headings, ...metadata.links]) {
    for (const text of maskedText) {
      if (item.text?.includes(text)) item.text = "[MASKED]";
      if (item.name?.includes(text)) item.name = "[MASKED]";
    }
  }
  return {
    buffer,
    width: vp.width,
    height: captureHeight,
    truncated: fullPage && height > MAX_HEIGHT,
    metadata,
    ...(pageCode ? { pageCode } : {}),
    conditions: {
      engine: "Chromium",
      deviceScaleFactor: state.deviceScaleFactor,
      fullPage,
      maxHeight: MAX_HEIGHT,
      maskSelectors: selectors,
      animation: "disabled during capture",
      lazyLoadLimit: 16,
      initialScroll: state,
      initialState: metadata.state,
      capturedAt: new Date().toISOString(),
    },
  };
}
export async function writeCapture(root, runId, deviceId, capture) {
  const scale = capture.conditions?.deviceScaleFactor ?? 1;
  const info = await sharp(capture.buffer, {
    limitInputPixels: MAX_CAPTURE_PIXELS,
  }).metadata();
  if (
    info.format !== "png" ||
    ![1, CAPTURE_SCALE].includes(scale) ||
    !Number.isInteger(capture.width) ||
    !Number.isInteger(capture.height) ||
    info.width !== capture.width * scale ||
    info.height !== capture.height * scale ||
    capture.width > 3840 ||
    capture.height > MAX_HEIGHT
  )
    throw new Error(
      "Screenshot format or dimensions do not match capture evidence.",
    );
  await mkdir(join(root, "screenshots"), { recursive: true });
  const file = join(root, "screenshots", `${deviceId}.png`);
  await writeFile(file, capture.buffer);
  return {
    deviceId,
    path: `/evidence/${runId}/screenshots/${deviceId}.png`,
    width: capture.width,
    height: capture.height,
    pixelWidth: info.width,
    pixelHeight: info.height,
    deviceScaleFactor: scale,
    truncated: capture.truncated,
  };
}
const esc = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function clipBounds(bounds, width, height, pad = 18) {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return null;
  const left = Math.max(0, Math.floor(bounds.x - pad)),
    top = Math.max(0, Math.floor(bounds.y - pad));
  if (left >= width || top >= height) return null;
  const w = Math.min(width - left, Math.ceil(bounds.width + pad * 2)),
    h = Math.min(height - top, Math.ceil(bounds.height + pad * 2));
  return w > 0 && h > 0 ? { left, top, width: w, height: h } : null;
}
export async function annotateFinding(root, run, finding, evidence, index) {
  if (!evidence.bounds) return;
  const capture = run.screenshots.find((s) => s.deviceId === evidence.deviceId);
  if (!capture) return;
  const cssRegion = clipBounds(evidence.bounds, capture.width, capture.height);
  if (!cssRegion) return;
  const scale = capture.deviceScaleFactor ?? 1;
  const region = Object.fromEntries(
    Object.entries(cssRegion).map(([key, value]) => [key, value * scale]),
  );
  await mkdir(join(root, "crops"), { recursive: true });
  await mkdir(join(root, "annotated"), { recursive: true });
  const original = join(root, "screenshots", `${evidence.deviceId}.png`);
  const basename = `${finding.id}-${index}`;
  await sharp(original)
    .extract(region)
    .png()
    .toFile(join(root, "crops", `${basename}.png`));
  const b = evidence.bounds;
  const overlay = Buffer.from(
    `<svg width="${capture.width * scale}" height="${capture.height * scale}" viewBox="0 0 ${capture.width} ${capture.height}"><rect x="${Math.max(1, b.x)}" y="${Math.max(1, b.y)}" width="${Math.min(b.width, capture.width - b.x - 1)}" height="${Math.min(b.height, capture.height - b.y - 1)}" rx="3" fill="none" stroke="#FF704B" stroke-width="3"/><rect x="${Math.max(0, b.x)}" y="${Math.max(0, b.y - 23)}" width="${Math.min(360, capture.width)}" height="22" fill="#071F46"/><text x="${Math.max(0, b.x) + 6}" y="${Math.max(15, b.y - 8)}" fill="white" font-family="Arial" font-size="12">${esc(finding.title.slice(0, 45))}</text></svg>`,
  );
  await sharp(original)
    .composite([{ input: overlay }])
    .png()
    .toFile(join(root, "annotated", `${basename}.png`));
  evidence.crop = `/evidence/${run.id}/crops/${basename}.png`;
  evidence.annotation = `/evidence/${run.id}/annotated/${basename}.png`;
  evidence.cropBounds = undefined;
}
