import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, saveRun } from "../companion/audit.mjs";
import { validateDevices, validateProfile } from "../companion/core.mjs";
import { randomUUID } from "node:crypto";
import { interruptedFlows } from "./flow-data.mjs";
import { validateMapping } from "./mappings.mjs";

const keys = new Set(["atlas-theme", "atlas-devices", "atlas-device-sets", "atlas-profiles", "atlas-profile-id", "atlas-url", "atlas-sync", "atlas-audit-mode"]);
export function validatePreference(key, value) {
  if (!keys.has(key) || JSON.stringify(value)?.length > 500000) throw new Error("Unsupported workspace preference.");
  if (key === "atlas-devices") validateDevices(value);
  if (key === "atlas-profiles") {
    if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Choose between 1 and 100 profiles.");
    const ids = new Set();
    for (const profile of value) {
      validateProfile(profile);
      if (typeof profile.id !== "string" || !profile.id || ids.has(profile.id) || !Array.isArray(profile.devices)) throw new Error("Profiles require unique IDs and a device selection.");
      ids.add(profile.id);
    }
  }
  if (key === "atlas-device-sets") {
    if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid device sets.");
    for (const set of value) {
      if (typeof set.name !== "string" || set.name.length > 100) throw new Error("Invalid device set name.");
      validateDevices(set.devices);
    }
  }
  if (["atlas-profile-id", "atlas-url"].includes(key) && (typeof value !== "string" || value.length > 4096)) throw new Error("Invalid workspace preference.");
  if (key === "atlas-theme" && !["light", "dark"].includes(value)) throw new Error("Invalid theme.");
  if (key === "atlas-audit-mode" && !["page", "flow"].includes(value)) throw new Error("Invalid audit mode.");
  if (key === "atlas-sync" && (!value || !["navigation", "clicks", "scrolling", "forms"].every((k) => typeof value[k] === "boolean"))) throw new Error("Invalid synchronization preferences.");
  return value;
}

export class ReviewStore {
  constructor(directory) {
    this.directory = directory;
    this.projects = [{ id: "default", name: "My workspace", temporary: false, preferences: {}, runIds: [], mappings: [], flows: interruptedFlows() }];
    this.selectedId = "default";
    this.runs = new Map();
    this.roots = new Map();
    this.queue = Promise.resolve();
    this.warnings = [];
    this.pendingWrites = 0;
  }
  get project() { return this.projects.find(p => p.id === this.selectedId); }
  get preferences() { return this.project.preferences; }
  summary() { return { selectedId: this.selectedId, projects: this.projects.map(({ id, name, temporary }) => ({ id, name, temporary })), unavailableReports: this.warnings.filter(warning => this.project.runIds.includes(warning.id)) }; }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(join(this.directory, "workspace.json"), "utf8"));
      if (data.schemaVersion === 1 && data.preferences && data.runs) {
        await atomicJson(join(this.directory, "workspace-v1-backup.json"), data);
        this.project.preferences = data.preferences;
        this.project.runIds = Object.keys(data.runs);
      } else if (data.schemaVersion === 2 && Array.isArray(data.projects) && data.projects.length && data.projects.length <= 100) {
        const ids = new Set();
        for (const project of data.projects) {
          if (!/^[\w-]{1,80}$/.test(project.id) || ids.has(project.id) || typeof project.name !== "string" || !project.name.trim() || project.name.length > 100 || !project.preferences || !Array.isArray(project.runIds)) throw new Error("Invalid project data.");
          ids.add(project.id);
          project.flows = interruptedFlows(project.flows);
          project.mappings ||= [];
          if (!Array.isArray(project.mappings) || project.mappings.length > 200 || typeof project.temporary !== "boolean") throw new Error("Invalid project session data.");
          project.mappings.forEach(validateMapping);
        }
        this.projects = data.projects;
        this.selectedId = this.projects.some(p => p.id === data.selectedId) ? data.selectedId : this.projects[0].id;
      } else throw new Error("Unsupported desktop workspace data.");
      for (const project of this.projects) for (const [key, value] of Object.entries(project.preferences)) validatePreference(key, value);
      for (const [id, root] of Object.entries(data.runs)) {
        if (typeof root !== "string") throw new Error("Invalid report registry.");
        this.roots.set(id, root);
        try {
          const run = JSON.parse(await readFile(join(root, "run.json"), "utf8"));
          if (run.id !== id || run.schemaVersion !== 1) continue;
          if (run.status === "running") {
            run.status = "failed";
            run.error = "The app stopped during this audit. Partial evidence was retained. Start a new audit to retry.";
            run.progress = run.error;
            await saveRun(root, run, { pdf: false });
          }
          this.runs.set(id, run);
        } catch (error) {
          this.warnings.push({ id, detail: "This saved report folder is unavailable. Reconnect its drive or restore the folder, then reopen the app." });
          if (error.code !== "ENOENT") console.error("Could not restore report", id, error.message);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.persist();
    return this;
  }
  persist() {
    const data = { schemaVersion: 2, projects: structuredClone(this.projects), selectedId: this.selectedId, runs: Object.fromEntries(this.roots) };
    this.pendingWrites++;
    const next = this.queue.catch(() => {}).then(() => atomicJson(join(this.directory, "workspace.json"), data)).finally(() => { this.pendingWrites--; });
    this.queue = next;
    return next;
  }
  async setPreference(key, value) {
    validatePreference(key, value);
    this.preferences[key] = structuredClone(value);
    await this.persist();
  }
  async register(run, root) {
    await saveRun(root, run, { pdf: false });
    this.runs.set(run.id, run);
    this.roots.set(run.id, root);
    if (!this.project.runIds.includes(run.id)) this.project.runIds.push(run.id);
    await this.persist();
  }
  get(id) {
    const run = this.runs.get(id);
    if (!run || !this.project.runIds.includes(id)) throw new Error("Audit not found in this project.");
    return run;
  }
  history() {
    return [...this.runs.values()].filter(run => this.project.runIds.includes(run.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ codexOutput, ...run }) => run);
  }
  async createProject(name, temporary = false) {
    if (typeof name !== "string" || !name.trim() || name.length > 100 || typeof temporary !== "boolean" || this.projects.length >= 100) throw new Error("Choose a project name up to 100 characters (maximum 100 projects).");
    const project = { id: randomUUID(), name: name.trim(), temporary, preferences: structuredClone(this.preferences), runIds: [], mappings: [], flows: interruptedFlows() };
    this.projects.push(project); this.selectedId = project.id;
    await this.persist();
    return project;
  }
  async selectProject(id) {
    if (!this.projects.some(p => p.id === id)) throw new Error("Project not found.");
    this.selectedId = id; await this.persist();
  }
}
