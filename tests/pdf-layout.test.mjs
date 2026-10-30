import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { generatePdf } from "../companion/pdf.mjs";

// Inspect PDFKit's page dictionaries and drawing streams, including placement.
async function inspectPdf(path) {
  const source = (await readFile(path)).toString("latin1");
  const objects = new Map([...source.matchAll(/(\d+) 0 obj\s*([\s\S]*?)\nendobj/g)].map((match) => [match[1], match[2]]));
  const images = [...objects.values()].filter((body) => /\/Subtype \/Image\b/.test(body) && !body.includes("/ColorSpace /DeviceGray"));
  const pages = [...objects.values()].filter((body) => /\/Type \/Page\b/.test(body)).map((body) => {
    const box = body.match(/\/MediaBox \[([\d. ]+)\]/)[1].split(" ").map(Number);
    const content = objects.get(body.match(/\/Contents (\d+) 0 R/)[1]);
    const stream = content.match(/stream\n([\s\S]*?)\nendstream/)[1];
    const drawing = inflateSync(Buffer.from(stream, "latin1")).toString();
    const placements = [...drawing.matchAll(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/I\d+ Do/g)].map((match) => ({
      width: +match[1], height: +match[2], x: +match[3], bottom: +match[4],
    }));
    return { width: box[2], height: box[3], placements, drawing };
  });
  return { pages, images };
}

const fixture = () => ({
  id: "layout-fixture", title: "Layout verification", url: "https://example.com/", createdAt: "2026-10-30T12:00:00Z",
  profile: { name: "Test" }, status: "completed", findings: [], checks: [],
  devices: [
    { id: "phone", name: "Phone", width: 393, height: 852 },
    { id: "desktop", name: "Desktop", width: 1440, height: 900 },
  ],
  screenshots: [
    { deviceId: "phone", width: 393, height: 16000, deviceScaleFactor: 2, truncated: true },
    { deviceId: "desktop", width: 1440, height: 900, deviceScaleFactor: 2 },
  ],
});

test("Original defaults to one canvas with full-resolution, uncropped screenshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-pdf-layout-"));
  try {
    const run = fixture();
    await mkdir(join(root, "screenshots"));
    for (const screen of run.screenshots) await sharp({ create: {
      width: screen.width * 2, height: screen.height * 2, channels: 3, background: "#e4efea",
    } }).png().toFile(join(root, "screenshots", `${screen.deviceId}.png`));
    const original = await inspectPdf(await generatePdf(root, run));
    assert.equal(original.pages.length, 1);
    const page = original.pages[0];
    assert(page.width > 595.28);
    assert(page.height <= 14000 && page.width <= 14000);
    assert.equal(page.placements.length, 2);
    assert.deepEqual(page.placements.map((image) => [image.width, image.height]), [[393, 16000], [1440, 900]]);
    assert(page.placements[1].x > page.placements[0].x + page.placements[0].width);
    assert.equal(original.images.length, 2);
    assert(original.images.some((image) => /\/Width 786\b/.test(image) && /\/Height 32000\b/.test(image)));
    assert(original.images.some((image) => /\/Width 2880\b/.test(image) && /\/Height 1800\b/.test(image)));
    assert(!/\bW\*?\s+n\b/.test(page.drawing), "Screenshots must not use clipping paths");

    const a4Path = await generatePdf(root, run, "a4");
    assert.equal(a4Path, join(root, "report-a4.pdf"));
    const a4 = await inspectPdf(a4Path);
    assert(a4.pages.every((p) => p.width === 595.28 && p.height === 841.89));
    const screenPages = a4.pages.filter((p) => p.placements.length);
    assert.equal(screenPages.length, 2);
    assert.equal(a4.images.length, 2, "Full screenshots must not be tiled or cropped");
    for (const [index, screenPage] of screenPages.entries()) {
      assert.equal(screenPage.placements.length, 1);
      const image = screenPage.placements[0];
      const capture = run.screenshots[index];
      assert(Math.abs(image.width / image.height - capture.width / capture.height) < 0.00001);
      assert(image.x >= 46 && image.x + image.width <= screenPage.width - 45.99);
      assert(image.bottom - image.height >= 46 && image.bottom <= screenPage.height - 46);
      assert(!/\bW\*?\s+n\b/.test(screenPage.drawing));
    }
    assert.equal((await inspectPdf(join(root, "report.pdf"))).pages.length, 1, "A4 export must not overwrite Original");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Original handles missing screenshots and long findings without clipping or extra pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-pdf-notes-"));
  try {
    const run = fixture();
    run.devices[0].name = "Custom viewport with a long descriptive name that wraps across several lines";
    run.findings = Array.from({ length: 12 }, (_, index) => ({
      severity: "high", title: `Issue ${index}`, impact: "Observable impact on the current page. ".repeat(20),
      recommendation: "Keep the action visible. ".repeat(20), source: "codex", category: "UX / UI", devices: ["phone"], status: "unverified",
    }));
    const result = await inspectPdf(await generatePdf(root, run));
    assert.equal(result.pages.length, 1);
    assert.equal(result.images.length, 0);
    assert(result.pages[0].height <= 14000);
    run.screenshots = [];
    assert.equal((await inspectPdf(await generatePdf(root, run))).pages.length, 1);
    await assert.rejects(generatePdf(root, run, "letter"), /Choose Original or A4/);
    await assert.rejects(generatePdf(join(root, "missing"), run), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
