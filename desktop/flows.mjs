import { randomUUID } from "node:crypto";
import { flowUrl, FLOW_MAX_STEPS, FLOW_MAX_SCREENS } from "../companion/flow-contract.mjs";
import { flowPageState } from "../companion/flow-page.mjs";
import { validatePlan } from "./flow-data.mjs";
import { validateDevices, validateProfile } from "../companion/core.mjs";

export class DesktopFlows {
  constructor({ store, browser, review }) { Object.assign(this, { store, browser, review }); this.events = Promise.resolve(); }
  get state() { return this.store.project.flows; }
  get running() { return this.state.job?.status === "running"; }
  get recording() { return Boolean(this.state.recording); }
  get plan() { return this.state.plans.find(p => p.id === this.state.selectedId); }
  persist() { return this.store.persist(); }
  append(step) {
    if (!this.plan || this.plan.steps.length >= FLOW_MAX_STEPS) throw new Error(`A flow supports ${FLOW_MAX_STEPS} steps.`);
    if (step.type === "checkpoint" && this.plan.steps.filter(s => s.type === "checkpoint").length >= FLOW_MAX_SCREENS) throw new Error(`A flow supports ${FLOW_MAX_SCREENS} screens.`);
    this.plan.steps.push({ ...step, id: randomUUID() });
  }
  accept(event) {
    if (!this.recording || ["focus", "blur"].includes(event.type)) return;
    this.events = this.events.then(async () => {
      if (!this.recording) return;
      if (event.target?.consequential) throw new Error("Consequential test-mode actions are excluded from saved journeys.");
      const url = flowUrl(event.url);
      const action = structuredClone(event);
      delete action.sequence; delete action.generation; delete action.source;
      if (action.target?.href) flowUrl(action.target.href);
      const type = action.type === "edit" ? "input" : action.type;
      const step = { type, action, url, label: String(action.target?.name || action.target?.id || (type === "navigate" ? "Navigate to next page" : type)).slice(0, 160) };
      const previous = this.plan.steps.at(-1);
      if (["input", "scroll", "control"].includes(type) && previous?.type === type && JSON.stringify(previous.action?.target) === JSON.stringify(action.target) && previous.action?.selector === action.selector) Object.assign(previous, step);
      else this.append(step);
      await this.persist();
      if (this.plan.autoScreens) {
        clearTimeout(this.screenTimer);
        this.screenTimer = setTimeout(() => { if (this.recording) void this.checkpoint().catch(error => this.interrupt(error.message)); }, 500);
      }
    }).catch(error => this.interrupt(error.message));
  }
  interrupt(reason) {
    if (!this.recording) return;
    clearTimeout(this.screenTimer);
    if (this.plan.steps.length < FLOW_MAX_STEPS) this.append({ type: "blocked", url: this.plan.startUrl, label: "Recording gap: review missed actions" });
    this.plan.interruption = { reason: "synchronization_interrupted" };
    this.plan.error = String(reason).slice(0, 500);
    this.state.recording = null;
    return this.persist();
  }
  async snapshot(entry, masks) {
    await this.browser().ready(entry);
    return this.browser().run(entry, `(${flowPageState})(${JSON.stringify(masks)})`);
  }
  async checkpoint() {
    await this.browser().queue; await this.events;
    const browser = this.browser();
    if (browser.problem || browser.paused) throw new Error("Recover synchronization before marking a screen.");
    const entry = browser.views.get(browser.source) || [...browser.views.values()][0];
    const state = await this.snapshot(entry, this.state.recording?.masks || "");
    this.append({ type: "checkpoint", label: state.title || `Screen ${this.plan.steps.length + 1}`, url: flowUrl(state.url), state, audit: true });
    await this.persist();
  }
  async startRecording({ masks = "", autoScreens = false } = {}, resume = false) {
    if (this.running || this.recording || this.review.active) throw new Error("Stop the current flow or audit first.");
    const browser = this.browser();
    if (browser.problem || browser.paused) throw new Error("Recover synchronization before recording.");
    const url = flowUrl(browser.url);
    if (typeof masks !== "string" || masks.length > 4000) throw new Error("Invalid recording masks.");
    masks = [...new Set([browser.masks, masks].filter(Boolean))].join(",");
    if (masks.length > 4000) throw new Error("Combined recording masks must fit within 4,000 characters.");
    for (const entry of browser.views.values()) await browser.run(entry, `document.querySelectorAll(${JSON.stringify(masks || ':root')}).length`);
    if (!resume) {
      if (this.state.plans.length >= 10) throw new Error("A project supports ten saved flows.");
      const plan = { schemaVersion: 2, id: randomUUID(), name: "Recorded journey", startUrl: url, steps: [], masks, autoScreens: Boolean(autoScreens) };
      this.state.plans.push(plan); this.state.selectedId = plan.id;
    } else {
      if (!this.plan?.interruption) throw new Error("Choose an interrupted flow to resume.");
      if (!this.plan.steps.some(step => step.type === "blocked")) this.append({ type: "blocked", url: this.plan.startUrl, label: "Recording gap: review missed actions" });
      delete this.plan.interruption; delete this.plan.error;
    }
    this.state.recording = { planId: this.plan.id, masks };
    await browser.setMasks(masks);
    if (!resume) await this.checkpoint();
    await this.persist();
  }
  async replay({ devices, profile }) {
    if (this.running || this.recording || this.review.active) throw new Error("Stop recording or the current audit first.");
    validateDevices(devices); validateProfile(profile);
    const plan = validatePlan(this.plan);
    profile = { ...profile, masks: [...new Set([plan.masks, profile.masks].filter(Boolean))].join(",") };
    validateProfile(profile);
    if (plan.interruption || plan.steps.some(s => s.type === "blocked") || !plan.steps.some(s => s.type === "checkpoint" && s.audit)) throw new Error("Review blocked steps and select at least one screen before replay.");
    const browser = this.browser();
    if (browser.testOrigin) throw new Error("Disable consequential-action test mode before replaying saved journeys.");
    if (browser.pendingDownload) throw new Error("Save or cancel the website download before replaying a journey.");
    for (const device of devices) if (!browser.views.has(device.id) || browser.excluded.has(device.id)) throw new Error("Open and include the selected devices in the live workspace first.");
    const job = { id: randomUUID(), planId: plan.id, name: plan.name, status: "running", phase: "replay", progress: "Opening the recorded journey…", stepIndex: 0, totalSteps: plan.steps.length, screens: [] };
    this.state.job = job; this.cancelled = false;
    browser.flowReplaying = true;
    browser.setPresentation(false); browser.publish();
    await this.persist();
    this.done = this.runReplay(plan, job, devices, profile).finally(() => { browser.flowReplaying = false; browser.publish(); });
    this.done.catch(console.error);
    return structuredClone(job);
  }
  async runReplay(plan, job, devices, profile) {
    const browser = this.browser();
    const selectedIds = new Set(devices.map(device => device.id));
    const entries = [...browser.views.values()].filter(entry => selectedIds.has(entry.device.id) && !browser.excluded.has(entry.device.id));
    try {
      await browser.navigate(plan.startUrl, selectedIds);
      await browser.setMasks(profile.masks);
      for (const [index, step] of plan.steps.entries()) {
        if (this.cancelled) throw new Error("Flow cancelled. Captured reports were retained.");
        job.stepIndex = index; job.progress = `${index + 1}/${plan.steps.length}: ${step.label}`;
        await this.persist();
        if (step.type === "checkpoint") {
          for (const entry of entries) {
            const deadline = Date.now() + 10000;
            let matched = false;
            do {
              if (this.cancelled) throw new Error("Flow cancelled.");
              const actual = await this.snapshot(entry, profile.masks);
              const expected = step.state;
              matched = actual.url === step.url && (!expected || (actual.heading === expected.heading && ["tabs", "details", "dialogs"].every(key => JSON.stringify(actual[key]) === JSON.stringify(expected[key]))));
              if (matched) break;
              await new Promise(resolve => setTimeout(resolve, 50));
            } while (Date.now() < deadline);
            if (!matched) throw new Error(`Checkpoint did not match on ${entry.device.name}: ${step.label}`);
          }
          if (step.audit) {
            const screen = { stepId: step.id, label: step.label, status: "running" }; job.screens.push(screen);
            const run = await this.review.start(devices, profile, { flow: { batchId: job.id, planName: plan.name, screenName: step.label, screenIndex: job.screens.length - 1 } });
            screen.runId = run.id;
            await this.review.active?.done;
            const result = this.store.get(run.id);
            screen.status = result.status; screen.error = result.error;
            if (result.status !== "completed") throw new Error(result.error || "Screen review failed.");
          }
        } else {
          const action = step.action || { ...step, type: step.type === "input" ? "edit" : step.type, ...(step.type === "scroll" ? { type: "scroll", selector: "", ratio: step.scroll?.ratio || 0, xRatio: 0 } : {}) };
          for (const entry of entries) {
            entry.delivering = true;
            try {
              const result = await browser.deliver(entry, action);
              if (!result?.ok) throw new Error(`${entry.device.name}: ${result?.reason || "Recorded action could not be verified."}`);
            } finally { entry.delivering = false; }
          }
          if (step.type === "navigate") browser.url = step.url;
        }
      }
      job.status = "completed"; job.progress = "Journey completed. Selected screen reports are ready.";
    } catch (error) {
      job.status = this.cancelled ? "cancelled" : "failed"; job.error = job.progress = error.message;
    } finally { await this.persist(); }
  }
  async request(path, method, body = {}) {
    if (typeof path !== "string" || path.length > 100 || !["GET", "POST", "PATCH"].includes(method) || JSON.stringify(body).length > 1000000) throw new Error("Invalid flow operation.");
    if (path === "/flows" && method === "GET") return this.state;
    if (path === "/flows/cancel" && method === "POST") { this.cancelled = true; this.review.active?.controller.abort(); return { cancelled: true }; }
    if (method !== (path === "/flows/plan" ? "PATCH" : "POST")) throw new Error("Unsupported flow method.");
    if (this.mutation) throw new Error("Wait for the current flow command to finish.");
    this.mutation = this.execute(path, method, body);
    try { return await this.mutation; } finally { this.mutation = null; }
  }
  async execute(path, method, body) {
    const action = path.slice("/flows".length);
    if (!action && method === "GET") return this.state;
    if (action === "/cancel") { this.cancelled = true; this.review.active?.controller.abort(); return { cancelled: true }; }
    if (action === "/record") await this.startRecording(body);
    else if (action === "/resume") await this.startRecording(body, true);
    else if (action === "/checkpoint") { if (!this.recording) throw new Error("Start a recording before marking a screen."); await this.checkpoint(); }
    else if (action === "/stop") { clearTimeout(this.screenTimer); await this.events; this.state.recording = null; await this.persist(); }
    else if (action === "/run") return this.replay(body);
    else {
      if (this.recording || this.running) throw new Error("Stop recording or replay before editing a saved plan.");
      if (action === "/select") { if (!this.state.plans.some(p => p.id === body.id)) throw new Error("Flow not found."); this.state.selectedId = body.id; }
      else if (action === "/delete") { this.state.plans = this.state.plans.filter(p => p.id !== body.id); this.state.selectedId = this.state.plans[0]?.id || ""; }
      else if (action === "/plan") {
        if (!this.plan) throw new Error("Choose a saved flow.");
        if (body.name !== undefined) { if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) throw new Error("Choose a flow name up to 160 characters."); this.plan.name = body.name; }
        if (body.removeStep) this.plan.steps = this.plan.steps.filter(s => s.id !== body.removeStep);
        const step = this.plan.steps.find(s => s.id === body.stepId);
        if (step) {
          if (body.audit !== undefined) step.audit = Boolean(body.audit);
          if (body.label !== undefined) { if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 160) throw new Error("Choose a screen name up to 160 characters."); step.label = body.label; }
        }
      } else throw new Error("Unsupported flow operation.");
      await this.persist();
    }
    return this.state;
  }
  async stop() {
    await this.mutation?.catch(() => {});
    if (this.recording) await this.interrupt("The application closed during recording.");
    this.cancelled = true; this.review.active?.controller.abort();
    await this.done; await this.events;
  }
}
