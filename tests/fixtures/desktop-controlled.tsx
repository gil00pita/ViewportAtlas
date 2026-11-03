import { createRoot } from "react-dom/client";
import { useState } from "react";
function Form() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const suffix = innerWidth < 600 ? "mobile" : "wide";
  return <main>
    <h1>Desktop synchronization fixture</h1>
    <label htmlFor={`name-${suffix}`}>Your name</label>
    <input id={`name-${suffix}`} name="name" value={name} onChange={(event) => setName(event.target.value)} />
    <p id="name-state">{name}</p>
    <label htmlFor="notes">Notes</label>
    <textarea id="notes" name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
    <p id="notes-state">{notes}</p>
    <label htmlFor="private">Password</label><input id="private" type="password" defaultValue="secret-never-export" />
    <div data-sensitive style={{ background: "rgb(255, 0, 0)", width: 80, height: 70 }}>Private<input type="password" aria-label="Nested private field" defaultValue="nested-secret" /></div>
    <details id="details"><summary>More details</summary><p>Open state</p></details>
    <button type="button" id="purchase" onClick={() => { document.body.dataset.purchases = String(Number(document.body.dataset.purchases || 0) + 1); }}>Buy now</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Form />);
