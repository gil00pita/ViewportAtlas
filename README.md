# Viewport Atlas

**Every screen. One clear picture.** A local responsive preview and audit workspace, Chrome Manifest V3 extension, and Native Messaging companion. Uses the supplied SVG product mark, with generated 16/32/48/128px Chrome icons.

## Run locally

Requirements: Node.js 22+, npm, and macOS, Linux, or Windows for standalone mode. Native Messaging installation supports Google Chrome on macOS and Linux.

```sh
npm install
npm run install:browser
npm run dev
```

Open **http://127.0.0.1:4318**. The labeled Offgrid example is a real responsive HTML page rendered in Chromium, not a collection of mock screenshots. Enter another HTTP(S) URL to inspect it. No account or AI credentials are needed for browser checks.

For a production build:

```sh
npm run build
npm start
```

The app is served on loopback only. The companion and development frontend share port 4318. `dist/web` is the built workspace and `dist/extension` is the unpacked extension.

## Install the Chrome extension

1. Run `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked → dist/extension**.
3. Copy the extension's ID, then run:

   ```sh
   npm run install:native -- YOUR_CHROME_EXTENSION_ID
   ```

4. Restart any running companion, then reload the extension. Open a website and click the Viewport Atlas toolbar icon.

The native installer registers an executable wrapper in `~/.viewport-atlas` and a Google Chrome host manifest restricted to your exact extension ID. It records absolute Node and checkout paths; reinstall after moving either. Uninstall by deleting `com.viewportatlas.companion.json` from Chrome's `NativeMessagingHosts` directory and removing `~/.viewport-atlas/native-host` and `extension-id`.

Chrome displays its debugger warning when creating instrumented preview tabs. The tabs are ordinary Chrome tabs with the same profile's cookies and storage; do not close them during a review. Opening DevTools may detach the extension. Use **Reload all views** to reconnect. Restarting Chrome or the extension requires reconnecting views; saved audit files survive.

No site security headers are removed. Browser-internal pages, extension pages, DRM content, and pages restricted by enterprise policy cannot be captured. A failed view displays its reason and a retry action. The original page can be opened separately. Standalone mode supplies a separate Chromium session when extension instrumentation is unavailable, but does not inherit your Chrome login.

## Review workflow

Use the sun/moon button in the top bar to switch between light and dark themes. Light is the default, and your choice is remembered locally across reloads. Website previews and exported evidence retain their original appearance.

- Add presets or bounded custom viewports, rotate, drag to reorder, move left, hide, remove, and save device sets. Visual zoom preserves the browser viewport. Clicking a preview selects its interaction source.
- Navigation, clicks, scroll, and ordinary text input have independent synchronization controls. Input synchronization defaults off. Press Enter while a preview is focused to edit an ordinary focused text field; arrow keys scroll. Source actions are executed in the browser; follower actions use stable IDs, URLs, roles, and accessible names. Hidden or ambiguous targets are flagged instead of guessed.
- Follower clicks are limited to navigation and recognizable UI controls. Purchases, deletions, submissions, unclassified actions, passwords, payments, and file inputs are not repeated. These protections are conservative heuristics, not a transactional isolation boundary. Browser views may share server-side state.
- Choose a built-in profile, independently select categories and audit devices, and optionally write custom instructions. Six editable profiles cover general review, UX heuristics, accessibility, responsive layout, commerce, and landing pages. Create, duplicate, rename, delete, import, and export profiles in **Audit profiles**.
- **Capture** saves masked PNGs locally. **Run audit** captures selected views, executes checks, and retains original evidence. Default audit scope is the current page, with no crawl. Cancellation retains partial results. Failed and skipped checks appear in the methods list.
- Read the inline **Codex report** on the Findings tab. Each observation is a list item tagged **Codex**, with **Priority** (Critical, High, Medium, Low, or info), **Issue**, **Impact**, and **Recommendation**, in that order. Structured findings in live output use the same format. Running, failed, and disabled analysis remain visible there. **Review finding** opens the existing evidence and editing controls. Review all findings using category, severity, device, and verification filters; dismiss, merge, or add manual observations.
- In **Export report**, choose a **PDF layout** for preview or download. **Original** is selected by default: one canvas arranges all captured screens side by side at their original proportions, with findings and methods alongside, ready to import into a whiteboard. **A4** includes the report and puts each complete screenshot on its own page, scaled to fit without cropping. Both keep the full-resolution raster images embedded. PDF imports may flatten text depending on the whiteboard; use Export to Miro for editable board objects.
- **Export report** downloads or previews a PDF, exports structured JSON, and opens the complete output folder. PDF actions reconnect the companion in Chrome mode and fetch the report before opening a local preview or download; export failures appear in the workspace. Allow pop-ups for PDF previews, or use the download action. **Audit history** compares stable findings against the preceding completed review of the same URL, categories, and viewport set.

## What actually runs

| Check | Implementation | Interpretation |
| --- | --- | --- |
| Accessibility | axe-core 4.x, WCAG A/AA tags and best-practice rules | Automated findings; incomplete checks require manual verification. No compliance claim. |
| Responsive layout | Browser scroll-width versus viewport width | Measured overflow observation; may be intentional. |
| SEO | Title, meta description, primary heading count | Limited DOM checks; no SEO score. |
| Performance | Existing browser Navigation Timing entries | Diagnostic observations only. No simulated score, throttled benchmark, or Lighthouse performance result. |
| UX/UI | Overflow checks; optional Codex screenshot/evidence review | AI judgments explicitly labeled, or manual review required. |
| Best practices | Optional Codex review; otherwise manual verification | No Lighthouse score. |
| Lighthouse | Evaluated but not integrated with these active sessions | Explicitly **not run**. |

## Optional Codex analysis

Install and authenticate a current Codex CLI that supports `exec`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, image attachments, and `--output-schema`:

```sh
npm install -g @openai/codex
codex login
codex login status
```

Enable **Codex analysis** in audit settings. The app explains the exact evidence sent and requires acknowledgment before running. Optionally enable **Live Codex output** beneath it; this is off by default and opens Findings during the audit. CLI activity, public messages, warnings, and errors appear as they arrive. The CLI may deliver its structured answer near the end rather than streaming each word. Scroll up to read earlier output or choose **Follow output** to resume following it. Output is saved with the audit and can be expanded later in Audit history. The companion checks installation and authentication, invokes non-interactive `codex exec` with a read-only sandbox, disables shell tools, plugins, hooks, connectors, browser actions, and web search, ignores inherited user configuration, and validates structured output against a versioned schema. It uses an isolated temporary working directory and passes the prompt through stdin with `shell: false`.

Page text is explicitly untrusted evidence. CLI configuration, not page content, establishes the tool restrictions. No Codex desktop API or UI automation is used. Compatibility errors are reported as failed checks, including the underlying error from Codex's JSON output. AI findings remain unverified. AI processing may occur online; local orchestration does not imply offline inference. Model selection uses `ATLAS_CODEX_MODEL` first, then a simple top-level `model` setting in your Codex `config.toml`, then the CLI default. Other user configuration remains disabled. Choose a model available to your CLI account. AI invocations time out after three minutes and support cancellation.

Atlas suppresses the known development-feature banner for its isolated audit subprocess using Codex's [documented warning setting](https://learn.chatgpt.com/docs/config-file/config-reference). It keeps host-skill discovery disabled and does not edit your Codex configuration. If the CLI reports an ignored enterprise `ultrafast_mode` requirement, live output shows one informational compatibility notice per audit. Other policy warnings and fatal errors remain visible.

Enable **Include page code** beneath Codex analysis to send rendered HTML, matching readable CSS, and script URLs alongside screenshots. It defaults to off; changing it resets the pre-audit acknowledgment. Form values, masked subtrees, data attributes, inline scripts, event handlers, embedded documents, and generated CSS content are omitted. URLs in code omit credentials, queries, and fragments. This captures the current document, not React/Vue components, server code, JavaScript bundles, iframe contents, or shadow trees. Cross-origin stylesheets may be unreadable and are counted as unavailable. Snapshots are limited to 32,000 HTML characters, 16,000 CSS characters, and 2,500 visited DOM nodes per view; the Codex prompt allocates a smaller shared budget fairly across views when needed and marks truncation. Saved sanitized snapshots are under `page-code/<device-id>.json`. No code is collected when AI is disabled or this option is off. Reload the Chrome extension after updating to enable this capture capability.

## Evidence, masks, and local storage

Default output: `~/Documents/Viewport Atlas`. Choose and remember another destination under **Settings**; macOS supports a native folder picker, and other platforms accept an absolute path. Every run gets a timestamp and random suffix, preventing overwrites.

```text
<run-id>/
  report.pdf
  screenshots/<device-id>.png
  annotated/<finding-id>-<index>.png
  crops/<finding-id>-<index>.png
  page-code/<device-id>.json  # when Include page code is enabled
  findings.json
  profile.json
  metadata.json
  run.json
  board-export.json
  diagnostics.json
  miro-export.json          # after a Miro export attempt
```

`report.pdf` uses the Original canvas layout. Choosing A4 also creates `report-a4.pdf`; it does not replace the Original PDF. Very large Original canvases scale uniformly to stay within common PDF page-size limits, while retaining all embedded screenshot pixels.

Both PDF layouts include prioritized findings and methods and limitations. Original places intact screens and findings together on one canvas. A4 keeps readable evidence crops in the report and fits each intact screen onto its own page.

Captures render lossless PNGs at 2× pixel density in standalone and Chrome extension modes. A 393 × 852 CSS viewport produces a 786 × 1704 PNG; the browser renders at this density without upscaling an existing image. Full-page captures wait for fonts for at most two seconds, prepare lazy content in at most 16 scroll steps, and stop at 16,000 CSS pixels (32,000 PNG pixels). Truncation is recorded. Capture-time scroll and open details/tab state are retained as metadata. Original masked screenshots stay unchanged when annotations and crops are generated. Bounds remain in CSS pixels and are multiplied by the recorded device scale factor for crops and annotations. Screenshot annotation geometry and asset references remain editable in JSON. Older 1× evidence remains supported.

Passwords, payment autocomplete fields, and `[data-sensitive]` regions are masked. Add CSS selectors under **Advanced settings**. Invalid mask selectors fail the capture rather than producing unmasked evidence. Masked heading/link content is excluded from structured evidence; common sensitive URL query keys are redacted. These controls cannot automatically identify all sensitive content, including canvas-rendered data and unknown custom fields: review captures before AI or board export.

Profile and device preferences live in this browser's localStorage. Audit files and a run registry persist on disk. Standalone browser authentication state is in memory and is cleared when the companion stops. Native transport authentication is kept in a mode-0600 file under `~/.viewport-atlas`; it is not bundled in the extension.

Environment options:

| Variable | Purpose |
| --- | --- |
| `ATLAS_OUTPUT_DIR` | Default audit/capture directory |
| `ATLAS_STATE_DIR` | Companion registry and native token directory |
| `ATLAS_PORT` | Standalone/native service port; default 4318. The packaged extension targets 4318. |
| `ATLAS_CODEX_MODEL` | Optional CLI model selection |
| `MIRO_ACCESS_TOKEN` | Miro token, companion process only |

## Miro and Confluence

Set a Miro OAuth/developer token with `boards:read` and `boards:write` in the companion environment, then restart:

```sh
MIRO_ACCESS_TOKEN='your-token' npm start
```

Use **Export report → Miro**, choose a board, inspect the object counts, and explicitly export. The integration uses Miro REST v2 to list boards and create device frames, uploaded raster images, editable sticky notes, annotation rectangles, and connectors. Screenshot uploads are encoded as JPEG under Miro's 6 MB resource limit. A failure remains visible; local PDFs and evidence remain usable.

The on-disk operation ledger records successful object IDs and skips them on retries. An interrupted request with an unknown outcome stops automatic retry to prevent duplicate creation. Inspect the board, then reconcile its operation in `miro-export.json` with a completed ID or remove a confirmed-uncreated operation. This deliberate manual recovery is required because the creation endpoints do not provide a universal idempotency contract. Exporting the same run again currently preserves already-created objects; create a new run for a fresh board export after editing previously exported findings.

A portable JSON file is not a native Miro import. Screenshots do not become editable webpage layers. Confluence's documented Whiteboard endpoints create/read/delete whiteboards but expose no general editable canvas-object creation API. Use the PDF and local evidence package there; no editable Confluence export is claimed.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run test:extension
npm audit
```

The tests use real Chromium for viewport dimensions, CSP/X-Frame-Options restrictions, responsive semantic matching, ambiguous/hidden targets, SPA query/hash navigation, shared cookies, password protection, prevention of duplicated purchases, screenshot masking and truncation, prepared state, crop coordinate mapping, real axe findings, PDF output, and cancellation. Additional tests cover structured schemas, path containment, URL redaction, history comparison, native-message framing, authenticated loopback requests, and Miro retry ledgers. Miro transport is stubbed **only in unit tests**; production uses the actual API. No mocked audit results ship in the app.

See [architecture](docs/ARCHITECTURE.md), [schema](docs/SCHEMA.md), [validation notes](docs/VALIDATION.md), and [known limitations](docs/LIMITATIONS.md).

The example website's forest photograph is sourced from [Unsplash](https://images.unsplash.com/photo-1441974231531-c6227db76b6e); it is a demonstration asset, separate from the supplied product mark. All example copy is synthetic and explicitly labeled in the workspace and example page.
