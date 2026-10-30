import Ajv from "ajv";
const bounds = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", minimum: 0 },
        height: { type: "number", minimum: 0 },
      },
      required: ["x", "y", "width", "height"],
    },
  ],
};
export const findingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 120 },
    category: {
      type: "string",
      enum: [
        "Accessibility",
        "Performance",
        "UX / UI",
        "SEO",
        "Best practices",
      ],
    },
    title: { type: "string", maxLength: 500 },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low", "info"],
    },
    url: { type: "string" },
    devices: { type: "array", items: { type: "string" }, minItems: 1 },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          deviceId: { type: "string" },
          screenshot: { type: "string" },
          locator: { type: "string" },
          bounds,
          crop: { type: "string" },
          annotation: { type: "string" },
        },
        required: ["deviceId", "screenshot", "locator", "bounds"],
      },
    },
    impact: { type: "string", maxLength: 10000 },
    recommendation: { type: "string", maxLength: 10000 },
    source: { type: "string", enum: ["axe-core", "browser", "codex", "manual"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    status: { type: "string", enum: ["unverified", "verified", "dismissed"] },
    rule: { type: "string" },
  },
  required: [
    "id",
    "category",
    "title",
    "severity",
    "url",
    "devices",
    "evidence",
    "impact",
    "recommendation",
    "source",
    "confidence",
    "status",
  ],
};
// All properties are required for Codex's strict structured-output contract.
const aiFinding = structuredClone(findingSchema);
delete aiFinding.properties.rule;
aiFinding.properties.source = { type: "string", const: "codex" };
aiFinding.properties.status = { type: "string", const: "unverified" };
aiFinding.properties.evidence.items.properties = {
  deviceId: { type: "string" },
  screenshot: { type: "string" },
  locator: { type: "string" },
  bounds,
};
aiFinding.required = Object.keys(aiFinding.properties);
export const aiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: { type: "array", maxItems: 60, items: aiFinding },
  },
  required: ["summary", "findings"],
};
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(findingSchema);
const validateAi = ajv.compile(aiSchema);
export function validateFinding(f) {
  if (!validate(f))
    throw new Error(`Finding schema v1: ${ajv.errorsText(validate.errors)}`);
  return f;
}
export function validateAiResult(result) {
  if (!validateAi(result))
    throw new Error(
      `Codex result rejected: ${ajv.errorsText(validateAi.errors)}`,
    );
  return result;
}
