# Validation

Validated locally on macOS arm64 with Node.js 26.3.1 and Playwright Chromium 156 on 30 October 2026.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed; workspace and unpacked MV3 extension generated |
| `npm test` | 34 passed, 0 failed |
| `npm run test:extension` | 1 passed, 0 failed; actual packaged MV3 extension in Chrome for Testing |
| `npm audit` | 0 known dependency vulnerabilities |
| Supplied SVG preservation | Root source and public SVG are byte-for-byte identical |
| Chrome icons | Generated PNGs at 16, 32, 48, and 128px from the supplied SVG |

The browser tests use real page loads, real screenshot files, real axe-core execution, and actual PDF generation. External Miro transport is stubbed only for operation-ledger unit tests. The native-host test exercises real stdin/stdout framing and authenticated loopback forwarding. The packaged extension test uses real `chrome.debugger` operations at 393 × 852 and 1440 × 900 CSS pixels, verifies 2× preview and PNG dimensions, checks masking and a 2dppx media query, then verifies synchronized query/hash navigation. It echoes captured snapshots at the native transport seam to inspect the real PNGs without modifying the user's native-host registration.

Standalone capture tests verify 786 × 1704 viewport PNGs, 786 × 32000 truncated full-page PNGs, scaled crop and annotation placement, wide 2× captures, and continued support for archived 1× evidence. A saved example capture at `.context/capture-2x.png` was inspected visually at 786 × 1704 pixels. The earlier full-application workflow below used 1× captures.

Coverage includes embedding restrictions, unique semantic matches across different responsive IDs, independent navigation/click toggles, ambiguous/hidden targets, shared cookies, blocked password edits, source-only purchases, SPA routes, full-page truncation, masking pixel values, preserved open-details state, PNG dimensions, original-versus-annotated separation, crop alignment, schema rejection, credential URL redaction, manual-observation comparison exclusions, cancellation, API origin checks, hidden output folders, downloadable evidence/PDFs, persistence after service restart, and Miro duplicate prevention.

## Full application workflow

Verified through the actual React interface:

1. Load the example website in mobile, tablet, and desktop Chromium views.
2. Run an audit with AI disabled. All three captures and axe/metadata checks completed without failed checks. Lighthouse was explicitly not run; qualitative reviews were marked as requiring manual verification.
3. Confirm saved PNG dimensions against file contents: 393 × 2154, 820 × 1822, and 1440 × 1772.
4. Add a manual finding, mark it verified, save, and reopen export options.
5. Download a real PDF and open the PDF-preview link. Rasterize the cover for visual inspection. Detailed screenshots are tiled into readable sections/columns instead of shrinking wide images to illegible text.
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
