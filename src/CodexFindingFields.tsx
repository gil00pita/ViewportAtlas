import type { CodexObservation } from "./codex-message";

export function CodexFindingFields({ finding }: { finding: CodexObservation }) {
  const priority = finding.severity === "info" ? "info" : finding.severity[0].toUpperCase() + finding.severity.slice(1);
  return (
    <>
      <span className="codex-source-tag">Codex</span>
      <dl className="codex-finding-fields">
        <div><dt>Priority:</dt><dd><span className={`severity-badge ${finding.severity}`}>{priority}</span></dd></div>
        <div><dt>Issue:</dt><dd className="codex-finding-issue">{finding.title}</dd></div>
        <div><dt>Impact:</dt><dd>{finding.impact}</dd></div>
        <div><dt>Recommendation:</dt><dd>{finding.recommendation}</dd></div>
      </dl>
    </>
  );
}
