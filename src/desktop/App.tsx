import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Camera, FolderOpen, Monitor, Pause, Play, RotateCw } from "lucide-react";
import type { DesktopState } from "./types";

const EXAMPLE = "atlas://example/index.html";
export function DesktopApp() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [address, setAddress] = useState(EXAMPLE);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const stop = window.atlasDesktop.subscribe((next) => { if (active) setState(next); });
    window.atlasDesktop.state().then((next) => { if (active) setState(next); }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; stop(); };
  }, []);
  const deviceCount = state?.views.length || 0;
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !deviceCount) return;
    const slots = [...element.querySelectorAll<HTMLElement>("[data-browser-slot]")];
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const overhead = Math.max(...slots.map((slot) => slot.getBoundingClientRect().top - bounds.top + (slot.nextElementSibling?.getBoundingClientRect().height || 0)));
        const totalWidth = slots.reduce((sum, slot) => sum + Number(slot.dataset.viewportWidth), 0);
        const maxHeight = Math.max(...slots.map((slot) => Number(slot.dataset.viewportHeight)));
        const scale = Math.max(.05, Math.min((element.clientWidth - 20 * (slots.length - 1)) / totalWidth, (element.clientHeight - overhead) / maxHeight, 1));
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
  }, [deviceCount]);

  async function perform(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }
  const busy = pending || state?.busy || !state;
  return <div className="desktop-app">
    <header className="desktop-header">
      <div className="desktop-brand"><img src="./viewport-atlas-logo.svg" width="42" height="42" alt="" /><span>Viewport Atlas</span></div>
      <span className="desktop-release">Desktop preview</span>
      <button className="desktop-capture" disabled={busy || Boolean(state?.problem) || state?.paused} onClick={() => void perform(() => window.atlasDesktop.capture())}>
        <Camera size={17} aria-hidden="true" />{pending ? "Working…" : "Capture & export PDF"}
      </button>
    </header>
    <main className="desktop-main">
      <div className="desktop-heading"><div><h1>Responsive workspace</h1><p>Browse in any view. Your other screens follow.</p></div>
        <button className="desktop-example" disabled={busy} onClick={() => { setAddress(EXAMPLE); void perform(() => window.atlasDesktop.navigate(EXAMPLE)); }}>Open example</button>
      </div>
      <form className="desktop-address" onSubmit={(event) => { event.preventDefault(); void perform(() => window.atlasDesktop.navigate(address)); }}>
        <Monitor size={18} aria-hidden="true" /><label className="desktop-sr-only" htmlFor="website-address">Website address</label>
        <input id="website-address" value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} placeholder="https://your-website.com" />
        <button type="submit" disabled={busy}>Open website <ArrowRight size={16} aria-hidden="true" /></button>
      </form>
      <div className="desktop-tools">
        <span className={`desktop-sync ${state?.paused ? "is-paused" : ""}`}><span className="desktop-status-dot" />{state?.paused ? "Synchronization paused" : "Focus & typing synchronized"}</span>
        <span className="desktop-tools-help">Text edits follow across all three sizes.</span>
        <button disabled={busy || Boolean(state?.problem)} onClick={() => void perform(() => window.atlasDesktop.pause(!state?.paused))}>
          {state?.paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{state?.paused ? "Resume sync" : "Pause sync"}
        </button>
        <button disabled={busy} onClick={() => void perform(() => window.atlasDesktop.navigate(state?.url || EXAMPLE))}><RotateCw size={15} aria-hidden="true" />Reload views</button>
      </div>
      <div className="desktop-message" role={error || state?.problem ? "alert" : "status"}>
        {error || state?.problem || (state?.busy ? "Preparing viewport evidence…" : "Click a text field and type directly. Reload views starts fresh and clears unsaved page edits.")}
      </div>
      <div className="desktop-canvas" ref={canvas}>
        {state?.views.map((view) => <section className="desktop-device" key={view.device.id} style={{ flex: view.device.width }} aria-label={`${view.device.name} browser view`}>
          <div className="desktop-device-heading"><h2>{view.device.name}</h2><span>{view.device.width} × {view.device.height}</span></div>
          <div className="desktop-browser-slot" data-browser-slot={view.device.id} data-viewport-width={view.device.width} data-viewport-height={view.device.height} style={{ aspectRatio: `${view.device.width} / ${view.device.height}` }}>
            {view.status === "loading" ? "Opening page…" : state.busy ? "Capturing…" : ""}
          </div>
          <div className={`desktop-device-status ${view.status === "out-of-sync" ? "has-error" : ""}`}>
            {view.status === "out-of-sync" ? "Needs attention" : view.status === "loading" ? "Loading" : view.status === "applying" ? "Applying interaction…" : state.source === view.device.id ? "Interaction source" : "Ready to follow"}
          </div>
        </section>)}
      </div>
    </main>
    <footer className="desktop-footer"><span>Current-viewport capture available. Audits and flow recording are next.</span>
      {state?.lastExport && <button onClick={() => void perform(() => window.atlasDesktop.reveal())}><FolderOpen size={16} aria-hidden="true" />Show exported PDF</button>}
      <span className="desktop-session">Website sessions saved on this device</span>
    </footer>
  </div>;
}
