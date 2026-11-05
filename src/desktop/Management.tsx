import { useState } from "react";
import type { DesktopState } from "./types";

export function Management({ state, perform, error }: { state: DesktopState; perform: (action: () => Promise<unknown>) => Promise<void>; error: string }) {
  const [name, setName] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [selected, setSelected] = useState(state.projects.selectedId);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof window.atlasDesktop.data>>>(null);
  const [testOrigin, setTestOrigin] = useState("");
  const [mapping, setMapping] = useState({ source: "", viewId: state.views[0]?.device.id || "", selector: "", prepare: "" });
  const project = state.projects.projects.find(p => p.id === state.projects.selectedId);
  return <section className="desktop-management" aria-label="Projects and local data">
    <h2>Projects and local data</h2>
    {error && <p role="alert">{error}</p>}
    <p>{project?.name} · {project?.temporary ? "Temporary browser session; sign-ins clear when the app closes." : "Sign-ins are stored only in this project's browser session."}</p>
    {state.projects.unavailableReports.map(report => <p role="alert" key={report.id}>{report.id}: {report.detail}</p>)}
    <form onSubmit={event => { event.preventDefault(); void perform(() => window.atlasDesktop.project("select", { id: selected })); }}>
      <label>Saved project<select aria-label="Saved project" value={selected} onChange={event => setSelected(event.target.value)}>{state.projects.projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.temporary ? " (temporary session)" : ""}</option>)}</select></label>
      <button type="submit" disabled={selected === state.projects.selectedId}>Open project</button>
    </form>
    <form onSubmit={event => { event.preventDefault(); void perform(() => window.atlasDesktop.project("create", { name, temporary })); }}>
      <label>New project name<input aria-label="New project name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="desktop-check"><input type="checkbox" checked={temporary} onChange={event => setTemporary(event.target.checked)} />Temporary browser session</label>
      <button type="submit">Create project</button>
    </form>
    <div className="desktop-management-actions"><button onClick={() => void perform(() => window.atlasDesktop.project("clear-login"))}>Clear this project's sign-ins</button>
      <button onClick={() => void perform(() => window.atlasDesktop.data("export"))}>Export project data</button>
      <button onClick={() => void perform(async () => setPreview(await window.atlasDesktop.data("preview-import")))}>Preview data import</button>
    </div>
    <p>Exports include settings, ordinary recorded form entries, flows, and references to report folders. Cookies and browser credentials are excluded. Keep the evidence folders with the package.</p>
    {preview && <div role="status"><p>Import preview: {preview.counts.preferences} settings, {preview.counts.profiles} profiles, {preview.counts.flows} flows, {preview.counts.mappings} counterpart mappings, {preview.counts.reports} reports. {preview.counts.duplicates} duplicates skipped. Current settings are backed up before importing.</p>
      <button onClick={() => void perform(() => window.atlasDesktop.data("apply-import", { token: preview.token }))}>Apply this import</button>
    </div>}
    <h2>Application updates</h2><p role="status">{state.update?.detail}</p>
    <button disabled={state.update?.status === "disabled"} onClick={() => void perform(() => window.atlasDesktop.update("check"))}>Check for updates</button>
    {state.update?.status === "ready" && <button onClick={() => void perform(() => window.atlasDesktop.update("install"))}>Restart to update</button>}
    <h2>Responsive counterparts</h2><p>Map a source control's test ID, ID, or destination to a unique CSS selector in another viewport. An optional preparation button must explicitly control the corresponding menu.</p>
    <form onSubmit={event => { event.preventDefault(); void perform(() => window.atlasDesktop.mapping(mapping)); }}>
      <label>Source identifier<input required value={mapping.source} onChange={event => setMapping({ ...mapping, source: event.target.value })} /></label>
      <label>Follower viewport<select value={mapping.viewId} onChange={event => setMapping({ ...mapping, viewId: event.target.value })}>{state.views.map(view => <option value={view.device.id} key={view.device.id}>{view.device.name}</option>)}</select></label>
      <label>Counterpart selector<input required value={mapping.selector} onChange={event => setMapping({ ...mapping, selector: event.target.value })} /></label>
      <label>Menu preparation selector (optional)<input value={mapping.prepare} onChange={event => setMapping({ ...mapping, prepare: event.target.value })} /></label>
      <button type="submit">Validate and save mapping</button>
    </form>
    {state.mappings.map(item => <p key={`${item.source}:${item.viewId}`}>{item.source} → {item.viewId}: {item.selector} <button onClick={() => void perform(() => window.atlasDesktop.mapping({ ...item, selector: "" }))}>Remove mapping</button></p>)}
    <h2>Consequential actions in a test environment</h2><p>By default purchases, deletions, and submissions run once. This session-only test mode repeats them in every viewport at the exact chosen origin. Use an isolated test site; shared cookies do not isolate server actions. Private fields remain excluded.</p>
    {state.testOrigin ? <button onClick={() => void perform(() => window.atlasDesktop.testMode(""))}>Disable consequential-action test mode</button> : <form onSubmit={event => { event.preventDefault(); void perform(() => window.atlasDesktop.testMode(testOrigin)); }}>
      <label>Test environment origin<input required type="url" placeholder="https://test.example.com" value={testOrigin} onChange={event => setTestOrigin(event.target.value)} /></label><button type="submit">Enable for this session</button>
    </form>}
  </section>;
}
