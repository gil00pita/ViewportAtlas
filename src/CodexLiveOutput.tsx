import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import type { Run } from "./types";
import { CodexFindingFields } from "./CodexFindingFields";
import { readCodexObservations } from "./codex-message";

function CodexMessage({ message }: { message: string }) {
  const findings = readCodexObservations(message);
  if (findings) return findings.length ? (
    <ol className="codex-live-findings">
      {findings.map((finding, index) => <li key={index}><CodexFindingFields finding={finding} /></li>)}
    </ol>
  ) : <p className="codex-output-empty">Codex reported no additional findings.</p>;
  if (/^\s*(?:```(?:json)?\s*)?[{[]/.test(message)) {
    return <p className="codex-output-note">Codex is preparing structured findings. The validated list appears in the report when analysis finishes.</p>;
  }
  return <pre>{message}</pre>;
}

export function CodexLiveOutput({ run }: { run: Run }) {
  const output = run.codexOutput;
  const active = run.status === "running" && !run.checks.some((check) => check.name === "Codex analysis");
  const log = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [output, follow]);

  return (
    <details className="codex-live-output" open={active}>
      <summary>
        <span><Terminal size={15} aria-hidden="true" /> Live Codex output</span>
        <span>{active ? output?.length ? "Live" : "Waiting" : run.status === "cancelled" ? "Stopped" : "Saved"}</span>
      </summary>
      {output?.length ? (
        <ol
          className="codex-output-lines"
          ref={log}
          role="log"
          aria-label="Codex output"
          aria-live="polite"
          aria-relevant="additions text"
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;
            setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 32);
          }}
        >
          {output.map((entry) => (
            <li key={entry.id} className={`codex-output-line ${entry.type}`}>
              <div>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time>
                <span>{entry.type}</span>
              </div>
              {entry.type === "message" ? <CodexMessage message={entry.message} /> : <pre>{entry.message}</pre>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="codex-output-empty">{active ? "Output will appear here when Codex starts reviewing the evidence." : "No live output was recorded."}</p>
      )}
      {!follow && <button className="text-button" onClick={() => setFollow(true)}>Follow output</button>}
      {run.codexOutputTruncated && <p className="codex-output-note">Earlier entries or long messages were shortened to keep the output bounded.</p>}
    </details>
  );
}
