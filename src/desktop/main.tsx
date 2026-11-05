import { createRoot } from "react-dom/client";
import { DesktopApp } from "./App";
import { PROFILES } from "../types";
import "../styles.css";
import "../themes.css";
import "./styles.css";

async function start() {
  const preferences = await window.atlasDesktop.preferences();
  for (const key of Object.keys(localStorage)) if (key.startsWith("atlas-")) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, JSON.stringify(value));
  const state = await new Promise<Awaited<ReturnType<typeof window.atlasDesktop.state>>>((resolve, reject) => {
    const accept = (next: Awaited<ReturnType<typeof window.atlasDesktop.state>>) => {
      if (next.views.length && !next.busy && next.views.every(view => view.status === "ready" || view.status === "out-of-sync")) { stop(); resolve(next); }
    };
    const stop = window.atlasDesktop.subscribe(accept);
    void window.atlasDesktop.state().then(accept).catch(error => { stop(); reject(error); });
  });
  // Desktop device IDs predate the shared review profiles.
  if (!localStorage.getItem("atlas-devices")) localStorage.setItem("atlas-devices", JSON.stringify(state.views.map(v => v.device)));
  if (!localStorage.getItem("atlas-profiles")) localStorage.setItem("atlas-profiles", JSON.stringify(PROFILES.map(profile => ({
    ...profile, devices: profile.devices.map(id => id === "iphone-15" ? "phone" : id === "ipad-air" ? "tablet" : id),
  }))));
  createRoot(document.getElementById("root")!).render(<DesktopApp />);
}
void start().catch(error => { document.getElementById("root")!.textContent = `The workspace could not open: ${error.message}`; });
