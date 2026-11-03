import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("Chrome cancellation pauses a flow, retains masks and steps, and resumes only on request", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-controller-"));
  const previousChrome = globalThis.chrome;
  try {
    await cp("extension/flow-controller.mjs", join(root, "flow-controller.mjs"));
    for (const file of ["flow-page.mjs", "flow-contract.mjs"]) await cp(`companion/${file}`, join(root, file));
    const { createFlowController } = await import(pathToFileURL(join(root, "flow-controller.mjs")));
    let stored, binding, attachError = false, attaches = 0;
    const inspectedMasks = [];
    globalThis.chrome = {
      storage: { local: {
        get: async () => ({ atlasFlows: structuredClone(stored) }),
        set: async ({ atlasFlows }) => { stored = structuredClone(atlasFlows); },
      } },
      tabs: { get: async (id) => ({ id }) },
      debugger: {
        attach: async () => { attaches++; if (attachError) throw new Error("Another debugger is already attached"); },
        detach: async () => {},
      },
    };
    const dependencies = {
      sourceTab: async () => 42,
      command: async (id, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
        if (method === "Runtime.addBinding") binding = params.name;
        return { identifier: "script" };
      },
      evaluate: async (id, fn, arg) => {
        if (fn.name === "flowPageState") {
          inspectedMasks.push(arg);
          return { url: "https://example.com/", title: "Example", ready: "complete" };
        }
      },
      browserEvidence: () => {}, views: new Map(), lock: () => {},
    };
    const controller = createFlowController(dependencies);
    // Concurrent initial reads must share initialization instead of resetting it.
    await Promise.all([controller.handle("/flows", "GET"), controller.handle("/flows", "GET")]);
    await controller.handle("/flows/record", "POST", { masks: ".private" });
    const planId = stored.selectedId;
    await controller.onEvent({ tabId: 42 }, "Runtime.bindingCalled", { name: binding, payload: JSON.stringify({ type: "click", url: "https://example.com/", target: { tag: "button", name: "Details" } }) });
    const steps = structuredClone(stored.plans[0].steps);
    await controller.onDetach({ tabId: 42, sessionId: "child" }, "target_closed");
    assert(controller.busy, "A child session must not stop the top-frame recorder");
    await controller.onDetach({ tabId: 42 }, "canceled_by_user");
    assert.equal(stored.recording, null);
    assert.equal(stored.plans[0].interruption.reason, "canceled_by_user");
    assert.match(stored.plans[0].error, /DevTools.*Cancel/);
    assert.deepEqual(stored.plans[0].steps, steps);
    assert.equal(attaches, 1, "Never override Chrome's Cancel action with automatic reattachment");
    attachError = true;
    await assert.rejects(controller.handle("/flows/resume", "POST"), /already attached/);
    assert.deepEqual(stored.plans[0].steps, steps, "A failed resume must preserve the original plan");
    assert(stored.plans[0].interruption);
    assert(!controller.busy);
    attachError = false;
    await controller.handle("/flows/resume", "POST", { masks: ".different" });
    assert.equal(stored.recording.planId, planId);
    assert.equal(stored.plans.length, 1);
    assert.deepEqual(stored.plans[0].steps.slice(0, steps.length), steps);
    assert(stored.plans[0].steps.some((step) => step.type === "blocked" && /gap/.test(step.label)));
    assert.deepEqual(inspectedMasks, [".private", ".private"]);
    assert.equal(stored.plans[0].interruption, undefined);
    const restarted = createFlowController(dependencies);
    await restarted.handle("/flows", "GET");
    assert.equal(stored.plans[0].interruption.reason, "worker_restarted");
    await restarted.handle("/flows/resume", "POST");
    assert.equal(stored.recording.planId, planId);
    assert.equal(inspectedMasks.at(-1), ".private");
    await restarted.handle("/flows/stop", "POST");
    stored.plans[0].error = "Recording disconnected. Saved steps were retained; record again to finish the journey.";
    const legacy = createFlowController(dependencies);
    await legacy.handle("/flows", "GET");
    assert.equal(stored.plans[0].interruption.reason, "unknown");
    await legacy.handle("/flows/resume", "POST", { masks: ".legacy-mask" });
    assert.equal(inspectedMasks.at(-1), ".legacy-mask");
    assert.equal(stored.recording.planId, planId);
    await legacy.handle("/flows/stop", "POST");
  } finally {
    globalThis.chrome = previousChrome;
    await rm(root, { recursive: true, force: true });
  }
});
