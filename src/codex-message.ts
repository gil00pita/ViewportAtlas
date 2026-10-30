import type { Finding } from "./types";

export type CodexObservation = Pick<Finding, "severity" | "title" | "impact" | "recommendation">;

// Read the same structured fields used by the validated audit result.
export function readCodexObservations(message: string): CodexObservation[] | null {
  try {
    const result = JSON.parse(message.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\s*```$/, ""));
    if (!Array.isArray(result?.findings)) return null;
    const valid = result.findings.every((finding: unknown) => {
      if (!finding || typeof finding !== "object") return false;
      const item = finding as Record<string, unknown>;
      return typeof item.severity === "string" && ["critical", "high", "medium", "low", "info"].includes(item.severity) &&
        [item.title, item.impact, item.recommendation].every((value) => typeof value === "string" && value.trim());
    });
    return valid ? result.findings : null;
  } catch {
    return null;
  }
}
