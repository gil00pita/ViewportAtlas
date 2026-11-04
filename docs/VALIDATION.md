# Validation

## Desktop preview — 3 November 2026

Validated on macOS 27.2 Apple silicon, Node.js 26.3.1, and Electron 45.2.1. The first desktop migration slice is an unsigned developer preview; the complete extension audit workflow remains available separately.

| Check | Result |
| --- | --- |
| Source desktop integration suite | 10 passed |
| Packaged macOS application integration suite | 10 passed against the built `.app` |
| Existing `npm test` suite | 59 passed |
| Existing extension integration suite | 5 passed |
| TypeScript and desktop/web/extension builds | Passed |
| Electron Forge package and ZIP distribution | Passed on macOS arm64 |
| Dependency audit | 0 known vulnerabilities after packaging dependency overrides |

Desktop integration uses genuine native browser views and input delivery, a local React controlled-form fixture, and real PNG/PDF files. It verifies 393/820/1440 CSS widths and 2× density, layout at a smaller app-window size, source focus retention, selection replacement/deletion, Unicode and multiline edits, corresponding fields with different responsive IDs, ordinary UI clicks, capture masking and restoration (including nested private fields), ambiguous matches, pause/reload recovery, shared persistent login cookies, and app shutdown/restart. Unsupported/consequential actions stop synchronization and purchases execute once in the source.

The packaged check caught a missing libvips runtime dependency that source tests could not expose. The Forge ASAR configuration now unpacks the `@img` native-library directories, and the full packaged suite verifies capture/PDF generation as well as startup. A synchronous startup entry registers schemes and paths before asynchronous dependencies load. Shutdown suppresses debugger-detach publications after the owning window is destroyed, addressing the reported `webContents` exception.

CI is configured to build ZIP distributions and run both source and packaged desktop tests on macOS Apple silicon, Intel Mac, and Windows x64. Windows/Intel jobs have not been executed in this local workspace; platform support remains pending those results. No signing, notarization, installer publication, automatic updates, live AI analysis, or external board writes were performed. Desktop flow recording, complete interaction synchronization, full-page capture, and audit/history parity remain planned work.

The records below describe earlier web/extension validation and remain separate from the desktop preview.

Validated locally on macOS arm64 with Node.js 26.3.1 and Playwright Chromium 156 on 30 October 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed; workspace and unpacked MV3 extension generated |
| `npm test` | 53 passed, 0 failed |
| `npm run test:extension` | 2 passed, 0 failed; actual packaged MV3 extension in Chrome for Testing |
| `npm audit` | 0 known dependency vulnerabilities |
| Supplied SVG preservation | Root source and public SVG are byte-for-byte identical |
| Chrome icons | Generated PNGs at 16, 32, 48, and 128px from the supplied SVG |

The browser tests use real page loads, real screenshot files, real axe-core execution, and actual PDF generation. External Miro transport is stubbed only for operation-ledger unit tests. The native-host test exercises real stdin/stdout framing and authenticated loopback forwarding. The packaged extension test uses real `chrome.debugger` operations at 393 × 852 and 1440 × 900 CSS pixels, verifies 2× preview and PNG dimensions, checks masking and a 2dppx media query, then verifies synchronized query/hash navigation. It echoes captured snapshots at the native transport seam to inspect the real PNGs without modifying the user's native-host registration.

Standalone capture tests verify 786 × 1704 viewport PNGs, 786 × 32000 truncated full-page PNGs, scaled crop and annotation placement, wide 2× captures, and continued support for archived 1× evidence. A saved example capture at `.context/capture-2x.png` was inspected visually at 786 × 1704 pixels. The earlier full-application workflow below used 1× captures.

The PDF export browser test uses a real companion and a PDF containing a 2× PNG, larger than the native messaging response limit. It verifies default Original selection and preview, A4 selection and download, both actions after the companion stops, a valid downloaded PDF and filename, visible generation errors, cleanup of failed preview tabs, blocked-popup recovery, standalone downloads, and continued rejection of untrusted cross-site requests. Layout tests inspect PDF page sizes, full-resolution embedded images, aspect ratios, placement bounds, absence of clipping paths, very tall captures, long findings, unavailable screenshots, invalid layouts, and file-write errors. Both layouts were rasterized and inspected visually.

Coverage includes embedding restrictions, unique semantic matches across different responsive IDs, independent navigation/click toggles, ambiguous/hidden targets, shared cookies, blocked password edits, source-only purchases, SPA routes, full-page truncation, masking pixel values, preserved open-details state, PNG dimensions, original-versus-annotated separation, crop alignment, schema rejection, credential URL redaction, manual-observation comparison exclusions, cancellation, API origin checks, hidden output folders, downloadable evidence/PDFs, persistence after service restart, and Miro duplicate prevention.

## Full application workflow

Verified through the actual React interface:

1. Load the example website in mobile, tablet, and desktop Chromium views.
2. Run an audit with AI disabled. All three captures and axe/metadata checks completed without failed checks. Lighthouse was explicitly not run; qualitative reviews were marked as requiring manual verification.
3. Confirm saved PNG dimensions against file contents: 393 × 2154, 820 × 1822, and 1440 × 1772.
4. Add a manual finding, mark it verified, save, and reopen export options.
5. Download a real PDF and open the PDF preview. Original now arranges full screenshots and findings on one canvas; A4 fits each full screenshot onto its own page without cropping. Rasterized examples of both layouts are under `.context/pdf-layout-fixture/`.
6. Confirm visual zoom increases the displayed preview while the actual phone viewport remains 393 CSS pixels.
7. Add/remove a preset and create/duplicate/delete profiles through the UI.
8. Check the workspace at 1600px and 390px. Neither layout overflowed the page; the device canvas scrolls internally. axe-core reported zero violations in both tested workspace layouts and in the findings view. No page-level JavaScript exceptions were observed. This is not an accessibility compliance claim.
9. Confirm extension-page image requests successfully load local saved evidence (HTTP 200).

Screenshots and QA artifacts are under the gitignored `.context/` directory: `viewport-atlas-desktop.png`, `viewport-atlas-mobile.png`, `validated-report.pdf`, `report-cover.png`, and `final-browser-validation.json`.

The full-page regression test verifies actual encoded PNG dimensions; it caught and now prevents incorrectly labeling a viewport-height image as a full-page capture. The HTTP regression covers serving reports from hidden destination folders, which require an explicit safe-file option after path validation.

## Remaining verification limits

- No chargeable Codex analysis or live Miro board mutation was performed. CLI readiness, supported invocation flags, schemas, and error handling are verified; live provider/board behavior requires the user's credentials and chosen destination.
- Native Messaging framing and Chrome instrumentation were verified separately. The user's real Chrome extension ID still needs registration with `npm run install:native`; a persistent native host was not installed into their Chrome profile during validation.
- Confluence editable whiteboard objects and Lighthouse integration are unsupported, and remain explicitly labeled in the UI and documentation.
- React Doctor's full static scan reports architectural and heuristic warnings, including the large workspace component, bounded array lookups, deliberate sequential browser/export work, captured-preview interactions, and custom focus-managed dialogs. It is not a clean static-analysis run. The actionable missing-effect dependencies and unchecked fetch response identified during review were fixed. No diagnostic suppressions were added; these remaining warnings are a maintenance limitation, not a passing check.

Live-output checks cover pre-completion delivery, split UTF-8/JSONL events, opt-in enforcement, bounded logs, query-token redaction, cancellation, schema compatibility, and persisted history. The UI was exercised with a clearly labeled CLI fixture, including automatic Findings navigation and desktop/mobile/dark-mode output; a separate real Codex CLI connection check emitted seven live events and completed successfully.

Finding-format checks cover all five priorities, required nonblank Issue/Impact/Recommendation text, complete and incomplete live JSON, literal HTML-like issue text, and schema-v1 compatibility. Browser verification checks the four-field order and Codex tag in saved and live lists, the existing Review finding action, and desktop/mobile/dark-mode layouts.

Startup-warning regression tests reproduce duplicate managed `ultrafast_mode` notices, verify one informational entry per audit, and preserve unrelated policy warnings and fatal errors. A real installed Codex CLI check completed successfully with six events, no development-feature banner, and one informational compatibility notice replacing the two raw optional-speed warnings. The invocation retains host-skill isolation and suppresses the development banner only for the audit subprocess.

Page-code checks exercise real rendered HTML and responsive CSS, secret/form/mask exclusion, unchanged inspected DOM, invalid selectors, inaccessible stylesheets, capture limits, prompt budgeting across 16 views, profile validation, and missing code from old extensions. The audit fixture records the actual CLI stdin and confirms HTML/CSS arrive when enabled, remain outside the prompt when disabled, and persist as local code snapshots. The packaged extension test captures real CDP code alongside 2× screenshots. UI checks verify the default-off option, keyboard control, conditional consent text, reset acknowledgment, and desktop/mobile/dark-mode layouts under `.context/page-code-*`.

Sidebar regression checks load the packaged sidebar document in real Chromium, verify that opening it creates no device tabs, and exercise profile controls, a real CDP capture, running-audit restoration, completion, and expansion into the same audit in the full workspace. The native transport uses an explicit test fixture; this does not verify the user's native-host registration. Additional checks cover 320px and 400px layouts, dark mode, unsupported pages, address detection without activeTab access, and a disconnected companion. A toolbar unit check verifies delegation to Chrome's native open/close toggle without a competing click handler. The browser check reads back the enabled native toggle configuration and simulates reopening a cached sidebar alongside a different active website to verify target refresh. Chrome's native toolbar and side-panel shell still require a manual click after reloading the unpacked extension. Screenshots are under `.context/audit-sidebar.png`, `.context/audit-sidebar-dark.png`, and `.context/audit-full-workspace.png`.

Recorded-flow validation brings the automated suite to 59 passing tests and five packaged-extension checks. The flow integration records real clicks, an ordinary field edit, an opened dialog, and full-document navigation, then marks three screens and replays them at mobile and desktop widths. It checks real PNG capture, restored progress after sidebar reload, preservation of reports when a later target is missing, cancellation, and exclusion of password/private-region data. Its labeled native fixture withholds report completion until all three screens have arrived, so a replay that waits for each report would fail. A separate HTTP companion test uses deterministic screenshot evidence and a local CLI fixture held behind a release signal: a second screen is accepted while the first is analyzing, unrelated/duplicate submissions are rejected, and both screen contexts persist in saved metadata. No chargeable AI call is made by these tests. Browser tests cover ordinary input/select replay, ambiguous target rejection, and custom masks. Flow URL/context validation rejects credential addresses and out-of-bounds screen metadata. Light, dark, narrow, and completed-screen screenshots are `.context/flow-planner.png`, `.context/flow-planner-dark.png`, and `.context/flow-results.png`.

The recording-disconnection regression creates a real embedded iframe and changes its fragment URL while recording. Before the fix, the iframe navigation failed the main-page URL validation and stopped recording. The regression verifies that recording remains active, embedded URLs are absent from replay steps, top-frame clicks and SPA navigation are retained, and the same recording survives a 35-second idle wait with the sidebar closed, a page reload, reopening the sidebar document, and navigation between different site origins. It uses real elapsed time rather than a simulated clock.

Recording recovery additionally closes the actual source tab, checks Chrome’s `target_closed` reason, reopens the website, and resumes through the sidebar button into the same saved plan. New clicks are retained and a recording-gap review marker blocks replay. Recovery screenshots at 320px and 400px are `.context/recording-recovery-320.png` and `.context/recording-recovery-400.png`. A focused controller test checks cancellation without automatic reattachment, ignored child detaches, failed-resume preservation, retained masks, worker restart recovery, concurrent initialization, and migration of the old generic disconnection message. The user’s random detach trigger is not yet reproduced; earlier builds discarded its Chrome reason.
