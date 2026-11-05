import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, FolderOpen, Monitor, Pause, Play, RotateCw } from "lucide-react";
import type { DesktopState } from "./types";
import App from "../App";
import { Management } from "./Management";
import { useFlowPlanner } from "../use-flow-planner";
import type { Profile } from "../types";

const EXAMPLE = "atlas://example/index.html";
export function DesktopApp() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [managing, setManaging] = useState(false);
  const flow = useFlowPlanner(true, setError);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const stop = window.atlasDesktop.subscribe((next) => { if (active) setState(next); });
    const show = () => { setReviewing(false); setManaging(false); void window.atlasDesktop.presentation(true); };
    window.addEventListener("atlas-show-browser", show);
    window.atlasDesktop.state().then((next) => { if (active) setState(next); }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; stop(); window.removeEventListener("atlas-show-browser", show); };
  }, []);
  const deviceCount = state?.views.length || 0;
  const layoutKey = state?.views.map(v => `${v.device.id}:${v.device.width}:${v.device.height}`).join(",");
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !deviceCount || reviewing || managing) return;
    const slots = [...element.querySelectorAll<HTMLElement>("[data-browser-slot]")];
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const overhead = Math.max(...slots.map((slot) => slot.getBoundingClientRect().top - bounds.top + (slot.nextElementSibling?.getBoundingClientRect().height || 0) + (slot.nextElementSibling?.nextElementSibling?.getBoundingClientRect().height || 0)));
        const totalWidth = slots.reduce((sum, slot) => sum + Number(slot.dataset.viewportWidth), 0);
        const maxHeight = Math.max(...slots.map((slot) => Number(slot.dataset.viewportHeight)));
        const scale = Math.max(.01, Math.min((element.clientWidth - 20 * (slots.length - 1)) / totalWidth, (element.clientHeight - overhead) / maxHeight, 1));
        for (const slot of slots) {
          const width = Number(slot.dataset.viewportWidth) * scale;
          slot.style.width = `${width}px`;
          slot.style.height = `${Number(slot.dataset.viewportHeight) * scale}px`;
          slot.parentElement!.style.flex = `0 0 ${width}px`;
        }
        window.atlasDesktop.layout(slots.map((slot) => {
          const bounds = slot.getBoundingClientRect();
          return { id: slot.dataset.browserSlot!, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        })).catch((reason) => setError(String(reason)));
      });
    };
    const observer = new ResizeObserver(update);
    slots.forEach((slot) => observer.observe(slot));
    observer.observe(element);
    window.addEventListener("resize", update);
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", update); };
  }, [deviceCount, reviewing, managing, layoutKey]);

  async function perform(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }
  const busy = pending || state?.busy || !state;
  async function returnToBrowser() {
    await perform(async () => {
      const devices = JSON.parse(localStorage.getItem("atlas-devices") || "[]");
      await window.atlasDesktop.configure(devices);
      await window.atlasDesktop.presentation(true);
      setReviewing(false);
    });
  }
  return <><div className="desktop-app" style={{ display: reviewing ? "none" : undefined }}>
    <header className="desktop-header">
      <div className="desktop-brand"><img src="./viewport-atlas-logo.svg" width="42" height="42" alt="" /><span>Viewport Atlas</span></div>
      <span className="desktop-release">Desktop preview</span>
      {state?.testOrigin && <strong className="desktop-test-mode">Test mode: server actions repeat</strong>}
      <button disabled={busy || flow.recording} onClick={() => void perform(async () => {
        await window.atlasDesktop.presentation(managing);
        setManaging(current => !current);
      })}>{managing ? "Close project controls" : "Projects & data"}</button>
      <button disabled={pending || !state} onClick={() => void perform(async () => {
        await window.atlasDesktop.presentation(false);
        setReviewing(true);
      })}>Audit settings & reports</button>
      <button className="desktop-capture" disabled={busy || Boolean(state?.problem) || state?.paused} onClick={() => void perform(() => window.atlasDesktop.capture())}>
        <Camera size={17} aria-hidden="true" />{pending ? "Working…" : "Capture & export PDF"}
      </button>
    </header>
    {managing && state && <Management state={state} perform={perform} error={error} />}
    <main className="desktop-main" style={{ display: managing ? "none" : undefined }}>
      <div className="desktop-heading"><div><h1>Responsive workspace</h1><p>Browse in any view. Your other screens follow.</p></div>
        <button className="desktop-example" disabled={busy} onClick={() => { setAddress(null); void perform(() => window.atlasDesktop.navigate(EXAMPLE)); }}>Open example</button>
      </div>
      <form className="desktop-address" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await window.atlasDesktop.navigate(address ?? state?.url ?? EXAMPLE); setAddress(null); }); }}>
        <Monitor size={18} aria-hidden="true" /><label className="desktop-sr-only" htmlFor="website-address">Website address</label>
        <input id="website-address" value={address ?? state?.url ?? EXAMPLE} onChange={(event) => setAddress(event.target.value)} spellCheck={false} placeholder="https://your-website.com" />
        <button type="submit" disabled={busy}>Open website <ArrowRight size={16} aria-hidden="true" /></button>
      </form>
      <div className="desktop-tools">
        <span className={`desktop-sync ${state?.paused ? "is-paused" : ""}`}><span className="desktop-status-dot" />{state?.paused ? "Synchronization paused" : state?.pending ? "Synchronizing interactions…" : "Interactions synchronized"}</span>
        <span className="desktop-tools-help">{state?.projects.projects.find(p => p.id === state.projects.selectedId)?.name}</span>
        <button aria-label="Back in all views" disabled={busy} onClick={() => void perform(() => window.atlasDesktop.history("back"))}><ArrowLeft size={15} /></button>
        <button aria-label="Forward in all views" disabled={busy} onClick={() => void perform(() => window.atlasDesktop.history("forward"))}><ArrowRight size={15} /></button>
        <button disabled={busy || Boolean(state?.problem)} onClick={() => void perform(() => window.atlasDesktop.pause(!state?.paused))}>
          {state?.paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{state?.paused ? "Resume sync" : "Pause sync"}
        </button>
        <button disabled={busy} onClick={() => void perform(() => window.atlasDesktop.navigate(state?.url || EXAMPLE))}><RotateCw size={15} aria-hidden="true" />Reload views</button>
        {state?.canRetry && <button disabled={busy} onClick={() => void perform(() => window.atlasDesktop.retry())}>Retry prepared counterparts</button>}
        {state?.popup && !state.popup.armed && <button disabled={busy} onClick={() => void perform(() => window.atlasDesktop.popup())}>Allow next popup from {state.popup.host}</button>}
        {state?.download && !state.download.armed && <button disabled={busy} onClick={() => void perform(() => window.atlasDesktop.download())}>Choose download destination</button>}
        {state?.download && <button disabled={pending} onClick={() => void perform(() => window.atlasDesktop.cancelDownload())}>Cancel website download</button>}
      </div>
      <div className="desktop-flow-tools" aria-label="Journey recording">
        {flow.recording ? <><span role="status">Recording journey</span><button disabled={flow.pending} onClick={() => void flow.perform("/flows/checkpoint")}>Mark screen</button><button disabled={flow.pending} onClick={() => void flow.perform("/flows/stop")}>Stop recording</button></>
          : <button disabled={busy || flow.pending || !state?.url.startsWith("http")} onClick={() => void flow.perform("/flows/record", "POST", { masks: "" })}>Record journey</button>}
        {flow.state?.plans.length ? <label>Saved journey<select aria-label="Saved journey" disabled={flow.pending || flow.recording || flow.running} value={flow.state.selectedId} onChange={event => void flow.perform("/flows/select", "POST", { id: event.target.value })}>{flow.state.plans.map(plan => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label> : null}
        {flow.plan?.interruption && <button disabled={busy || flow.pending} onClick={() => void flow.perform("/flows/resume", "POST", { masks: "" })}>Resume recording</button>}
        {flow.plan && !flow.recording && <button disabled={busy || flow.pending} onClick={() => void perform(async () => {
          const profiles: Profile[] = JSON.parse(localStorage.getItem("atlas-profiles") || "[]");
          const id = JSON.parse(localStorage.getItem("atlas-profile-id") || '"general"');
          const profile = profiles.find(p => p.id === id) || profiles[0];
          if (profile.ai) throw new Error("Open audit settings to confirm AI evidence sharing before replaying this profile.");
          const selected = new Set(profile.devices);
          await flow.perform("/flows/run", "POST", { devices: state?.views.filter(view => !view.excluded && selected.has(view.device.id)).map(view => view.device), profile });
        })}>Replay journey</button>}
        {flow.running && <button onClick={() => void flow.perform("/flows/cancel")}>Cancel replay</button>}
        {flow.state?.job && <span role="status">{flow.state.job.progress}</span>}
      </div>
      <div className="desktop-message" role={error || state?.problem ? "alert" : "status"}>
        {error || state?.problem || (state?.busy ? "Preparing browser views or evidence…" : "Ordinary controls follow across views. Unidentified actions pause synchronization. Reload views clears unsaved page edits.")}
      </div>
      <div className="desktop-canvas" ref={canvas}>
        {state?.views.map((view) => <section className="desktop-device" key={view.device.id} style={{ flex: view.device.width }} aria-label={`${view.device.name} browser view`}>
          <div className="desktop-device-heading"><h2 title={view.device.name}>{view.device.name}</h2><span>{view.device.width} × {view.device.height}</span></div>
          <div className="desktop-browser-slot" data-browser-slot={view.device.id} data-viewport-width={view.device.width} data-viewport-height={view.device.height} style={{ aspectRatio: `${view.device.width} / ${view.device.height}` }}>
            {view.status === "loading" ? "Opening page…" : state.busy ? flow.running ? "Replaying journey…" : "Working…" : ""}
          </div>
          <div className={`desktop-device-status ${view.status === "out-of-sync" ? "has-error" : ""}`}>
            {view.excluded ? "Excluded from synchronization" : view.status === "out-of-sync" ? "Needs attention" : view.status === "loading" ? "Loading" : view.status === "applying" ? "Applying interaction…" : state.source === view.device.id ? "Interaction source" : "Ready to follow"}
          </div>
          <button className="desktop-exclude" disabled={busy} title={view.excluded ? "Reopening all pages clears unsaved edits" : "Exclude this view from synchronization and capture"} onClick={() => void perform(() => window.atlasDesktop.exclude(view.device.id, !view.excluded))}>{view.excluded ? "Include and reload all" : "Exclude view"}</button>
        </section>)}
      </div>
    </main>
    <footer className="desktop-footer"><span>Open audit settings for full-page capture, checks, findings, and history.</span>
      {state?.lastExport && <button onClick={() => void perform(() => window.atlasDesktop.reveal())}><FolderOpen size={16} aria-hidden="true" />Show exported PDF</button>}
      <span className="desktop-session">{state?.latency.samples ? `Sync p95 ${Math.round(state.latency.p95)} ms · ${state.latency.samples} actions` : state?.projects.projects.find(p => p.id === state.projects.selectedId)?.temporary ? "Temporary browser session" : "Website sessions saved on this device"}</span>
    </footer>
  </div>
    <div className="desktop-review" style={{ display: reviewing ? undefined : "none" }}>
      <div className="desktop-review-bar"><button disabled={pending || state?.busy} onClick={() => void returnToBrowser()}>Return to live workspace</button>
        <span role="status">{error || (state?.busy ? "Audit in progress. Cancel it or wait before returning to live views." : "Device changes reopen the page and clear unsaved edits when you return.")}</span>
      </div>
      <App desktopUrl={state?.url} onReturnToBrowser={() => void returnToBrowser()} />
    </div>
  </>;
}
