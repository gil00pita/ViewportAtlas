import { flowUrl, FLOW_MAX_STEPS, FLOW_MAX_SCREENS } from "../companion/flow-contract.mjs";
import { randomUUID } from "node:crypto";

export function validatePlan(plan) {
  if (!plan || typeof plan.id !== "string" || !/^[\w-]{1,80}$/.test(plan.id) || typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 160 || !Array.isArray(plan.steps) || plan.steps.length > FLOW_MAX_STEPS) throw new Error("Invalid saved flow.");
  flowUrl(plan.startUrl);
  if (plan.masks !== undefined && (typeof plan.masks !== "string" || plan.masks.length > 4000)) throw new Error("Invalid saved flow masks.");
  if (plan.steps.filter(s => s.type === "checkpoint").length > FLOW_MAX_SCREENS) throw new Error("Too many recorded screens.");
  const ids = new Set();
  for (const step of plan.steps) {
    if (!/^[\w-]{1,80}$/.test(step.id) || ids.has(step.id) || typeof step.label !== "string" || step.label.length > 160 || !["click", "input", "control", "scroll", "navigate", "key", "hover", "drag", "double-click", "checkpoint", "blocked"].includes(step.type)) throw new Error("Invalid recorded step.");
    ids.add(step.id); flowUrl(step.url);
    const action = step.action || step;
    if (step.type === "input" && (typeof action.value !== "string" || action.value.length > 4000)) throw new Error("Invalid recorded text edit.");
    if (action.target?.sensitive || action.target?.risky) throw new Error("Private or consequential actions cannot be imported for replay.");
    if (JSON.stringify(step).length > 16000) throw new Error("Recorded step exceeds the supported size.");
  }
  return structuredClone(plan);
}

export function interruptedFlows(flows) {
  if (!flows) return { plans: [], selectedId: "", recording: null, job: null };
  if (!Array.isArray(flows.plans) || flows.plans.length > 10) throw new Error("Invalid saved flow collection.");
  const result = structuredClone(flows);
  result.plans = result.plans.map(validatePlan);
  if (result.recording) {
    const plan = result.plans.find(p => p.id === result.recording.planId);
    if (plan) {
      plan.interruption = { reason: "app_restarted" }; plan.error = "Recording was interrupted. Reopen the website and resume after reviewing the gap.";
      if (!plan.steps.some(step => step.type === "blocked") && plan.steps.length < FLOW_MAX_STEPS) plan.steps.push({ id: randomUUID(), type: "blocked", url: plan.startUrl, label: "Recording gap: review missed actions" });
    }
  }
  result.recording = null;
  if (result.job?.status === "running") {
    result.job.status = "failed";
    result.job.error = result.job.progress = "Replay was interrupted. Completed reports were retained; uncertain actions were not repeated.";
  }
  return result;
}
