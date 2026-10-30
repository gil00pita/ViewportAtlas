# Evidence schema v1

`run.json` is the complete local run. `findings.json` contains `{ schemaVersion: 1, findings: [...] }`; `board-export.json` is a portable export with run ID, device groupings, screenshots, findings, editable annotation bounds, and asset references. These are product formats, not arbitrary third-party board imports.

The executable finding schema is [companion/schema.mjs](../companion/schema.mjs). Codex's stricter schema requires every field and disallows additional properties. The companion validates AI results and every edited/manual finding.

| Finding field | Meaning |
| --- | --- |
| `id` | Stable SHA-256-derived identifier for automated findings; a unique ID for manual observations |
| `category` | Accessibility, Performance, UX / UI, SEO, or Best practices |
| `title` | Editable finding text |
| `severity` | critical, high, medium, low, info |
| `url` | Affected URL, with common credential query fields redacted |
| `devices` | IDs from the audited viewport set |
| `evidence` | Device-specific screenshot, locator, nullable capture-time bounds, optional crop and annotation references |
| `impact` | Observable user impact |
| `recommendation` | Actionable remediation or manual verification |
| `source` | axe-core, browser, codex, or manual |
| `confidence` | 0–1 confidence in evidence; a value of 1 for automated detection does not imply confirmed user impact |
| `status` | unverified, verified, dismissed |
| `rule` | Optional tool rule ID |

Evidence bounds are `{x, y, width, height}` in CSS pixels relative to the screenshot's origin. New captures render at device scale factor 2. Screenshot entries retain `width` and `height` in CSS pixels and add `pixelWidth`, `pixelHeight`, and `deviceScaleFactor`; PNG dimensions equal CSS dimensions multiplied by the scale. Missing scale metadata on older evidence means 1×. Full-page screenshots use document coordinates; viewport-only captures subtract the recorded scroll origin. Regions beyond truncated captures are not cropped. Original bounds are retained; crop padding is 18 CSS pixels, clamped to screenshot edges. Crop extraction and annotation rendering multiply CSS coordinates by the screenshot's scale.

Asset references have the form `/evidence/<run-id>/<kind>/<file>.png` and map to the same relative paths within the run folder. For offline tooling, strip `/evidence/<run-id>/` and resolve against that run's directory. The original image stays in `screenshots/`; annotations and focused crops are separate assets. AI-supplied screenshot references are replaced with the matching run-owned asset before saving.

`metadata.json` preserves engine, viewport sizes, device scale factor, capture conditions, initial scroll, selected tabs/open details, timestamps, capture limits, and check statuses. A check status is `completed`, `failed`, `not_run`, or `manual_required`. `completed` means that method ran; it does not mean every rule passed.

`comparison` contains new, resolved, and recurring finding IDs. The baseline must be the preceding completed run with matching URL, categories, exact device dimensions, masks, capture mode, AI setting, and AI instructions where enabled. Failed checks prevent comparison. Manual observations are excluded. “Resolved” means not observed under the matching checks in this run and still needs human confirmation. Device-specific evidence is retained when repeated issues are merged.

`miro-export.json` contains per-board operation keys, creation states, and returned Miro object IDs. `pending` means an uncertain network outcome; the exporter stops rather than repeating it automatically. This ledger never contains the Miro token.
