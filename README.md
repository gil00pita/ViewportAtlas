# Viewport Atlas

**Every screen. One clear picture.** A local responsive preview and audit workspace with a standalone desktop preview, Chrome Manifest V3 extension, and Native Messaging companion. Uses the supplied SVG product mark, with generated 16/32/48/128px Chrome icons.

## Run locally

### Standalone desktop preview

The desktop implementation includes live responsive browsing, shared audit/review controls, journey recording/replay, projects, and data transfer. macOS and Windows are build targets; release verification remains open.

```sh
npm install
npm start
```

`npm start` builds and launches the desktop app; `npm run desktop` remains an alias. `npm run build` produces the desktop renderer in `dist/desktop`.

For development, run `npm run dev` (or `npm run dev:desktop`). It watches renderer, desktop runtime, shared companion, and public asset files, rebuilds the renderer, and restarts Electron after successful builds. Restarts discard unsaved page state and interrupt active recordings or audits. Build errors appear in the terminal; fixing them resumes the loop. Run `npm run typecheck` separately for TypeScript diagnostics. Restart the command after changing Vite configuration. Press Ctrl+C to stop the watcher and Electron.

The app bundles Electron's Chromium runtime and opens three real browser views (393 × 852, 820 × 1180, and 1440 × 900). It runs without the extension, Native Messaging registration, the loopback companion, or a separate Playwright browser installation. Development requires Node.js 22.13+; packaged apps include the runtime.

Open the synthetic example or enter an HTTP(S) URL. Interact directly in any view: supported ordinary controls follow across the others while the source keeps keyboard focus. The implementation includes text/selection edits, committed Unicode input, React controlled fields, checkbox/radio/select and value controls, document/nested scrolling, navigation/history, hover, plain contenteditable, DOM drag/drop, and open-shadow controls. Real IME composition, native picker behavior, and platform shortcuts still require manual checks. Canvas, frame internals, closed-shadow controls, file uploads, and arbitrary custom gestures require independent preparation. Text is bounded to 4,000 characters per field.

Synchronization pauses visibly for ambiguous or unsupported controls, a source handoff before the preceding action is acknowledged, and consequential actions. **Projects & data → Responsive counterparts** validates saved mappings and optional menu-preparation controls. Prepare the missing counterpart and use **Retry prepared counterparts** when offered, or exclude the affected view. Excluded views are omitted from synchronization and capture; including one reloads all pages. **Pause sync** permits independent preparation, but changing a view while paused requires **Reload views** before resuming. Reloading discards unsaved page edits. The footer displays observed synchronization p95 and sample count when available; this is not a performance-target claim.

Purchases, deletions, and submissions run once in the source by default. A session-only test mode can repeat them at an explicitly chosen test origin. Private fields remain excluded. These controls use conservative heuristics, and shared cookies do not isolate server actions. A supported popup requires explicit permission for the next window; finish sign-in and reload the views afterward. Website downloads require a chosen destination and run once.

**Audit settings & reports** opens the shared review interface and hides the native browser views. Choose or edit profiles, categories, instructions, audit devices, and optional AI settings, then run a current-page audit against the live desktop session. Desktop audits support masked full-page 2× captures, real axe-core and metadata checks, findings editing, manual observations, merging, and persistent history. Native folder selection and PDF/JSON exports work without the companion; PDF preview and export support Original and A4 layouts. Codex analysis, optional page-code evidence, and Miro use shared adapters. Local CLI-fixture tests cover AI/page-code delivery and private-value exclusion; live desktop AI requests and Miro writes remain unverified.

In the review interface, **Settings → Devices and saved sets** edits names and dimensions, removes devices, and saves or selects sets. **Return to live workspace** preserves the page and unsaved state when the device configuration is unchanged. Changed devices recreate the views and reopen the page, retaining project session cookies while discarding unsaved page state. Apply device changes before auditing those sizes.

**Record journey** saves supported interactions in the selected project. **Mark screen** selects a state for audit; **Stop recording** retains the plan. Review and edit the plan in the shared **User flow** controls, then replay it across selected devices. Reports for captured screens remain available if replay is cancelled or later interrupted. An interrupted recording can resume with a recording-gap marker that must be reviewed and removed before replay. Consequential test-mode actions are excluded from saved journeys. Ordinary recorded form entries are saved locally; private fields and masked content are excluded.

**Projects & data** creates or switches projects, chooses persistent or temporary browser sessions, clears the selected project's sign-ins, and exports or previews imported data. Responsive views share only their project's browser session; Chrome sign-ins are not imported. Temporary browser sessions clear when the app closes, while project settings and saved reports remain. Import validates settings/profiles/flows, mappings, and report references, shows counts and duplicates, and backs up current settings before applying changes. Browser-local extension data must first be exported; desktop cannot read Chrome storage automatically. Exported packages exclude cookies and browser credentials but contain ordinary recorded entries and references to report folders. Keep the evidence folders available; import does not move their originals.

**Capture & export PDF** is a separate quick capture: it asks for an output folder and writes masked, current-viewport 2× PNGs, an Original-layout PDF, and `run.json` into a fresh directory registered in desktop history. It runs no audit or AI checks, and the report marks them not run.

Versioned atomic preferences, project data, and the report registry live under Electron's `userData/reviews`; evidence stays in the selected report folder. Restart marks unfinished audits/flows interrupted and retains partial evidence without repeating actions automatically. The web/extension workflow below remains available during migration.

```sh
npm run test:desktop           # real Electron integration checks
npm run package:desktop        # an application folder for the current OS/CPU
npm run make:desktop           # ZIP + macOS DMG or Windows Squirrel artifacts
npm run test:desktop:packaged   # checks against the packaged application
npm run test:desktop:installed  # checks against the installed distribution
```

Artifacts are written under `out/`. Unsigned macOS Apple silicon `.app`, ZIP, and DMG builds were produced locally. CI targets Apple silicon, Intel Mac, and Windows x64; Windows/Intel execution remains unverified. Signed release CI and updater wiring target [gil00pita/ViewportAtlas Releases](https://github.com/gil00pita/ViewportAtlas/releases). Updates are disabled in unsigned/development builds. No signing secrets are configured and no release has been published. Signed upgrades and clean-machine installation remain release gates.

See [migration status and compatibility](docs/DESKTOP-MIGRATION.md), [release/signing instructions](docs/DESKTOP-RELEASE.md), and [validation evidence and limits](docs/VALIDATION.md). All 23 desktop integration checks pass against source, the packaged Mac app, and the app installed from its DMG with system-only PATH on Apple silicon. Windows/Intel and the remaining manual/signing/upgrade gates are still unverified.

### Existing web workspace

Requirements: Node.js 22.13+, npm, and macOS, Linux, or Windows for standalone mode. Native Messaging installation supports Google Chrome on macOS and Linux.

```sh
npm install
npm run install:browser
npm run dev:web
```

Open **http://127.0.0.1:4318**. The labeled Offgrid example is a real responsive HTML page rendered in Chromium, not a collection of mock screenshots. Enter another HTTP(S) URL to inspect it. No account or AI credentials are needed for browser checks.

For a production build:

```sh
npm run build:web
npm run start:web
```

The app is served on loopback only. The companion and development frontend share port 4318. `dist/web` is the built workspace. `npm run build:extension` builds the web workspace and the unpacked extension in `dist/extension`.

## Install the Chrome extension

1. Run `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked → dist/extension**.
3. Copy the extension's ID, then run:

   ```sh
   npm run install:native -- YOUR_CHROME_EXTENSION_ID
   ```

4. Restart any running companion, then reload the extension. Open a website and click the Viewport Atlas toolbar icon. Clicking toggles the audit sidebar open and closed alongside the website.

The sidebar starts with audit settings for the selected page. Choose a profile, categories, and devices, then **Run audit**. Device tabs are created when the audit starts. The sidebar shows progress and findings, and its left rail opens settings, findings, or audit history. **Open full workspace** expands into a tab for responsive previews and detailed review, carrying the selected URL and current audit. Reopening the sidebar resumes a running audit; completed audits remain available from Findings and history.

Opening the sidebar selects the active website; while it is open, choose **Use current tab** after navigating or switching websites. Running audits and recordings keep their selected target. Browser-internal pages cannot be audited. After updating the code, rebuild and reload the extension in `chrome://extensions` to pick up sidebar changes and the `sidePanel` permission.

## Plan and audit a user flow

In Chrome audit settings, choose **User flow → Record a new flow**. Start from a page that can be reopened, with any required login already complete. Walk through the website in its original tab: clicks, navigation, ordinary text/select edits, scrolling, and supported UI states are recorded. The starting screen is selected automatically. Choose **Save screen** in the sidebar at each state you want reviewed, then **Stop recording**. Screen marking is manual by default; automatic marking after interactions is optional.

Review the ordered steps, rename the flow and its screens, remove unwanted actions, and uncheck screens you do not want audited. Choose audit devices, categories, and optional Codex settings, then **Run flow audit**. The extension opens device tabs, replays the journey, waits for page readiness, relevant requests, and DOM changes, and captures each selected state. Screen reports are queued as soon as their evidence is captured; replay does not wait for the preceding report to finish. The progress list links to each screen's report, and all reports remain in Audit history with their flow and screen names. Each has the existing evidence, findings, and PDF/JSON exports.

Plans are saved locally in the extension's Chrome storage, including ordinary field values; do not enter sensitive text into unmasked fields while recording. Passwords, payment/file controls, and configured masked regions are excluded. Purchases, deletions, form submissions, private or unclassified interactions, new-tab actions, iframes, and shadow-root interactions require manual review and are not replayed. A missing, hidden, ambiguous, or changed control stops replay with its device and step; previously captured reports remain available. Prepare responsive menus consistently across devices or record separate flows when their controls differ. Single-tab flows support up to 120 steps and 20 screens, with up to 10 saved plans.

You can close the sidebar while replay runs and reopen it to see progress. **Cancel flow** stops further replay and cancels queued reports while preserving captured evidence. Closing Chrome, reloading the extension, opening DevTools on an instrumented tab, cancelling Chrome’s debugging banner, or closing a required tab can interrupt the flow. Saved steps and reports remain available. An interrupted recording shows Chrome’s detach reason and **Resume recording**: close DevTools if needed, reopen your website if its tab closed, and resume the same saved flow. Review any actions missed during the gap, then remove the recording-gap review step before replay. Replay interruptions retain their captured reports. No unrecorded links are crawled. Rebuild/reload the extension and restart the companion after installing this update.

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

In the web/extension workspace, profile and device preferences live in the browser's localStorage, while audit files and a run registry persist on disk. Standalone web browser authentication state is in memory and is cleared when the companion stops. Desktop preferences and its report registry persist under Electron's `userData/reviews`, with website cookies in its separate persistent browser session. Native transport authentication is kept in a mode-0600 file under `~/.viewport-atlas`; it is not bundled in the extension.

Environment options:

| Variable | Purpose |
| --- | --- |
| `ATLAS_OUTPUT_DIR` | Default audit/capture directory |
| `ATLAS_STATE_DIR` | Companion registry and native token directory |
| `ATLAS_PORT` | Standalone/native service port; default 4318. The packaged extension targets 4318. |
| `ATLAS_CODEX_MODEL` | Optional CLI model selection |
| `MIRO_ACCESS_TOKEN` | Miro token, companion process only |

## Miro and Confluence

Set a Miro OAuth/developer token with `boards:read` and `boards:write` in the app's environment, then restart. For desktop:

```sh
MIRO_ACCESS_TOKEN='your-token' npm start
```

For the legacy web/extension companion, use `npm run start:web` instead.

Use **Export report → Miro**, choose a board, inspect the object counts, and explicitly export. The integration uses Miro REST v2 to list boards and create device frames, uploaded raster images, editable sticky notes, annotation rectangles, and connectors. Screenshot uploads are encoded as JPEG under Miro's 6 MB resource limit. A failure remains visible; local PDFs and evidence remain usable.

The on-disk operation ledger records successful object IDs and skips them on retries. An interrupted request with an unknown outcome stops automatic retry to prevent duplicate creation. Inspect the board, then reconcile its operation in `miro-export.json` with a completed ID or remove a confirmed-uncreated operation. This deliberate manual recovery is required because the creation endpoints do not provide a universal idempotency contract. Exporting the same run again currently preserves already-created objects; create a new run for a fresh board export after editing previously exported findings.

A portable JSON file is not a native Miro import. Screenshots do not become editable webpage layers. Confluence's documented Whiteboard endpoints create/read/delete whiteboards but expose no general editable canvas-object creation API. Use the PDF and local evidence package there; no editable Confluence export is claimed.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run test:desktop
npm audit
```

`npm test` includes core desktop and companion regressions and requires `npm run install:browser` once after installing dependencies. The desktop Electron suite uses its bundled browser. Both preview and signed-release CI run the core suite with Playwright Chromium installed; release packaging waits for it to pass.

For the retained web/extension workflow, run `npm run test:extension`. It rebuilds the web workspace and extension before running its integration checks, and requires the Playwright browser installation too. Packaged and installed desktop checks require artifacts from `npm run package:desktop` and `npm run make:desktop`, respectively.

The tests use real Chromium for viewport dimensions, CSP/X-Frame-Options restrictions, responsive semantic matching, ambiguous/hidden targets, SPA query/hash navigation, shared cookies, password protection, prevention of duplicated purchases, screenshot masking and truncation, prepared state, crop coordinate mapping, real axe findings, PDF output, and cancellation. Additional tests cover structured schemas, path containment, URL redaction, history comparison, native-message framing, authenticated loopback requests, and Miro retry ledgers. Miro transport is stubbed **only in unit tests**; production uses the actual API. No mocked audit results ship in the app.

See [architecture](docs/ARCHITECTURE.md), [schema](docs/SCHEMA.md), [validation notes](docs/VALIDATION.md), and [known limitations](docs/LIMITATIONS.md).

The example website's forest photograph is sourced from [Unsplash](https://images.unsplash.com/photo-1441974231531-c6227db76b6e); it is a demonstration asset, separate from the supplied product mark. All example copy is synthetic and explicitly labeled in the workspace and example page.
