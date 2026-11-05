import { useState } from "react";
import type { Device } from "../types";

type DeviceSet = { name: string; devices: Device[] };
export function DeviceSettings({ devices, sets, onDevices, onSets }: {
  devices: Device[]; sets: DeviceSet[]; onDevices: (devices: Device[]) => void; onSets: (sets: DeviceSet[]) => void;
}) {
  const [draft, setDraft] = useState(devices);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  function apply(next: Device[]) {
    setDraft(structuredClone(next));
    onDevices(structuredClone(next));
    setMessage("Devices saved. Return to the live workspace to open these sizes.");
  }
  return <section className="content-panel settings-section desktop-device-settings">
    <h2>Devices and saved sets</h2>
    <p>Changing the live device set reopens the page and clears unsaved page edits.</p>
    <form onSubmit={event => { event.preventDefault(); apply(draft); }}>
      {draft.map((device, index) => <div className="desktop-device-fields" key={device.id}>
        <label>Name<input required maxLength={100} aria-label={`Device ${index + 1} name`} value={device.name} onChange={event => setDraft(draft.map(d => d.id === device.id ? { ...d, name: event.target.value } : d))} /></label>
        <label>Width<input type="number" required min={280} max={3840} aria-label={`Device ${index + 1} width`} value={device.width} onChange={event => setDraft(draft.map(d => d.id === device.id ? { ...d, width: Number(event.target.value) } : d))} /></label>
        <label>Height<input type="number" required min={320} max={2160} aria-label={`Device ${index + 1} height`} value={device.height} onChange={event => setDraft(draft.map(d => d.id === device.id ? { ...d, height: Number(event.target.value) } : d))} /></label>
        <button className="button small" type="button" aria-label={`Remove ${device.name}`} disabled={draft.length === 1} onClick={() => setDraft(draft.filter(d => d.id !== device.id))}>Remove</button>
      </div>)}
      <button className="button" type="submit">Save devices</button>
    </form>
    <form className="desktop-save-set" onSubmit={event => {
      event.preventDefault();
      const label = name.trim();
      if (!label) return;
      onSets([...sets.filter(set => set.name !== label), { name: label, devices: structuredClone(devices) }]);
      setName(""); setMessage(`Saved device set: ${label}.`);
    }}>
      <label htmlFor="desktop-set-name">Save the current devices as a set</label>
      <div><input id="desktop-set-name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Device set name" /><button className="button" type="submit" disabled={sets.length >= 100}>Save set</button></div>
    </form>
    {sets.map(set => <div className="desktop-set-row" key={set.name}><span>{set.name} · {set.devices.length} devices</span>
      <button className="button small" aria-label={`Use set ${set.name}`} onClick={() => apply(set.devices)}>Use set</button>
      <button className="button small" aria-label={`Delete ${set.name}`} onClick={() => onSets(sets.filter(s => s.name !== set.name))}>Delete</button>
    </div>)}
    <p role="status">{message}</p>
  </section>;
}
