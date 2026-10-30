import { createHash, randomUUID } from "node:crypto";
import { resolve, isAbsolute, relative, sep } from "node:path";
export const CATEGORIES = [
  "Accessibility",
  "Performance",
  "UX / UI",
  "SEO",
  "Best practices",
];
export function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete http:// or https:// address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only HTTP and HTTPS URLs without embedded credentials are supported.",
    );
  return url.href;
}
export function validateDevices(devices) {
  if (!Array.isArray(devices) || !devices.length || devices.length > 8)
    throw new Error("Choose between 1 and 8 devices.");
  const ids = new Set();
  for (const d of devices) {
    if (
      !/^[a-zA-Z0-9_-]{1,60}$/.test(d.id) ||
      ids.has(d.id) ||
      typeof d.name !== "string" ||
      d.name.length > 100 ||
      !Number.isInteger(d.width) ||
      !Number.isInteger(d.height) ||
      d.width < 280 ||
      d.width > 3840 ||
      d.height < 320 ||
      d.height > 2160
    )
      throw new Error(
        "Devices need unique IDs, widths from 280–3840, and heights from 320–2160.",
      );
    ids.add(d.id);
  }
  return devices;
}
export function safePath(root, file) {
  const path = resolve(root, file);
  const rel = relative(resolve(root), path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Path is outside the output folder.");
  return path;
}
export function stableId(...parts) {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}
export function mergeFindings(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = stableId(
      f.category,
      f.rule || f.title,
      f.evidence?.[0]?.locator || "",
    );
    const existing = map.get(key);
    if (existing) {
      existing.devices = [...new Set([...existing.devices, ...f.devices])];
      existing.evidence.push(...f.evidence);
    } else
      map.set(key, {
        ...f,
        id: key,
        devices: [...f.devices],
        evidence: [...f.evidence],
      });
  }
  return [...map.values()];
}
export function compareFindings(before, after) {
  const old = new Set(
    before
      .filter((f) => f.status !== "dismissed" && f.source !== "manual")
      .map((f) => f.id),
  );
  const current = new Set(
    after
      .filter((f) => f.status !== "dismissed" && f.source !== "manual")
      .map((f) => f.id),
  );
  return {
    new: [...current].filter((x) => !old.has(x)),
    resolved: [...old].filter((x) => !current.has(x)),
    recurring: [...current].filter((x) => old.has(x)),
  };
}
export function newRun(url, devices, profile) {
  return {
    schemaVersion: 1,
    id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    url,
    title: "Website review",
    createdAt: new Date().toISOString(),
    status: "running",
    progress: "Preparing selected views…",
    devices,
    profile,
    findings: [],
    checks: [],
    screenshots: [],
    summary: "",
  };
}
export function validateProfile(profile) {
  if (
    !profile ||
    typeof profile.name !== "string" ||
    typeof profile.prompt !== "string" ||
    profile.prompt.length > 16000 ||
    !Array.isArray(profile.categories) ||
    !profile.categories.every((x) => CATEGORIES.includes(x)) ||
    typeof profile.ai !== "boolean" ||
    (profile.liveCodexOutput !== undefined && typeof profile.liveCodexOutput !== "boolean") ||
    (profile.includePageCode !== undefined && typeof profile.includePageCode !== "boolean") ||
    typeof profile.fullPage !== "boolean" ||
    typeof profile.masks !== "string" ||
    profile.masks.length > 4000
  )
    throw new Error("Invalid audit profile.");
  return profile;
}
export function redactUrl(value) {
  try {
    const u = new URL(value);
    u.username = "";
    u.password = "";
    for (const key of [...u.searchParams.keys()])
      if (/token|auth|key|secret|password|session|code/i.test(key))
        u.searchParams.set(key, "[REDACTED]");
    return u.href;
  } catch {
    return "[invalid URL]";
  }
}

export function redactText(value) {
  return String(value).replace(/https?:\/\/[^\s<>"']+/g, redactUrl);
}
