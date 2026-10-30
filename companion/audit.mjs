import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { getView } from "./browser.mjs";
import {
  mergeFindings,
  compareFindings,
  stableId,
  redactUrl,
  redactText,
} from "./core.mjs";
import { prepareCapture, writeCapture, annotateFinding } from "./capture.mjs";
import { validateFinding } from "./schema.mjs";
import { runCodex } from "./codex.mjs";
import { generatePdf } from "./pdf.mjs";
export function browserFindings(metadata, deviceId, screenshot) {
  const findings = [];
  const add = (rule, title, category, severity, impact, recommendation) =>
    findings.push({
      id: stableId(rule),
      rule,
      title,
      category,
      severity,
      url: redactUrl(metadata.url),
      devices: [deviceId],
      evidence: [
        {
          deviceId,
          screenshot,
          locator: rule === "overflow" ? "html" : "head",
          bounds: null,
        },
      ],
      impact,
      recommendation,
      source: "browser",
      confidence: 1,
      status: "unverified",
    });
  if (!metadata.title?.trim())
    add(
      "document-title",
      "The page is missing a document title",
      "SEO",
      "medium",
      "Visitors and search results cannot clearly identify this page.",
      "Add a descriptive and unique title element.",
    );
  if (!metadata.description?.trim())
    add(
      "meta-description",
      "The page is missing a meta description",
      "SEO",
      "low",
      "Search engines may generate an unintended description.",
      "Write a concise page-specific meta description.",
    );
  if (metadata.h1 !== 1)
    add(
      "heading-one",
      metadata.h1 === 0
        ? "The page has no primary heading"
        : "The page has multiple primary headings",
      "SEO",
      "low",
      "The main topic may be unclear to readers and search engines.",
      "Review the heading structure and identify the primary page topic. Multiple h1 elements may be intentional.",
    );
  if (metadata.overflow)
    add(
      "overflow",
      "Content extends beyond the viewport",
      "UX / UI",
      "medium",
      "Some content may require horizontal scrolling at this viewport width.",
      "Inspect overflowing containers and adjust responsive sizing. Verify whether the overflow is intentional.",
    );
  return findings;
}
export function axeFindings(result, deviceId, screenshot, url, bounds = {}) {
  const severities = {
    critical: "critical",
    serious: "high",
    moderate: "medium",
    minor: "low",
  };
  return result.violations.flatMap((v) =>
    v.nodes.slice(0, 20).map((node) => ({
      id: stableId(v.id, node.target.join(" > ")),
      rule: v.id,
      category: "Accessibility",
      title: v.help,
      severity: severities[v.impact] || "info",
      url: redactUrl(url),
      devices: [deviceId],
      evidence: [
        {
          deviceId,
          screenshot,
          locator: node.target.join(" > "),
          bounds: bounds[node.target.join(" > ")] || null,
        },
      ],
      impact: node.failureSummary || v.description,
      recommendation: `${v.description} Review guidance: ${v.helpUrl}`,
      source: "axe-core",
      confidence: 1,
      status: "unverified",
    })),
  );
}
export async function atomicJson(path, data) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}
const saveQueues = new Map();
export function saveRun(root, run, options = {}) {
  const snapshot = structuredClone(run);
  const previous = saveQueues.get(root) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => saveRunFiles(root, snapshot, options));
  saveQueues.set(root, next);
  next
    .finally(() => {
      if (saveQueues.get(root) === next) saveQueues.delete(root);
    })
    .catch(() => {});
  return next;
}
async function saveRunFiles(root, run, { pdf = true } = {}) {
  for (const check of run.checks || []) check.detail = redactText(check.detail);
  if (run.error) run.error = redactText(run.error);
  await mkdir(root, { recursive: true });
  await atomicJson(join(root, "findings.json"), {
    schemaVersion: 1,
    findings: run.findings,
  });
  await atomicJson(join(root, "profile.json"), run.profile);
  await atomicJson(join(root, "metadata.json"), {
    schemaVersion: 1,
    id: run.id,
    createdAt: run.createdAt,
    url: run.url,
    devices: run.devices,
    checks: run.checks,
    status: run.status,
    engine: "Chromium",
    conditions: run.conditions || [],
  });
  await atomicJson(join(root, "run.json"), run);
  await atomicJson(join(root, "board-export.json"), {
    schemaVersion: 1,
    runId: run.id,
    devices: run.devices,
    screenshots: run.screenshots,
    findings: run.findings.filter((f) => f.status !== "dismissed"),
    note: "Portable evidence data; use the Miro integration to create editable board objects. This is not a native board import format.",
  });
  if (pdf && run.profile.exportPdf) await generatePdf(root, run);
}
export async function performAudit(
  run,
  root,
  { signal, snapshots, previous, onProgress = () => {} } = {},
) {
  const progress = async (message) => {
    run.progress = message;
    await saveRun(root, run, { pdf: false });
    onProgress(run);
  };
  const evidence = [];
  const aiImages = [];
  const diagnostics = [];
  run.conditions = [];
  try {
    await mkdir(root, { recursive: true });
    for (const device of run.devices) {
      signal?.throwIfAborted();
      await progress(
        `Capturing ${device.name} at ${device.width} × ${device.height}…`,
      );
      try {
        let capture;
        let page;
        let axeResult;
        let bounds = {};
        if (snapshots) {
          const s = snapshots.find((s) => s.deviceId === device.id);
          if (!s)
            throw new Error(
              "The extension did not supply evidence for this device.",
            );
          if (
            typeof s.png !== "string" ||
            s.png.length > 30_000_000 ||
            !s.png.startsWith("iVBOR")
          )
            throw new Error("Invalid PNG evidence supplied by extension.");
          capture = {
            buffer: Buffer.from(s.png, "base64"),
            width: s.width,
            height: s.height,
            truncated: s.truncated,
            metadata: s.metadata,
            conditions: s.conditions,
          };
          axeResult = s.axe;
          bounds = s.bounds || {};
        } else {
          page = getView(device.id).page;
          capture = await prepareCapture(page, run.profile, signal);
        }
        const screenshot = await writeCapture(root, run.id, device.id, capture);
        run.screenshots.push(screenshot);
        run.conditions.push({ deviceId: device.id, ...capture.conditions });
        const meta = capture.metadata;
        meta.url = redactUrl(meta.url);
        for (const link of meta.links || []) link.href = redactUrl(link.href);
        evidence.push({
          deviceId: device.id,
          screenshot: screenshot.path,
          metadata: meta,
        });
        aiImages.push(join(root, "screenshots", `${device.id}.png`));
        if (run.title === "Website review" && meta.title)
          run.title = meta.title;
        run.checks.push({
          name: "Screenshot capture",
          status: "completed",
          deviceId: device.id,
          detail: `${capture.width} × ${capture.height} PNG. ${capture.truncated ? "TRUNCATED at 16,000 CSS pixels." : "Capture within configured limits."} Sensitive regions masked. Fonts bounded to 2s; lazy-load preparation bounded to 16 steps; animations disabled. Interactive state recorded in metadata.json.`,
        });
        if (run.profile.categories.includes("Accessibility")) {
          await progress(`Checking accessibility on ${device.name}…`);
          try {
            if (!axeResult) {
              let builder = new AxeBuilder({ page }).withTags([
                "wcag2a",
                "wcag2aa",
                "wcag21a",
                "wcag21aa",
                "best-practice",
              ]);
              const masks = run.profile.masks?.trim();
              if (masks) builder = builder.exclude(masks);
              axeResult = await builder.analyze();
              for (const violation of axeResult.violations) {
                for (const node of violation.nodes.slice(0, 20)) {
                  try {
                    const locator = page.locator(node.target.join(" ")).first();
                    const b = await locator.evaluate((el) => {
                      const r = el.getBoundingClientRect();
                      return {
                        x: r.x + scrollX,
                        y: r.y + scrollY,
                        width: r.width,
                        height: r.height,
                      };
                    });
                    if (!run.profile.fullPage) {
                      const origin = capture.conditions.initialScroll;
                      b.x -= origin.x;
                      b.y -= origin.y;
                    }
                    bounds[node.target.join(" > ")] = b;
                  } catch {}
                }
              }
            }
            run.findings.push(
              ...axeFindings(
                axeResult,
                device.id,
                screenshot.path,
                meta.url,
                bounds,
              ),
            );
            run.checks.push({
              name: "axe-core accessibility",
              status: "completed",
              deviceId: device.id,
              detail: `axe-core ${axeResult.testEngine?.version || "4.x"}: ${axeResult.violations.length} violated rules, ${axeResult.passes?.length || 0} passed rules, ${axeResult.incomplete?.length || 0} checks need manual verification. At most 20 element findings per rule. Automated testing does not establish compliance.`,
            });
            if (axeResult.incomplete?.length)
              run.checks.push({
                name: "Manual accessibility verification",
                status: "manual_required",
                deviceId: device.id,
                detail: axeResult.incomplete
                  .map((v) => v.help)
                  .slice(0, 20)
                  .join("; "),
              });
          } catch (e) {
            run.checks.push({
              name: "axe-core accessibility",
              status: "failed",
              deviceId: device.id,
              detail: e.message,
            });
          }
        }
        const technical = browserFindings(
          meta,
          device.id,
          screenshot.path,
        ).filter((f) => run.profile.categories.includes(f.category));
        run.findings.push(...technical);
        if (run.profile.categories.includes("SEO"))
          run.checks.push({
            name: "Page metadata",
            status: "completed",
            deviceId: device.id,
            detail:
              "Inspected document title, meta description, and primary heading count. This is a limited browser check, not a Lighthouse SEO score.",
          });
        if (run.profile.categories.includes("Performance"))
          run.checks.push({
            name: "Navigation timings",
            status: "completed",
            deviceId: device.id,
            detail: meta.timing?.length
              ? meta.timing
                  .map(
                    (t) =>
                      `Observed navigation: response ${t.responseMs}ms, DOMContentLoaded ${t.domContentLoadedMs}ms, load ${t.loadMs}ms. Existing navigation; uncontrolled network and cache; no score.`,
                  )
                  .join(" ")
              : "Navigation timing unavailable for this document; no performance score produced.",
          });
      } catch (e) {
        if (signal?.aborted) throw e;
        run.checks.push({
          name: "Device capture and checks",
          status: "failed",
          deviceId: device.id,
          detail: e.message,
        });
        diagnostics.push({ deviceId: device.id, error: e.message });
      }
    }
    run.findings = mergeFindings(run.findings);
    signal?.throwIfAborted();
    if (
      run.profile.categories.some((c) =>
        ["Performance", "SEO", "Best practices"].includes(c),
      )
    )
      run.checks.push({
        name: "Lighthouse",
        status: "not_run",
        detail:
          "Lighthouse is not integrated with the active capture session. No performance, SEO, or best-practices score was produced. Existing browser timings are diagnostic observations only.",
      });
    if (run.profile.categories.includes("Best practices"))
      run.checks.push({
        name: "Browser best practices",
        status: "manual_required",
        detail:
          "Security, privacy, dependency hygiene, and journey-level behavior need additional review. This run does not substitute a Lighthouse best-practices audit.",
      });
    if (run.profile.ai && run.screenshots.length) {
      await progress("Analyzing masked evidence with Codex…");
      try {
        const result = await runCodex(run, evidence, aiImages, signal);
        for (const f of result.findings) {
          if (
            !run.profile.categories.includes(f.category) ||
            f.devices.some((id) => !run.devices.some((d) => d.id === id))
          )
            continue;
          f.url = redactUrl(run.url);
          f.id = stableId(
            "codex",
            f.category,
            f.title,
            f.evidence[0]?.locator || "",
          );
          for (const ev of f.evidence) {
            const shot = run.screenshots.find(
              (s) => s.deviceId === ev.deviceId,
            );
            if (!shot)
              throw new Error("Codex referenced a device without evidence.");
            ev.screenshot = shot.path;
          }
          validateFinding(f);
          run.findings.push(f);
        }
        run.summary = result.summary;
        run.checks.push({
          name: "Codex analysis",
          status: "completed",
          detail:
            "AI judgments from masked screenshots, minimized metadata, and automated findings. Structured output validated against schema v1. All AI findings require verification.",
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        run.checks.push({
          name: "Codex analysis",
          status: "failed",
          detail: e.message,
        });
      }
    } else
      run.checks.push({
        name: "Codex analysis",
        status: "not_run",
        detail: run.profile.ai
          ? "No screenshots available; AI analysis skipped."
          : "AI analysis was disabled. No evidence was sent to Codex.",
      });
    if (run.profile.categories.includes("UX / UI") && !run.profile.ai)
      run.checks.push({
        name: "UX / UI review",
        status: "manual_required",
        detail:
          "Browser overflow checks were performed. Qualitative UX judgments require manual review or opt-in Codex analysis.",
      });
    for (const f of run.findings) {
      validateFinding(f);
      for (let i = 0; i < f.evidence.length; i++)
        try {
          await annotateFinding(root, run, f, f.evidence[i], i);
        } catch (e) {
          diagnostics.push({
            findingId: f.id,
            error: `Annotation unavailable: ${e.message}`,
          });
        }
    }
    if (previous && !run.checks.some((check) => check.status === "failed"))
      run.comparison = compareFindings(previous.findings, run.findings);
    run.status = run.screenshots.length ? "completed" : "failed";
    if (!run.screenshots.length)
      run.error =
        "No device evidence could be captured. Review failed checks and reconnect your views.";
    run.progress = "Review ready.";
  } catch (e) {
    run.status = signal?.aborted ? "cancelled" : "failed";
    run.error = signal?.aborted
      ? "Audit cancelled. Captured evidence and partial findings were retained."
      : e.message;
    run.progress = run.error;
  }
  await atomicJson(join(root, "diagnostics.json"), {
    schemaVersion: 1,
    diagnostics: diagnostics.map((item) => ({
      ...item,
      error: redactText(item.error),
    })),
  });
  await saveRun(root, run);
  return run;
}
