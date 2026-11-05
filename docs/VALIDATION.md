# Validation

## Full Mac desktop verification — 5 November 2026

The Mac session was unlocked and the complete Electron suite passed against source, the freshly packaged application, and the application copied from its DMG. This supersedes the locked-session limitation in the 4 November record below.

| Check | Result |
| --- | --- |
| Core suite (`npm test`) | 68 passed |
| Full source Electron suite | 23 passed; `.context/desktop-full-source.log` |
| Full packaged macOS arm64 suite | 23 passed; `.context/desktop-full-packaged.log` |
| Full DMG-installed macOS arm64 suite | 23 passed with system-only PATH; `.context/desktop-full-installed.log` |
| Desktop build and fresh unsigned app/ZIP/DMG | Passed |

The unlocked run found three issues in the existing recorder and browser delivery handlers. A click on a field already focused in the DOM did not identify the new interaction source; direct field/widget clicks now emit focus intent, with a dedicated recorder regression. Caret-only selection events cleared the safe retry action after a match failure; only substantive edits, control changes, or navigation now invalidate it. A follower navigation could commit after its mirrored click returned and be mistaken for a new source; its delivery origin now follows navigation from start through commit or failure. The original failing source-switch, counterpart-recovery, and multi-page recording paths all pass without retries.

The complete suites exercise native text/selection/deletion and source switching, controlled widgets, nested scrolling, navigation/history, recorded journey replay, committed IME text, responsive menus, open shadows, plain contenteditable, Escape, hover and DOM drops. They also cover masks and real PNG/PDF evidence, audits/finding edits/history, device sets, one-time managed downloads, isolated popups, project data transfer, authentication persistence, temporary sessions and crash/cancellation recovery. The installed app is copied to a temporary path containing spaces and Unicode after mounting the real DMG, then runs after the disk is detached.

This is local macOS Apple silicon verification. Physical IME/native picker and broader shortcut testing, representative external SSO, Intel Mac/Windows, display scaling, clean machines, signing/notarization and real signed updates remain release gates. No paid AI call, Miro write, signing operation or release publication was performed. Earlier extension and interface-review evidence retains its stated scope.

The pre-commit React Doctor scan included newly staged files (38 files versus the earlier narrower scan). It reports ten warnings: four sequential-operation warnings, four array-lookup warnings, and two prop-initialized form-state warnings; aggregate score 51/100. The form state intentionally starts from the current device/project selection, replay preserves action order, and validation/storage work remains sequential or bounded. These warnings were reviewed without suppressions; the project does not have a clean static-analysis result.

## Expanded desktop migration — 4 November 2026

This record describes the 4 November implementation pass. The full Mac verification above supersedes its locked-session limitation; historical counts below retain their original scope. The expanded synchronization, flows, audit/data and distribution implementation is in place, but full release acceptance has not passed.

| Check | Latest result |
| --- | --- |
| `npm test` | 67 passed, including a trusted DOM-drop recorder regression |
| Web/extension production build and desktop build | Passed |
| Complete extension integration suite | 5 passed on final run; `.context/extension-final.log` |
| Dependency audit / `npm ls` | 0 known vulnerabilities / dependency tree passed |
| Focused source Electron suite | 8 passed; `.context/source-final.log`, including capture/privacy checks |
| Active privacy-mask guard | 1 additional source check passed; `.context/invalid-live-mask.log` |
| Dedicated native capture/privacy run | 2 passed separately; also included in the combined 8-test run |
| Unsigned macOS arm64 `.app`, ZIP and DMG | Built successfully; `.context/make-desktop.log` |
| Latest packaged macOS arm64 focused suite | 9 passed; `.context/packaged-final.log` |
| Latest DMG-installed macOS arm64 focused suite | 9 passed with system-only PATH; `.context/installed-final.log` |
| Final complete native focus/input suite | Blocked by locked macOS graphical session (`isFocused` false); no all-native-tests-passed claim |
| Final interface review | Regular/minimum-size and dark-mode captures inspected; project controls use existing theme tokens |

The six focused source checks exercise real native CSS dimensions and isolation, invalid-mask failure/cancellation, optional AI/page-code evidence through a labeled local CLI fixture, managed isolated popups and a one-time website download, replay cancellation with retained screen evidence, and project session isolation/clear-sign-ins/temporary restart. The project test also exercises import previews, export/reference behavior, and recovery after interrupted work. Separate data-transfer tests cover validation and before-import backups. These checks do not require physical keyboard focus and passed in the current session.

A focused packaged reproducer isolated macOS screenshot stalls when native views were hidden. During capture the app now keeps those views painting outside the window's clipped content area, then restores their bounds and visibility. The capture regression checks that native surfaces do not cover review controls, verifies actual masked 2× pixels, and reads a real PDF. Browser commands have timeouts; shutdown waits for exports and pending settings. Startup no longer accepts a new navigation while the initial page is opening. Structured rich-text edits pause instead of flattening formatted content.

An earlier extension integration run passed four of five checks; the flow check timed out during capture while other browser jobs were active (`.context/extension-contended.log`). Its isolated rerun passed, then the complete five-test suite passed with other browser jobs idle (`.context/extension-final.log`). No extension retry was added. The changed-code React Doctor scan reports no introduced issues; its aggregate score remains low and the full scan retains architectural/heuristic warnings, so this is not a whole-project static-analysis pass.

Two additional native checks verify masked 2× PNGs and real PDF output, plus private open-shadow and opaque/embedded-region masking. Earlier focused native input checks exercised the expanded interaction engine; the final complete input suite is not a passing result because the Mac remains locked. In particular, real IME composition/native picker behavior and operating-system shortcuts still require manual verification. Source implementation includes widgets, committed Unicode, scrolling/history, open shadows/plain contenteditable, hover/DOM drag, counterpart mappings/menu preparation, safe retry/exclusion, test-origin control, and recording/replay; implementation must not be read as universal compatibility evidence.

Final screenshots are `.context/desktop-projects-current.png`, `.context/desktop-projects-minimum.png`, `.context/desktop-projects-minimum-lower.png`, `.context/desktop-projects-dark.png`, `.context/desktop-projects-minimum-dark.png`, `.context/desktop-review-minimum-dark-current.png`, and `.context/desktop-flow-current.png`. The extension/workspace visual system, supplied mark, light/dark semantic tokens, compact type, 8px controls and 12px panels were preserved; `DESIGN.md` was not rewritten. The desktop shell's existing literal palette remains a pre-existing tokenization difference, not a newly adopted design rule. The shared stylesheet declares Manrope while `DESIGN.md` describes system sans; the desktop stylesheet uses system sans. This pre-existing documentation/type difference was recorded without rewriting the incumbent design system.

Project exports contain settings, flows, ordinary recorded entries and references to report folders; cookies/browser credentials are excluded. Keep the referenced folders available. Temporary browser partitions clear on exit while saved project metadata/reports remain. No automatic transfer of Chrome storage or credentials was performed.

The installed check mounts the real DMG, copies its app into a temporary path containing spaces and Unicode, detaches the disk, and runs the focused suite with system-only PATH. A cancellation test initially attempted navigation before the workspace's cleanup guard released; it now waits for the same idle state that enables the UI, and the installed suite passes. No runtime retry was added. This remains a developer-machine installation test.

Signed release CI and update adapters target [gil00pita/ViewportAtlas Releases](https://github.com/gil00pita/ViewportAtlas/releases). Development/unsigned updates are disabled. No signing secrets are configured; no release was published. Windows/Intel execution, clean-machine installation/uninstallation, installer signing/notarization, minimum OS/display-scale checks, and real signed upgrade behavior remain unverified. Local installed-artifact testing does not replace clean-machine tests. Representative SSO, live desktop Codex analysis, and Miro writes remain external/manual gates. See [desktop compatibility and status](DESKTOP-MIGRATION.md) and [release/signing instructions](DESKTOP-RELEASE.md).

## Desktop review foundation — 4 November 2026

Validated locally on macOS Apple silicon. This extends the desktop preview with current-page audits and shared review controls; it does not complete the desktop migration.

| Check | Result |
| --- | --- |
| `npm test` | 61 passed |
| Source Electron integration suite | 13 passed |
| Freshly packaged macOS arm64 application integration suite | 13 passed against the built `.app` |
| Web/extension and desktop builds | Passed |
| React Doctor scan of changed React code | No issues reported in changed-code scan |
| Interface review | Ship; no material introduced visual findings |

Real Electron checks exercise the shared review UI with native browser views hidden, genuine full-page 2× PNGs, custom masking below the viewport and restoration, real axe-core findings and metadata checks, report history, finding edits, native A4 PDF export, and evidence opening with path rejection. Invalid masks fail without producing unmasked screenshots; cancellation retains the run. Profile creation uses the current desktop device IDs. Returning with an unchanged device configuration preserves the live page and unsaved state; a changed configuration recreates the views and reopens the page, retaining cookies but discarding unsaved state. Device editing and saved sets configure real native viewport dimensions, and preferences, finding edits, history, and authentication cookies survive restart. Storage tests also verify atomic preference persistence, input validation, and interrupted-audit recovery with retained evidence.

Review screenshots are `.context/desktop-review.png`, `.context/desktop-findings.png`, `.context/desktop-settings.png`, and `.context/desktop-settings-narrow-dark.png`. The review preserved the existing visual system; no design tokens or design-system files changed. The quick current-viewport capture remains explicitly unaudited and is registered in desktop history.

Codex, optional page-code evidence, and Miro reuse shared integration paths, but this desktop validation made no live AI requests or Miro writes. It did not verify Windows/Intel execution, clean-machine installation, signing/notarization, installers, updates, or representative external SSO. Full synchronization, desktop flows, per-project/temporary/clear-login sessions, and full legacy-data migration remain open. Earlier validation records below retain their original scope and counts.

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
