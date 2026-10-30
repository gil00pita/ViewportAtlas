import { ArrowUpRight, Loader2 } from "lucide-react";
import type { Finding, Run } from "./types";
import { CodexLiveOutput } from "./CodexLiveOutput";
import { CodexFindingFields } from "./CodexFindingFields";
import "./codex-report.css";

export function CodexReport({
  run,
  onReviewFinding,
}: {
  run: Run;
  onReviewFinding: (finding: Finding) => void;
}) {
  const check = run.checks.find((item) => item.name === "Codex analysis");
  const findings = run.findings.filter((finding) => finding.source === "codex");
  const devices = new Map(run.devices.map((device) => [device.id, device.name]));
  const completed = check?.status === "completed" || (!check && Boolean(run.summary));
  const failed = check?.status === "failed";
  const pending = !check && run.profile.ai && run.status === "running";
  const status = completed ? "Complete" : failed ? "Failed" : pending ? "In progress" : "Not run";

  return (
    <section className="codex-report" aria-labelledby="codex-report-title">
      <header className="codex-report-header">
        <h3 id="codex-report-title">Codex report</h3>
        <span className={`codex-report-status ${failed ? "failed" : ""}`}>
          {pending && <Loader2 size={14} className="spin" aria-hidden="true" />}
          {status}
        </span>
      </header>
      {run.profile.liveCodexOutput && <CodexLiveOutput key={run.id} run={run} />}
      {completed ? (
        <>
          {run.summary && <p className="codex-report-summary">{run.summary}</p>}
          <p className="codex-report-note">
            {findings.length} AI observation{findings.length === 1 ? "" : "s"}. AI judgments require verification.
          </p>
          {findings.length ? (
            <ol className="codex-report-findings">
              {findings.map((finding) => (
                <li key={finding.id}>
                  <article className="codex-report-finding">
                    <CodexFindingFields finding={finding} />
                    <p className="codex-report-meta">
                      {finding.category} · {finding.devices.map((id) => devices.get(id) || id).join(", ")} · {finding.status}
                    </p>
                    <button
                      className="text-button"
                      aria-label={`Review finding: ${finding.title}`}
                      onClick={() => onReviewFinding(finding)}
                    >
                      Review finding <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <p className="codex-report-message">Codex recorded no additional findings. Review the browser checks and audit limitations below.</p>
          )}
        </>
      ) : (
        <div role={failed ? "alert" : "status"} className="codex-report-message">
          {failed ? (
            <>
              <p>{check.detail}</p>
              <p>Resolve the reported issue, then run a new audit with Codex analysis enabled. Captured evidence and browser findings are saved.</p>
            </>
          ) : pending ? (
            <p>{run.progress.includes("Codex") ? "Codex is reviewing the captured screenshots and page evidence. Its report will appear here when analysis finishes." : "Codex analysis will start after the screenshots and browser checks are ready."}</p>
          ) : (
            <p>{check?.detail || (run.profile.ai ? "This audit ended before Codex analysis completed. Run a new audit to generate its report." : "Codex analysis was disabled for this audit. Enable it in audit settings before running a new review.")}</p>
          )}
        </div>
      )}
    </section>
  );
}
