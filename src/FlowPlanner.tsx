import { useEffect, useRef, useState } from "react";
import { Circle, Square, Plus, Trash2, Route, FileText, Loader2, AlertTriangle } from "lucide-react";
import type { Run } from "./types";
import type { useFlowPlanner } from "./use-flow-planner";
import "./flow-planner.css";
import { desktopMode } from "./api";

export function FlowPlanner({ flow, masks, disabled, onOpenRun }: {
  flow: ReturnType<typeof useFlowPlanner>;
  masks: string;
  disabled: boolean;
  onOpenRun: (run: Pick<Run, "id">) => void;
}) {
  const [autoScreens, setAutoScreens] = useState(false);
  const { state, plan, pending, perform, running, recording } = flow;
  const jobRef = useRef<HTMLDivElement>(null);
  const jobId = state?.job?.id;
  useEffect(() => {
    if (running) jobRef.current?.scrollIntoView({ block: "start" });
  }, [jobId, running]);
  const locked = disabled || running || pending;
  return <section className="flow-planner" aria-label="User flow planner">
    <div className="flow-intro">
      <Route size={18} />
      <div><h3>Plan the journey. Audit it later.</h3><p>Walk through your website and save the screens that matter. Replay checks them across your selected devices.</p></div>
    </div>
    {recording ? <>
      <p className="flow-recording" role="status"><Circle size={10} fill="currentColor" />{desktopMode ? "Recording your live workspace" : "Recording your website tab"}</p>
      <div className="flow-actions">
        <button className="button" disabled={locked} onClick={() => perform("/flows/checkpoint")}><Plus size={15} />Save screen</button>
        <button className="button" disabled={locked} onClick={() => perform("/flows/stop")}><Square size={13} />Stop recording</button>
      </div>
    </> : <>
      {plan?.interruption && <>
        <p className="flow-error" role="status"><AlertTriangle size={15} />{plan.error}</p>
        <button className="button flow-record-button" disabled={locked} onClick={() => perform("/flows/resume", "POST", { masks })}><Circle size={14} />Resume recording</button>
        <p className="flow-privacy">{desktopMode ? "Continue in the live workspace, or reopen the website if it closed." : "Continue in the original website tab, or reopen it if it closed."} Review any missed actions, then remove the recording-gap step before running the audit.</p>
      </>}
      <button className="button flow-record-button" disabled={locked} onClick={() => perform("/flows/record", "POST", { masks, autoScreens })}><Circle size={14} />Record a new flow</button>
      <label className="flow-option"><input type="checkbox" checked={autoScreens} disabled={locked} onChange={(event) => setAutoScreens(event.target.checked)} />Save screens automatically after interactions</label>
    </>}
    <p className="flow-privacy">Clicks, UI states, and ordinary text entries are saved locally. Passwords, payment fields, and masked regions are excluded.</p>
    {Boolean(state?.plans.length) && <label className="flow-saved-label">Saved flow
      <select aria-label="Saved flow" value={state?.selectedId || ""} disabled={locked || recording} onChange={(event) => perform("/flows/select", "POST", { id: event.target.value })}>
        {state?.plans.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {plan && <div className="flow-plan">
      <div className="flow-plan-heading">
        <input key={plan.id} aria-label="Flow name" defaultValue={plan.name} disabled={locked || recording} onBlur={(event) => {
          if (event.target.value !== plan.name) void perform("/flows/plan", "PATCH", { name: event.target.value });
        }} />
        <button className="icon-button" aria-label="Delete saved flow" title="Delete saved flow" disabled={locked || recording} onClick={() => perform("/flows/delete", "POST", { id: plan.id })}><Trash2 size={14} /></button>
      </div>
      <p className="flow-count">{plan.steps.filter((step) => step.type === "checkpoint" && step.audit).length} screens selected · {plan.steps.length} steps</p>
      {plan.error && (!plan.interruption || recording) && <p className="flow-error"><AlertTriangle size={15} />{plan.error}</p>}
      <ol className="flow-steps" aria-label="Recorded steps">
        {plan.steps.map((step, index) => <li key={step.id} className={step.type === "blocked" ? "flow-blocked" : ""}>
          <span className="flow-step-index">{index + 1}</span>
          {step.type === "checkpoint" ? <label className="flow-screen">
            <input type="checkbox" aria-label={`Audit screen: ${step.label}`} checked={Boolean(step.audit)} disabled={locked || recording} onChange={(event) => perform("/flows/plan", "PATCH", { stepId: step.id, audit: event.target.checked })} />
            <input aria-label={`Screen name ${index + 1}`} defaultValue={step.label} disabled={locked || recording} onBlur={(event) => {
              if (event.target.value !== step.label) void perform("/flows/plan", "PATCH", { stepId: step.id, label: event.target.value });
            }} />
          </label> : <span className="flow-step-label"><strong>{{ blocked: "Review required", input: "Edit field", control: "Change widget", click: "Click", navigate: "Navigate", scroll: "Scroll", key: "Keyboard", hover: "Hover", drag: "Drag/drop", "double-click": "Double-click" }[step.type]}</strong>{step.label}</span>}
          <button className="icon-button" title="Remove step" aria-label={`Remove step ${index + 1}`} disabled={locked || recording} onClick={() => perform("/flows/plan", "PATCH", { removeStep: step.id })}><Trash2 size={12} /></button>
        </li>)}
      </ol>
    </div>}
    {state?.job && <div className="flow-job" ref={jobRef} aria-label="Flow audit progress">
      <h3>{state.job.name}</h3>
      <p className="flow-job-status" role="status">{running && <Loader2 size={14} className="spin" />}{state.job.progress}</p>
      {state.job.error && <p className="flow-error"><AlertTriangle size={15} />{state.job.error}</p>}
      {state.job.screens.map((screen) => <div className="flow-screen-result" key={screen.stepId}>
        <div><strong>{screen.label}</strong><span>{screen.error || screen.status}</span></div>
        {screen.runId && <button className="text-button" onClick={() => onOpenRun({ id: screen.runId! })}><FileText size={14} />Report</button>}
      </div>)}
    </div>}
  </section>;
}
