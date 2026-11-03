import { recordFlowPage, flowPageState } from "./flow-page.mjs";
import { flowUrl, FLOW_MAX_STEPS, FLOW_MAX_SCREENS } from "./flow-contract.mjs";

export function createFlowController({ command, evaluate, browserEvidence, createViews, snapshots, native, views, sourceTab, lock }) {
  let state, recording, operation = false, cancelRequested = false;
  let writes = Promise.resolve(), events = Promise.resolve(), initialization;
  const network = new Map();
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  const persist = () => {
    const snapshot = structuredClone({ ...state, recording: recording ? { planId: recording.planId, tabId: recording.tabId, masks: recording.masks } : null });
    writes = writes.catch(() => {}).then(() => chrome.storage.local.set({ atlasFlows: snapshot }));
    return writes;
  };
  const initialize = () => initialization ||= (async () => {
    state = (await chrome.storage.local.get("atlasFlows")).atlasFlows || { plans: [], selectedId: "", job: null };
    if (state.recording) {
      const plan = state.plans.find((plan) => plan.id === state.recording.planId);
      if (plan) {
        plan.interruption = { ...state.recording, reason: "worker_restarted" };
        plan.error = "Chrome restarted the recorder. Open your website and choose Resume recording to continue this flow.";
      }
      state.recording = null;
    }
    // Older builds retained the plan but discarded the tab and detach reason.
    for (const plan of state.plans) {
      if (!plan.interruption && /^Recording (disconnected|was interrupted)\./.test(plan.error || "")) {
        plan.interruption = { reason: "unknown" };
        plan.error = "This flow’s recording was interrupted. Open your website and choose Resume recording to continue.";
      }
    }
    if (state.job?.status === "running") {
      state.job.status = "failed";
      state.job.error = "Chrome stopped during replay. Captured screen reports remain in audit history; run the saved plan again.";
    }
    await persist();
  })();
  const selected = () => state.plans.find((plan) => plan.id === state.selectedId);
  const checkCancelled = () => { if (cancelRequested) throw new Error("Flow cancelled by user."); };
  const append = (plan, step) => {
    if (plan.steps.length >= FLOW_MAX_STEPS) throw new Error(`Recording reached ${FLOW_MAX_STEPS} steps. Stop here or record a shorter flow.`);
    if (step.type === "checkpoint" && plan.steps.filter((step) => step.type === "checkpoint").length >= FLOW_MAX_SCREENS)
      throw new Error(`A flow supports up to ${FLOW_MAX_SCREENS} screens.`);
    plan.steps.push({ ...step, id: crypto.randomUUID() });
  };
  const recordEvent = async (event) => {
    if (!recording) return;
    const plan = state.plans.find((plan) => plan.id === recording.planId);
    const url = flowUrl(event.url);
    if (event.type === "state") {
      const previous = plan.steps.at(-1);
      if (previous && ["click", "input", "navigate"].includes(previous.type)) {
        previous.after = event.state;
        if (plan.autoScreens) append(plan, { type: "checkpoint", url, label: event.state.title || `Screen ${plan.steps.length + 1}`, state: event.state, audit: true });
      }
    } else if (event.type === "navigate") {
      if (plan.steps.at(-1)?.url !== url) append(plan, { type: "navigate", url, label: "Navigate to next page" });
    } else if (event.type === "click" || event.type === "input") {
      if (!event.target || event.target.risky || event.target.sensitive) throw new Error("An unsafe interaction was excluded. Record a flow using navigation and ordinary UI controls.");
      const target = Object.fromEntries(["tag", "id", "testId", "role", "name", "href", "type"].map((key) => [key, String(event.target[key] || "").slice(0, key === "href" ? 2000 : 500)]));
      if (target.href) target.href = flowUrl(target.href);
      target.risky = false; target.sensitive = false;
      append(plan, { type: event.type, url, label: String(event.label || "Interaction").slice(0, 160), target,
        ...(event.type === "input" ? { value: String(event.value || "").slice(0, 4000) } : {}) });
    } else if (event.type === "scroll") {
      const step = { type: "scroll", url, label: "Scroll page", scroll: event.scroll };
      if (plan.steps.at(-1)?.type === "scroll") Object.assign(plan.steps.at(-1), step);
      else append(plan, step);
    } else if (event.type === "blocked") append(plan, { type: "blocked", url, label: event.label || "Interaction needs manual review" });
    await persist();
  };
  const stopRecording = async () => {
    if (!recording) return;
    const active = recording;
    recording = null;
    await evaluate(active.tabId, () => window.__atlasFlowRecorder?.stop()).catch(() => {});
    await command(active.tabId, "Page.removeScriptToEvaluateOnNewDocument", { identifier: active.scriptId }).catch(() => {});
    await command(active.tabId, "Runtime.removeBinding", { name: active.binding }).catch(() => {});
    await chrome.debugger.detach({ tabId: active.tabId }).catch(() => {});
    await persist();
  };
  const waitFor = async (tabId, fn, arg, test) => {
    let last;
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      checkCancelled();
      try { last = await evaluate(tabId, fn, arg); if (test(last)) return last; } catch (error) { last = { reason: error.message }; }
      await pause(150);
    }
    throw new Error(last?.reason || "The expected screen did not appear within 10 seconds.");
  };
  const stateMatches = (actual, expected) => actual.ready === "complete" && actual.url === expected.url &&
    (expected.heading === undefined || actual.heading === expected.heading) &&
    ["tabs", "details", "dialogs"].every((key) => !Array.isArray(expected[key]) ||
      JSON.stringify([...expected[key]].sort()) === JSON.stringify([...(actual[key] || [])].sort()));
  const waitForState = (tabId, expected, masks = "") => waitFor(tabId, flowPageState, masks, (actual) => stateMatches(actual, expected));
  const settle = async (tabId) => {
    await waitFor(tabId, () => document.readyState === "complete", undefined, (ready) => ready);
    const deadline = Date.now() + 10000;
    while (network.get(tabId)?.pending.size || Date.now() - (network.get(tabId)?.changedAt || 0) < 400) {
      checkCancelled();
      if (Date.now() > deadline) throw new Error("Page requests did not settle within 10 seconds.");
      await pause(100);
    }
    // Drive deadlines in the worker: Chrome can throttle timers in inactive tabs.
    const revision = () => {
      if (!window.__atlasFlowWatch) {
        const watch = { revision: 0 };
        watch.observer = new MutationObserver(() => watch.revision++);
        watch.observer.observe(document, { childList: true, subtree: true, attributes: true });
        window.__atlasFlowWatch = watch;
      }
      return window.__atlasFlowWatch.revision;
    };
    let last = await evaluate(tabId, revision), quietSince = Date.now();
    const maxWait = Date.now() + 2500;
    while (Date.now() < maxWait && Date.now() - quietSince < 400) {
      checkCancelled();
      await pause(100);
      const next = await evaluate(tabId, revision);
      if (next !== last) { last = next; quietSince = Date.now(); }
    }
  };
  const refreshReports = async () => {
    for (const screen of state.job.screens) {
      if (!screen.runId || !["queued", "running"].includes(screen.status)) continue;
      const report = await native(`/runs/${screen.runId}`);
      screen.status = report.status;
      if (report.error) screen.error = report.error;
      if (report.checks?.some((check) => check.status === "failed")) screen.error = "Some checks failed. Open this screen’s report for details.";
    }
    await persist();
  };
  const replay = async (plan, devices, profile) => {
    const job = state.job;
    let replayError;
    try {
      const created = await createViews(plan.startUrl, devices);
      if (created.some((view) => view.error)) throw new Error(created.find((view) => view.error).error);
      for (const device of devices) {
        const tabId = views.get(device.id).tabId;
        network.set(tabId, { pending: new Set(), changedAt: Date.now() });
        await command(tabId, "Network.enable");
      }
      for (let index = 0; index < plan.steps.length; index++) {
        checkCancelled();
        const step = plan.steps[index];
        job.stepIndex = index;
        job.progress = `${index + 1} of ${plan.steps.length} · ${step.label}`;
        await persist();
        if (step.type === "blocked") throw new Error(`${step.label}. Remove this step or record a supported interaction before replay.`);
        if (step.type === "checkpoint") {
          if (!step.audit) continue;
          for (const device of devices) {
            const tabId = views.get(device.id)?.tabId;
            try {
              job.progress = `Saving ${step.label} · ${device.name}: waiting for screen`;
              await persist();
              await waitForState(tabId, step.state, profile.masks);
              job.progress = `Saving ${step.label} · ${device.name}: waiting for page changes`;
              await persist();
              await settle(tabId);
            }
            catch (error) { throw new Error(`${device.name} · ${step.label}: ${error.message}`); }
          }
          const screen = { stepId: step.id, label: step.label, status: "capturing" };
          job.screens.push(screen);
          await persist();
          const evidence = await snapshots(devices, profile);
          checkCancelled();
          const report = await native("/runs", "POST", { url: step.url, devices, profile, snapshots: evidence,
            flow: { batchId: job.id, planName: plan.name, screenName: step.label, screenIndex: job.screens.length - 1 } });
          screen.runId = report.id;
          screen.status = "queued";
          if (cancelRequested) await native(`/runs/${report.id}/cancel`, "POST", {});
          await persist();
          continue;
        }
        for (const device of devices) {
          checkCancelled();
          job.progress = `${index + 1} of ${plan.steps.length} · ${step.label} · ${device.name}`;
          await persist();
          const tabId = views.get(device.id)?.tabId;
          try {
            if (step.type === "navigate") {
              const current = await evaluate(tabId, () => location.href);
              if (current !== step.url) await command(tabId, "Page.navigate", { url: step.url });
              await waitForState(tabId, { url: step.url });
            } else {
              await waitForState(tabId, { url: step.url });
              if (step.type === "scroll") await evaluate(tabId, browserEvidence, { type: "scroll-to", ...step.scroll });
              else {
                const target = await waitFor(tabId, browserEvidence, { type: "resolve", descriptor: step.target, masks: profile.masks }, (result) => result?.ok);
                if (step.type === "input") {
                  const result = await evaluate(tabId, browserEvidence, { type: "fill", descriptor: step.target, value: step.value, masks: profile.masks });
                  if (!result.ok) throw new Error(result.reason);
                } else {
                  await command(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
                  await command(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
                }
              }
              await settle(tabId);
              if (step.after) await waitForState(tabId, step.after, profile.masks);
            }
          } catch (error) { throw new Error(`${device.name} · step ${index + 1} (${step.label}): ${error.message}`); }
        }
      }
    } catch (error) {
      replayError = error.message;
      for (const screen of job.screens) if (screen.status === "capturing") {
        screen.status = cancelRequested ? "cancelled" : "failed";
        screen.error = replayError;
      }
    }
    try {
      job.phase = "reports";
      job.progress = cancelRequested ? "Cancelling captured screen reports…" : replayError ? "Replay stopped. Finishing captured screen reports…" : "All screens captured. Finishing reports…";
      await persist();
      if (cancelRequested) await Promise.allSettled(job.screens.filter((screen) => screen.runId).map((screen) => native(`/runs/${screen.runId}/cancel`, "POST", {})));
      while (job.screens.some((screen) => ["queued", "running"].includes(screen.status))) {
        await refreshReports();
        if (job.screens.some((screen) => ["queued", "running"].includes(screen.status))) await pause(1000);
      }
      job.status = cancelRequested ? "cancelled" : replayError || job.screens.some((screen) => screen.status !== "completed" || screen.error) ? "failed" : "completed";
      job.error = replayError || job.screens.find((screen) => screen.error)?.error;
      job.progress = job.status === "completed" ? `${job.screens.length} screen reports ready` : `Flow ${job.status}. Captured reports are retained.`;
    } catch (error) { job.status = cancelRequested ? "cancelled" : "failed"; job.error = error.message; }
    finally { operation = false; network.clear(); lock(false); await persist(); }
  };
  return {
    get busy() { return Boolean(recording) || operation; },
    async onEvent(source, method, params) {
      const activity = network.get(source.tabId);
      if (activity && method === "Network.requestWillBeSent" && ["Document", "XHR", "Fetch", "Script", "Stylesheet"].includes(params.type)) {
        activity.pending.add(params.requestId); activity.changedAt = Date.now();
      } else if (activity && ["Network.loadingFinished", "Network.loadingFailed"].includes(method) && activity.pending.delete(params.requestId)) activity.changedAt = Date.now();
      if (!recording || source.tabId !== recording.tabId || source.sessionId) return;
      let event;
      if (method === "Runtime.bindingCalled" && params.name === recording.binding && params.payload.length <= 16000) {
        try { event = JSON.parse(params.payload); } catch { return; }
      } else if (method === "Page.frameNavigated" && params.frame?.id && !params.frame.parentId) {
        recording.frameId = params.frame.id;
        event = { type: "navigate", url: params.frame.url };
      } else if (method === "Page.navigatedWithinDocument" && params.frameId === recording.frameId)
        event = { type: "navigate", url: params.url };
      if (!event) return;
      events = events.then(() => recordEvent(event)).catch(async (error) => {
        const plan = state.plans.find((plan) => plan.id === recording?.planId);
        if (plan) plan.error = error.message;
        await stopRecording();
      });
      await events;
    },
    async onDetach(source, reason = "unknown") {
      if (!recording || recording.tabId !== source.tabId || source.sessionId) return;
      const active = recording;
      await events;
      if (recording !== active) return;
      const plan = state.plans.find((plan) => plan.id === active.planId);
      if (plan) {
        plan.interruption = { tabId: active.tabId, masks: active.masks, reason };
        plan.error = reason === "canceled_by_user"
          ? "Chrome cancelled the recording connection. This can happen when DevTools opens or Cancel is clicked in Chrome’s debugging banner. Close DevTools, then choose Resume recording."
          : reason === "target_closed"
            ? "Chrome closed the recorded page’s debugging target. Open your website, then choose Resume recording to continue this flow."
            : `Chrome disconnected the recorder (${reason}). Open your website, then choose Resume recording to continue this flow.`;
      }
      recording = null;
      await persist();
    },
    async handle(path, method, body = {}) {
      await initialize();
      if (path === "/flows" && method === "GET") return { ...state, recording: recording ? { planId: recording.planId } : null };
      if (path === "/flows/stop" && method === "POST") { await events; await stopRecording(); return state; }
      if (path === "/flows/cancel" && method === "POST") { cancelRequested = true; return { cancelling: true }; }
      if (path === "/flows/checkpoint" && method === "POST") {
        if (!recording) throw new Error("Start recording before saving a screen.");
        await events;
        const snapshot = await evaluate(recording.tabId, flowPageState, recording.masks);
        append(selected(), { type: "checkpoint", label: String(body.label || snapshot.title || "Saved screen").slice(0, 160), url: flowUrl(snapshot.url), state: snapshot, audit: true });
        await persist(); return state;
      }
      if (this.busy) throw new Error("Stop recording or finish the current flow before changing plans.");
      if (["/flows/record", "/flows/resume"].includes(path) && method === "POST") {
        const resuming = path === "/flows/resume";
        const saved = selected();
        if (resuming && !saved?.interruption) throw new Error("Select an interrupted flow to resume.");
        if (!resuming && state.plans.length >= 10) throw new Error("You have 10 saved flows. Delete one before recording another.");
        operation = true;
        const previousPlans = state.plans, previousSelected = state.selectedId;
        let tabId, attached = false;
        try {
          // Prefer the original tab; sidebar focus must not retarget a live journey.
          if (resuming) {
            try { tabId = (await chrome.tabs.get(saved.interruption.tabId)).id; } catch { /* The user may reopen the site in another tab. */ }
          }
          tabId ||= await sourceTab();
          if (!tabId) throw new Error("Open a website and click the Viewport Atlas toolbar icon before recording.");
          await chrome.debugger.attach({ tabId }, "1.3");
          attached = true;
          const masks = resuming ? saved.interruption.masks ?? body.masks ?? "" : body.masks || "";
          await command(tabId, "Page.enable"); await command(tabId, "Runtime.enable");
          const { frameTree } = await command(tabId, "Page.getFrameTree");
          if (masks) await evaluate(tabId, (masks) => document.querySelectorAll(masks).length, masks);
          const snapshot = await evaluate(tabId, flowPageState, masks);
          const currentUrl = flowUrl(snapshot.url);
          const plan = resuming ? structuredClone(saved) : { id: crypto.randomUUID(), name: `${snapshot.title || "Website"} flow`.slice(0, 160), startUrl: flowUrl(snapshot.url), createdAt: new Date().toISOString(), autoScreens: Boolean(body.autoScreens), steps: [] };
          if (resuming) {
            // Do not silently assume that actions during the gap are replayable.
            append(plan, { type: "blocked", label: "Recording gap: review actions taken while disconnected", url: currentUrl });
            if (plan.steps.at(-2)?.url !== currentUrl) append(plan, { type: "navigate", url: currentUrl, label: "Continue on resumed page" });
            delete plan.error;
            delete plan.interruption;
          }
          append(plan, { type: "checkpoint", label: snapshot.title || (resuming ? "Resumed screen" : "Starting screen"), url: currentUrl, state: snapshot, audit: true });
          const binding = `__atlasFlow_${crypto.randomUUID().replaceAll("-", "")}`;
          await command(tabId, "Runtime.addBinding", { name: binding });
          const source = `(${recordFlowPage.toString()})(${browserEvidence.toString()},${flowPageState.toString()},${JSON.stringify({ binding, masks })})`;
          const script = await command(tabId, "Page.addScriptToEvaluateOnNewDocument", { source });
          state.plans = resuming ? state.plans.map((item) => item.id === plan.id ? plan : item) : [plan, ...state.plans]; state.selectedId = plan.id;
          recording = { tabId, frameId: frameTree.frame.id, planId: plan.id, scriptId: script.identifier, binding, masks };
          await evaluate(tabId, () => window.__atlasFlowRecorder?.stop());
          await command(tabId, "Runtime.evaluate", { expression: source });
          await persist(); return state;
        } catch (error) {
          if (attached) {
            await stopRecording();
            await chrome.debugger.detach({ tabId }).catch(() => {});
          }
          state.plans = previousPlans; state.selectedId = previousSelected;
          await persist();
          throw error;
        } finally { operation = false; }
      }
      if (path === "/flows/select" && method === "POST") {
        if (!state.plans.some((plan) => plan.id === body.id)) throw new Error("Flow plan not found.");
        state.selectedId = body.id; await persist(); return state;
      }
      if (path === "/flows/plan" && method === "PATCH") {
        const plan = selected();
        if (!plan) throw new Error("Record a flow first.");
        if (typeof body.name === "string") plan.name = body.name.trim().slice(0, 160) || plan.name;
        if (body.removeStep) plan.steps = plan.steps.filter((step) => step.id !== body.removeStep);
        const step = plan.steps.find((step) => step.id === body.stepId);
        if (step?.type === "checkpoint") {
          if (typeof body.label === "string") step.label = body.label.trim().slice(0, 160) || step.label;
          if (typeof body.audit === "boolean") step.audit = body.audit;
        }
        await persist(); return state;
      }
      if (path === "/flows/delete" && method === "POST") {
        state.plans = state.plans.filter((plan) => plan.id !== body.id);
        state.selectedId = state.plans[0]?.id || "";
        await persist(); return state;
      }
      if (path === "/flows/run" && method === "POST") {
        const plan = selected();
        if (!plan?.steps.some((step) => step.type === "checkpoint" && step.audit)) throw new Error("Select at least one screen to audit.");
        if (plan.steps.some((step) => step.type === "blocked")) throw new Error("Remove interactions needing manual review or record a supported flow before replay.");
        if (!Array.isArray(body.devices) || !body.devices.length || !body.profile?.categories?.length) throw new Error("Choose audit devices and categories first.");
        operation = true; cancelRequested = false; lock(true);
        state.job = { id: crypto.randomUUID(), planId: plan.id, name: plan.name, status: "running", phase: "replay", stepIndex: 0, totalSteps: plan.steps.length, progress: "Preparing recorded flow…", screens: [] };
        await persist();
        void replay(structuredClone(plan), body.devices, body.profile).catch((error) => {
          operation = false; lock(false); state.job.status = "failed"; state.job.error = error.message;
        });
        return state.job;
      }
      throw new Error("Unknown flow operation.");
    },
  };
}
