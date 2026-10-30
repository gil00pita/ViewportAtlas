import { join } from "node:path";
import sharp from "sharp";

// A single canvas keeps every captured screen intact when imported into a board.
export async function renderOriginalPdf(doc, root, run) {
  const margin = 32, gap = 32, notesWidth = 560;
  const deviceNames = new Map(run.devices.map((device) => [device.id, device.name]));
  const screens = [];
  for (const screenshot of run.screenshots) {
    const file = join(root, "screenshots", `${screenshot.deviceId}.png`);
    let info;
    try { info = await sharp(file).metadata(); } catch {}
    const density = screenshot.deviceScaleFactor ?? 1;
    screens.push({
      ...screenshot, file: info ? file : null,
      width: info ? info.width / density : screenshot.width,
      height: info ? info.height / density : screenshot.height,
    });
  }
  const screenWidth = screens.reduce((total, screen) => total + Math.max(240, screen.width) + gap, 0);
  const width = margin * 2 + screenWidth + notesWidth;
  const measure = (value, size, textWidth, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    return doc.heightOfString(String(value || ""), { width: textWidth, lineGap: 4 });
  };
  const header = [
    { text: run.title || "Website audit", size: 28, bold: true },
    { text: run.url, size: 14 },
    { text: `${new Date(run.createdAt).toLocaleString()} | ${run.profile.name} | ${run.status}`, size: 12 },
  ];
  let headerBottom = margin;
  for (const block of header) {
    block.y = headerBottom;
    block.height = measure(block.text, block.size, width - margin * 2, block.bold);
    headerBottom += block.height + 8;
  }
  for (const screen of screens) {
    const textWidth = Math.max(240, screen.width);
    screen.label = deviceNames.get(screen.deviceId) || screen.deviceId;
    screen.labelHeight = measure(screen.label, 18, textWidth, true);
    screen.caption = `${screen.width} x ${screen.height} CSS px${screen.truncated ? " | Capture truncated" : ""}`;
    screen.captionHeight = measure(screen.caption, 12, textWidth);
  }
  const imageY = headerBottom + 48 + Math.max(0, ...screens.map((screen) => screen.labelHeight + screen.captionHeight + 8));
  const notes = [];
  let notesBottom = headerBottom + 24;
  const addNote = (text, size = 14, bold = false, gapAfter = 12) => {
    const height = measure(text, size, notesWidth, bold);
    notes.push({ text, size, bold, height, y: notesBottom });
    notesBottom += height + gapAfter;
  };
  const active = run.findings.filter((finding) => finding.status !== "dismissed");
  addNote("Audit findings", 22, true, 16);
  addNote(run.summary || `${active.length} findings across ${screens.length} captured screens.`);
  if (!screens.length) addNote("No screenshots were captured for this audit.");
  if (run.error) addNote(`Run limitation: ${run.error}`);
  if (run.comparison) addNote(`${run.comparison.new.length} new; ${run.comparison.resolved.length} resolved; ${run.comparison.recurring.length} recurring findings.`);
  const priorities = ["critical", "high", "medium", "low", "info"];
  for (const finding of [...active].sort((a, b) => priorities.indexOf(a.severity) - priorities.indexOf(b.severity))) {
    addNote(finding.source === "codex" ? "Codex" : finding.source === "manual" ? "Manual observation" : `Automated check: ${finding.source}`, 12, true, 6);
    const priority = finding.severity === "info" ? "info" : finding.severity[0].toUpperCase() + finding.severity.slice(1);
    addNote(`Priority: ${priority}`, 14, true, 6);
    addNote(`Issue: ${finding.title}`, 16, true, 8);
    addNote(`Impact: ${finding.impact}`);
    addNote(`Recommendation: ${finding.recommendation}`);
    addNote(`${finding.category} | ${finding.devices.map((id) => deviceNames.get(id) || id).join(", ")} | ${finding.status}`, 12, false, 28);
  }
  if (!active.length) addNote("No active findings. Automated checks do not establish that a page has no defects or meets accessibility requirements.");
  addNote("Methods and limitations", 18, true, 16);
  for (const check of run.checks) {
    addNote(`${check.name}${check.deviceId ? ` (${deviceNames.get(check.deviceId) || check.deviceId})` : ""}: ${check.status.replaceAll("_", " ")}`, 12, true, 4);
    addNote(check.detail, 12);
  }
  addNote("Chromium viewport emulation is not real-device or cross-engine testing. AI judgments require verification. Screenshots remain raster images; PDF text stays selectable. For editable board objects, use Export to Miro.", 12);
  const height = Math.max(imageY + Math.max(0, ...screens.map((screen) => screen.height)), notesBottom) + margin + 28;
  // Stay within the common PDF page-size limit, preserving every embedded pixel.
  const scale = Math.min(1, 14000 / width, 14000 / height);
  doc.addPage({ size: [width * scale, height * scale], margin: 0 });
  doc.save().scale(scale);
  doc.rect(0, 0, width, height).fill("#FFFFFF");
  const drawText = (block, x, textWidth, color = "#071F46") => {
    doc.font(block.bold ? "Helvetica-Bold" : "Helvetica").fontSize(block.size).fillColor(color)
      .text(String(block.text || ""), x, block.y, { width: textWidth, height: block.height + 2, lineGap: 4 });
  };
  for (const block of header) drawText(block, margin, width - margin * 2);
  let x = margin;
  for (const screen of screens) {
    const columnWidth = Math.max(240, screen.width);
    drawText({ text: screen.label, size: 18, bold: true, y: headerBottom + 24, height: screen.labelHeight }, x, columnWidth);
    drawText({ text: screen.caption, size: 12, y: headerBottom + 32 + screen.labelHeight, height: screen.captionHeight }, x, columnWidth, "#627672");
    if (screen.file) doc.image(screen.file, x, imageY, { width: screen.width, height: screen.height });
    else drawText({ text: "Screenshot unavailable", size: 14, y: imageY + 16, height: 40 }, x, columnWidth);
    x += columnWidth + gap;
  }
  for (const block of notes) drawText(block, x, notesWidth);
  drawText({ text: `Viewport Atlas | ${run.id} | Original layout`, size: 10, y: height - margin, height: 18 }, margin, width - margin * 2, "#627672");
  doc.restore();
}
