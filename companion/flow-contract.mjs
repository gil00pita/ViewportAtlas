export const FLOW_MAX_STEPS = 120;
export const FLOW_MAX_SCREENS = 20;
export function flowUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
    [...url.searchParams.keys()].some((key) => /token|auth|key|secret|password|session|code/i.test(key)))
    throw new Error("Record from an HTTP(S) page without credentials or secret query parameters in its address.");
  return url.href;
}
export function validateFlowContext(flow) {
  if (!flow || !/^[a-zA-Z0-9_-]{1,80}$/.test(flow.batchId) ||
    typeof flow.planName !== "string" || flow.planName.length > 160 ||
    typeof flow.screenName !== "string" || !flow.screenName.trim() || flow.screenName.length > 160 ||
    !Number.isInteger(flow.screenIndex) || flow.screenIndex < 0 || flow.screenIndex >= FLOW_MAX_SCREENS)
    throw new Error("Invalid recorded-flow screen context.");
  return { batchId: flow.batchId, planName: flow.planName, screenName: flow.screenName, screenIndex: flow.screenIndex };
}
