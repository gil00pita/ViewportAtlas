import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { access, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { renderOriginalPdf } from "./pdf-original.mjs";
const COLORS = {
  navy: "#071F46",
  teal: "#008B7E",
  muted: "#627672",
  line: "#E0E8E5",
};
export async function generatePdf(root, run, layout = "original") {
  if (!["original", "a4"].includes(layout)) throw new Error("Choose Original or A4 for the PDF layout.");
  const output = join(root, layout === "a4" ? "report-a4.pdf" : "report.pdf");
  const doc = new PDFDocument({
    size: "A4",
    margin: 46,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: `Viewport Atlas — ${run.title}`, Author: "Viewport Atlas" },
  });
  const temporary = join(root, `.report-${randomUUID()}.pdf`);
  const paintPage = () => {
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#FFFFFF");
    doc.restore();
  };
  doc.on("pageAdded", paintPage);
  const stream = createWriteStream(temporary);
  doc.pipe(stream);
  const done = new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
  });
  // A write failure can arrive while screenshot metadata is still being read.
  done.catch(() => {});
  try {
    if (layout === "original") await renderOriginalPdf(doc, root, run);
    else {
      doc.addPage();
      await renderA4Pdf(doc, root, run);
    }
    doc.end();
    await done;
    await rename(temporary, output);
    return output;
  } catch (error) {
    doc.destroy();
    stream.destroy(error);
    await done.catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

async function renderA4Pdf(doc, root, run) {
  const line = () => {
    doc.moveDown(0.5);
    doc.strokeColor(COLORS.line).moveTo(46, doc.y).lineTo(549, doc.y).stroke();
    doc.moveDown(0.8);
  };
  const text = (s, size = 10, color = COLORS.navy) => {
    doc
      .fillColor(color)
      .fontSize(size)
      .font("Helvetica")
      .text(String(s || ""), { lineGap: 4 });
  };
  const heading = (s) => {
    if (doc.y > 690) doc.addPage();
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fillColor(COLORS.navy).fontSize(15).text(s);
    doc.moveDown(0.5);
  };
  doc
    .fillColor(COLORS.teal)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("VIEWPORT ATLAS");
  doc.moveDown(1);
  doc
    .fillColor(COLORS.navy)
    .fontSize(30)
    .text("Every screen.\nOne clear picture.", { lineGap: 5 });
  doc.moveDown(0.8);
  text(run.title, 16);
  doc.moveDown(0.4);
  text(run.url, 10, COLORS.muted);
  text(new Date(run.createdAt).toLocaleString(), 9, COLORS.muted);
  text(`Profile: ${run.profile.name} | Status: ${run.status}`, 9, COLORS.muted);
  line();
  heading("Executive summary");
  const active = run.findings.filter((f) => f.status !== "dismissed");
  text(
    run.summary ||
      `${active.length} findings were recorded across ${run.devices.length} Chromium viewport${run.devices.length === 1 ? "" : "s"}. ${active.filter((f) => ["critical", "high"].includes(f.severity)).length} findings have high or critical priority. Review the methods and limitations before drawing conclusions.`,
  );
  if (run.error) text(`Run limitation: ${run.error}`, 10, "#A65B35");
  heading("Selected views");
  for (const d of run.devices) {
    const scale =
      run.screenshots.find((s) => s.deviceId === d.id)?.deviceScaleFactor ?? 1;
    text(
      `${d.name} — ${d.width} x ${d.height} CSS pixels; device scale factor ${scale}`,
      10,
      COLORS.muted,
    );
  }
  if (run.comparison) {
    heading("Changes since the previous review");
    text(
      `${run.comparison.new.length} new; ${run.comparison.resolved.length} resolved; ${run.comparison.recurring.length} recurring findings. Comparisons use stable rule-and-locator identifiers, for matching URL and audit scope.`,
    );
  }
  heading("Prioritized findings");
  const order = ["critical", "high", "medium", "low", "info"];
  for (const f of [...active].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  )) {
    if (doc.y > 620) doc.addPage();
    doc.moveDown(0.6);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(COLORS.navy)
      .text(`Priority: ${f.severity === "info" ? "info" : f.severity[0].toUpperCase() + f.severity.slice(1)}`);
    text(`Issue: ${f.title}`, 12);
    doc.moveDown(0.3);
    text(
      `${f.category} | ${f.source === "codex" ? "Codex" : f.source === "manual" ? "Manual observation" : `Automated check: ${f.source}`} | ${f.status} | confidence ${Math.round(f.confidence * 100)}%`,
      8,
      COLORS.muted,
    );
    text(
      `Views: ${f.devices.map((id) => run.devices.find((d) => d.id === id)?.name || id).join(", ")}`,
      8,
      COLORS.muted,
    );
    doc.moveDown(0.3);
    text(`Impact: ${f.impact}`);
    text(`Recommendation: ${f.recommendation}`);
    for (const ev of f.evidence) {
      if (ev.crop) {
        const file = join(root, ...ev.crop.split("/").slice(3));
        try {
          await access(file);
          const info = await sharp(file).metadata();
          const imageWidth = Math.min(480, info.width);
          const imageHeight = (imageWidth * info.height) / info.width;
          const boxHeight = Math.min(220, imageHeight);
          if (doc.y + boxHeight + 45 > 760) doc.addPage();
          doc.moveDown(0.5);
          text(
            `${ev.deviceId} | ${ev.locator || "Page evidence"} | captured bounds ${JSON.stringify(ev.bounds)}`,
            8,
            COLORS.muted,
          );
          doc.image(file, 46, doc.y, { fit: [480, 220] });
          doc.y += boxHeight + 12;
        } catch {
          text(
            "Evidence crop unavailable; consult the original screenshot.",
            9,
            COLORS.muted,
          );
        }
      }
    }
    line();
  }
  if (!active.length)
    text(
      "No active findings. This does not establish that the page has no defects or meets accessibility requirements.",
    );
  for (const screenshot of run.screenshots) {
    const scale = screenshot.deviceScaleFactor ?? 1;
    doc.addPage();
    heading(
      `${run.devices.find((d) => d.id === screenshot.deviceId)?.name || screenshot.deviceId} - captured screen`,
    );
    text(
      `${screenshot.width * scale} x ${screenshot.height * scale} PNG pixels at ${scale}x (${screenshot.width} x ${screenshot.height} CSS pixels)${screenshot.truncated ? " | TRUNCATED at capture limit" : ""}. Entire capture fitted to this page.`,
      9,
      COLORS.muted,
    );
    const path = join(root, "screenshots", `${screenshot.deviceId}.png`);
    try {
      const imageY = doc.y + 12;
      doc.image(path, 46, imageY, { fit: [doc.page.width - 92, doc.page.height - imageY - 64] });
    } catch {
      text("Screenshot is not available.", 10, COLORS.muted);
    }
  }
  doc.addPage();
  heading("Audit methods, conditions, and limitations");
  for (const c of run.checks) {
    if (doc.y > 680) doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fillColor(COLORS.navy)
      .fontSize(10)
      .text(
        `${c.name}${c.deviceId ? ` (${c.deviceId})` : ""}: ${c.status.replaceAll("_", " ")}`,
      );
    doc.moveDown(0.2);
    text(c.detail, 9, COLORS.muted);
    doc.moveDown(0.6);
  }
  text(
    "Chromium viewport emulation is not real-device or cross-engine testing. Automated checks do not establish full accessibility compliance. Timings are observed browser navigation timings, not Lighthouse scores or controlled performance benchmarks. AI judgments and manual observations require verification. Prepared interactive states may be changed by lazy-load preparation. Sticky elements, nested scrolling, and infinite pages may not be captured completely. Sensitive fields and configured selectors are masked; review evidence before external sharing.",
    9,
    COLORS.muted,
  );
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#8B9995")
      .text(
        `Viewport Atlas | ${run.id.slice(0, 10)} | ${i + 1} / ${pages.count}`,
        46,
        806,
        { lineBreak: false },
      );
    doc.restore();
  }
}
