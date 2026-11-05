import { readFile } from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "../companion/audit.mjs";
import { validateDevices, validateProfile } from "../companion/core.mjs";
import { validateFinding } from "../companion/schema.mjs";
import { validatePreference } from "./review-store.mjs";
import { validatePlan } from "./flow-data.mjs";

import { validateMapping } from "./mappings.mjs";

export async function prepareImport(raw, file, store) {
  let preferences = {}, plans = [], reports = [], mappings = [];
  if (raw?.format === "viewport-atlas-workspace") {
    if (raw.version !== 1) throw new Error("Unsupported migration package version.");
    preferences = raw.preferences || {}; plans = raw.flows?.plans || []; reports = raw.reports || []; mappings = raw.mappings || [];
  } else if (Array.isArray(raw) || (raw?.prompt !== undefined && raw?.categories)) preferences["atlas-profiles"] = Array.isArray(raw) ? raw : [raw];
  else if (raw?.schemaVersion === 1 && raw?.findings && raw?.devices) reports = [{ id: raw.id, root: dirname(file) }];
  else if (raw && typeof raw === "object") {
    preferences = Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith("atlas-")));
    plans = raw.atlasFlows?.plans || raw.flows?.plans || [];
    if (!Object.keys(preferences).length && !plans.length && Object.values(raw).every(value => typeof value === "string" && isAbsolute(value))) reports = Object.entries(raw).map(([id, root]) => ({ id, root }));
  } else throw new Error("Choose a Viewport Atlas settings, flow, or report package.");
  if (!preferences || typeof preferences !== "object" || !Array.isArray(plans) || !Array.isArray(reports) || reports.length > 1000) throw new Error("Invalid migration package.");
  for (const [key, value] of Object.entries(preferences)) validatePreference(key, value);
  if (plans.length > 10) throw new Error("A project supports ten saved flows.");
  plans = plans.map(validatePlan);
  if (!Array.isArray(mappings) || mappings.length > 200) throw new Error("A project supports up to 200 counterpart mappings.");
  mappings.forEach(validateMapping);
  const mappingKeys = new Set(mappings.map(mapping => JSON.stringify([mapping.source, mapping.viewId])));
  if (mappingKeys.size !== mappings.length) throw new Error("The import contains duplicate counterpart mappings.");
  mappings = [...store.project.mappings.filter(existing => !mappings.some(m => m.source === existing.source && m.viewId === existing.viewId)), ...mappings];
  if (mappings.length > 200) throw new Error("The merged import exceeds the project's 200 counterpart mapping limit.");
  const loaded = [], errors = [];
  for (const report of reports) {
    try {
      if (!/^[\w-]{1,100}$/.test(report.id) || typeof report.root !== "string" || !isAbsolute(report.root)) throw new Error("Reports require an absolute evidence-folder reference.");
      const run = JSON.parse(await readFile(join(report.root, "run.json"), "utf8"));
      if (run.id !== report.id || run.schemaVersion !== 1 || !Array.isArray(run.findings) || !Array.isArray(run.screenshots)) throw new Error("The evidence folder does not contain the matching report.");
      validateDevices(run.devices); validateProfile(run.profile); run.findings.forEach(validateFinding);
      if (run.status === "running") throw new Error("Wait for this review to finish before importing its evidence. Active reports are not modified by migration.");
      loaded.push({ run, root: report.root });
    } catch (error) { errors.push(`${report.id}: ${error.message}`); }
  }
  if (errors.length) throw new Error(`Import validation failed: ${errors.slice(0, 5).join("; ")}`);
  const existingProfiles = store.preferences["atlas-profiles"] || [];
  const profileKey = profile => JSON.stringify({ ...profile, id: undefined });
  let duplicates = 0;
  const profiles = [...existingProfiles];
  for (const profile of preferences["atlas-profiles"] || []) {
    if (profiles.some(p => profileKey(p) === profileKey(profile))) { duplicates++; continue; }
    profiles.push({ ...profile, id: profiles.some(p => p.id === profile.id) ? randomUUID() : profile.id });
  }
  if (preferences["atlas-profiles"]) preferences["atlas-profiles"] = profiles;
  const flows = [...store.project.flows.plans];
  for (const plan of plans) {
    if (flows.some(p => JSON.stringify({ ...p, id: "" }) === JSON.stringify({ ...plan, id: "" }))) { duplicates++; continue; }
    flows.push({ ...plan, id: flows.some(p => p.id === plan.id) ? randomUUID() : plan.id });
  }
  if (flows.length > 10 || profiles.length > 100) throw new Error("The merged import exceeds the project profile or flow limit.");
  const imports = loaded.filter(({ run, root }) => {
    if (store.project.runIds.includes(run.id)) { duplicates++; return false; }
    if (store.roots.has(run.id) && store.roots.get(run.id) !== root) throw new Error("A report ID is already registered with a different evidence folder.");
    return true;
  });
  if (!Object.keys(preferences).length && !plans.length && !loaded.length) throw new Error("No supported settings, flows, or reports were found in this file.");
  return { token: randomUUID(), projectSnapshot: JSON.stringify(store.project), preferences, flows, mappings, reports: imports,
    counts: { preferences: Object.keys(preferences).length, profiles: profiles.length - existingProfiles.length, flows: flows.length - store.project.flows.plans.length, mappings: mappings.length, reports: imports.length, duplicates } };
}

export async function applyImport(candidate, store) {
  if (candidate.projectSnapshot !== JSON.stringify(store.project)) throw new Error("This project changed after the import preview. Preview the package again before applying it.");
  // Back up the selected project's state. Original reports are only referenced.
  await atomicJson(join(store.directory, `before-import-${Date.now()}.json`), { schemaVersion: 2, project: store.project, reports: Object.fromEntries(store.roots) });
  Object.assign(store.project.preferences, candidate.preferences);
  store.project.flows.plans = candidate.flows;
  store.project.mappings = candidate.mappings;
  store.project.flows.selectedId ||= candidate.flows[0]?.id || "";
  for (const { run, root } of candidate.reports) {
    store.runs.set(run.id, run); store.roots.set(run.id, root); store.project.runIds.push(run.id);
  }
  await store.persist();
  return candidate.counts;
}

export function exportProject(store) {
  return { format: "viewport-atlas-workspace", version: 1, exportedAt: new Date().toISOString(), name: store.project.name,
    preferences: store.preferences, flows: { plans: store.project.flows.plans }, mappings: store.project.mappings,
    reports: store.project.runIds.map(id => ({ id, root: store.roots.get(id) })),
    note: "Browser credentials and cookies are excluded. Report folders are referenced and must remain available; originals are never moved or deleted." };
}
