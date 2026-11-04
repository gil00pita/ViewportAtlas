# Standalone desktop migration plan

Status: implementation started, 3 November 2026. The phase 1 desktop preview has been implemented; subsequent phases remain planned. See the implementation record below for the verification scope.

## Implementation record

The initial preview uses a synchronous Electron startup entry, the existing React visual system, three sandboxed `WebContentsView` browser views, and a restricted preload interface. A shared semantic matcher mirrors focus and live ordinary text edits. CDP maintains target CSS viewport sizes independently of presentation scale and produces masked 2× current-viewport evidence for the existing PNG/PDF pipeline. Website sessions persist in the app's own browser profile. Unsupported or ambiguous actions visibly pause the group.

Local checks cover real Electron text input, React controlled fields, selection replacement/deletion, Unicode, source switching, ordinary UI controls, masking/PDF output, ambiguous targets, pause recovery, persistent authentication, and app shutdown/restart. The current implementation also has macOS/Windows package targets and CI jobs for Apple silicon, Intel Mac, and Windows x64. Build jobs are configured; remote execution and Windows/Intel validation remain pending. Signed installers, updates, and advanced interaction/flow/audit parity remain future work. Developer archives currently use ZIP; platform-specific installers will be added during phase 6.

## Outcome and scope

Make Viewport Atlas an installed macOS and Windows app with its own Chromium browser, responsive views, synchronized interaction, flow recording, audits, and local reports. A normal review must require no Chrome extension, Native Messaging installation, system Node.js, separately installed browser, terminal command, or manually started companion.

The primary journey is: launch the app, enter a URL, authenticate if needed, interact with any responsive view, mark screens, run a review, and export evidence. Ordinary interactions synchronize by default, including clicking an input and typing directly into it. Keep the existing brand, profiles, findings, report formats, and evidence protections.

AI remains optional. Initially preserve the existing authenticated Codex CLI integration, with clear setup/status inside the app. Local browsing, checks, and exports must work without it. Removing the separate AI installation is a separate deliverable requiring a supported authentication/inference integration; packaging the browser alone does not achieve that. Miro remains an optional network integration.

Target the first release at macOS Apple silicon and Intel, and Windows x64. Treat Windows ARM64 as a follow-up unless its complete dependency and installer matrix passes before release. Pin supported OS versions against the Electron version selected during implementation and publish the tested matrix.

## Existing implementation and migration approach

| Existing code | Desktop treatment |
| --- | --- |
| `src/App.tsx`, profiles, findings, export UI | Reuse; replace screenshot interaction with browser-view layout and desktop events. Split out browser-specific UI as it changes. |
| `src/api.ts` | Add a typed desktop transport through a restricted preload interface; keep legacy transports during migration. |
| `companion/server.mjs` | Extract audit/history/settings operations from Express handlers and import-time startup. Desktop calls these operations without HTTP. |
| `companion/browser.mjs` | Keep as the legacy Playwright adapter during transition; add an Electron browser adapter for live views. |
| `companion/interaction.mjs` | Reuse semantic matching ideas; expand focus, editable state, target identity, and responsive mappings. Replace its limited interaction contract. |
| `extension/flow-controller.mjs` | Extract flow orchestration from `chrome.storage`, tab IDs, debugger events, and Native Messaging. Reuse orchestration through desktop browser/storage adapters. |
| `companion/flow-page.mjs`, `flow-contract.mjs` | Extend the recorder and version the saved interaction/flow contract. |
| Capture, axe checks, page-code sanitization, PDF, findings/history, Miro | Reuse behavior; adapt capture/evaluation/file access to desktop ownership. |
| Native host, extension sidebar, installer scripts | Retain until desktop parity passes; remove from the default installation and onboarding at cutover. |

Current limitations that the migration must replace: form sync defaults off, standalone input sends whole values through a workspace action, many controls are ineligible for mirroring, and recording is enabled only in extension mode. Changing the default flag alone cannot meet the new requirement.

## Desktop architecture

Use Electron and the existing React/TypeScript interface. Start with `WebContentsView` for each responsive browser view. Electron documents this embedding primitive and its browser-control methods. [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [webContents](https://www.electronjs.org/docs/latest/api/web-contents).

The trusted workspace renderer calls a small preload interface. The main process owns windows, browser views, session lifecycle, permissions, and validated desktop operations. Audit/report work runs behind the existing audit operations, with expensive work moved off the UI/main event loop when profiling requires it. Websites have no access to the workspace preload interface or arbitrary filesystem, process, or browser commands.

Define three modules with small interfaces:

- **Browser workspace:** open/close views, navigate, observe interactions, resolve targets, apply actions, inspect state, and capture evidence. Hide Electron view layout, CDP, and document instrumentation inside its adapter.
- **Synchronized session:** accept a source interaction, coordinate followers, expose progress/divergence, and pause/resume/recover. Hide ordering, target matching, navigation generations, and feedback suppression inside this module.
- **Review workspace:** manage settings, flows, audits, history, and exports. UI transport and extension storage are adapters, not requirements of the implementation.

The existing Chrome and Playwright implementations make these actual migration seams. Avoid introducing a general browser/plugin framework. The desktop renderer must not receive arbitrary CDP or JavaScript execution interfaces.

Use application-owned storage for preferences and flows, with versioned atomic writes. Keep evidence in the user's chosen report folder. Use Electron platform paths and native open/save dialogs rather than hardcoded home directories or platform shell commands. Serve packaged workspace/evidence through a restricted local protocol; desktop operation must not depend on port 4318.

Keep the workspace renderer and website sessions separate. Use a persistent website session per review project so its responsive views share authentication, cookies, and appropriate browser storage; offer a temporary session and clear-session action. Electron supports named persistent session partitions. Separate page JavaScript and session storage still require replay; shared cookies do not clone UI state. [Session partitions](https://www.electronjs.org/docs/latest/api/session).

## Synchronization contract

### Default behavior

Sync is on for all ordinary interactions. Any responsive view can become the source through direct user interaction. Apply that action once in the source and once in each eligible follower. Follower delivery must neither steal operating-system focus nor become a new source. A user can pause synchronization to prepare one viewport independently; resuming requires an explicit state check and recovery when needed.

| Interaction | Required behavior |
| --- | --- |
| Click, double-click, focus, blur | Resolve corresponding controls semantically, then deliver the relevant action at each control's own location. Clicking a field prepares that field in every view. |
| Typing and editing | Mirror incremental edits, caret/selection, replacement, backspace/delete, and multiline input without a separate text prompt. Support controlled React fields. |
| Paste, cut, select all, undo/redo | Apply the intended edit to the matched field. Handle clipboard access at the source, without copying the whole system clipboard to every page. Verify resulting value/selection. |
| IME, dead keys, accented text, emoji | Observe composition and committed text; avoid duplicate insertion from overlapping key/input events. Verify on both operating systems. |
| Tab, Shift+Tab, arrows, Enter, Escape | Match the resulting focus or widget action across layouts. Preserve app/browser shortcuts; Enter that submits a form follows submission policy. |
| Checkbox, radio, select, range, date, number | Apply the intended checked/selected/value state, including keyboard use and native picker results. Do not blindly toggle followers. |
| Menus, dialogs, tabs, accordions | Mirror the intended open/closed/selected state, accounting for responsive differences. |
| Scrolling | Map document and nested-container scrolling using semantic anchors and relative offsets, with a bounded proportional fallback. |
| Hover and pointer gestures | Mirror a semantic target and relative position; support menu hover and DOM drag/drop in the extended-interaction milestone. |
| Navigation, back/forward, reload | Synchronize browser history intent and SPA navigation, including query/hash changes, without extra loads or losing form/navigation semantics. |
| Popups, new tabs, downloads, native dialogs | Route through explicit app-managed handling. Mirror corresponding view groups where supported; a download runs once. A blocked/unsupported operation pauses the group and explains what happened. |

File inputs need a native chooser and explicit file selection; do not silently repeat uploads. Passwords, payment fields, and configured private regions stay outside default mirroring and all recorded evidence. Support manual preparation of each view's authentication. If private-field synchronization is added, make it a separate in-app, session-only opt-in: transient transport only, no field values in logs, flows, disk, screenshots, or AI evidence. Do not persist such values for replay.

Purchases, deletions, and submissions can create multiple real server actions. Preserve source-only handling by default and visibly pause followers. Provide an explicit per-session test mode for mirroring consequential actions against a user-selected test environment. Heuristics cannot reliably identify every mutation; shared authentication is not isolation. Do not claim that arbitrary production interactions can always be repeated safely.

### Target matching and responsive differences

Never use the source's absolute coordinates in followers. Resolve by stable test identifier, ID, associated label/accessible name and role, field name/type, form or landmark scope, and stable destination. Include frame and shadow-root paths where supported. Accept only an unambiguous eligible match; identical placeholders or repeated labels alone are insufficient.

A desktop navigation link may sit behind a mobile menu. Support validated preparation actions for known menu relationships and user-defined counterpart mappings. Store mappings with the review project, validate them after navigation, and expose which preparation actions ran. Do not guess by arbitrary clicking. Compare workflow outcomes rather than requiring identical DOM, scroll offsets, focus order, or menu state at every viewport.

### Ordering and recovery

Each interaction carries a sequence ID, source view, document generation, semantic target, action payload, and provenance. Maintain an ordered queue per follower and acknowledge delivery and resulting state. Generated follower events cannot reenter the source stream. Do not replay an action again after an ambiguous acknowledgement.

Capture the source target before navigation removes it. Track source changes through a handoff barrier: drain or invalidate prior work before accepting a new source. Navigation invalidates stale targets; actions waiting for the new document remain ordered. Slow followers must not lose edits or allow a click/Enter/checkpoint to overtake unfinished input. Coalesce only operations whose final state preserves semantics; never collapse composition, clicks, or navigation.

Use bounded page/control readiness waits, not fixed sleeps or unbounded network-idle waits. Verify values, checked state, selected options, focus target, navigation, or widget state as appropriate. Classify each view as ready, applying, paused, or out of sync, showing the last acknowledged action and reason.

On divergence, stop dependent actions for the group and retain the source state. Offer retry after manual preparation, map a counterpart, replay from a checkpoint, or exclude a viewport. Do not label a reload as full resynchronization: unsaved form and application state may require replay. Audit capture must wait for acknowledged actions or explicitly report excluded/diverged views.

Release contract: supported interactions synchronize; unsupported controls are visible interruptions. Closed shadow roots, canvas editors, cross-origin frames, complex drag/drop, and browser-native UI require explicit compatibility tests before being advertised as supported. They must never silently appear synchronized.

## Implementation milestones

| Phase | Work | Exit condition |
| --- | --- | --- |
| 1. Feasibility slice | Minimal Electron shell, three live browser views, isolated site instrumentation, persistent session, click/focus/type synchronization, one capture and PDF. Build and run on macOS and Windows. | On an authenticated controlled form, click a field in any view and type normally; all counterparts show the same value. Prove focus-preserving follower delivery and exact viewport dimensions at display scales. |
| 2. Desktop foundation | Extract review operations from Express startup; add typed preload transport, settings/storage, browser adapter, native dialogs, lifecycle, crash recovery, and platform build jobs. | A packaged app launches on clean machines without Chrome, Node, a browser download, the extension, or the local server. Existing core audit/export behavior works through desktop transport. |
| 3. Core synchronization | Implement semantic matching, focus/selection/editing, clipboard, IME, form widgets, navigation/history, menus, document/nested scrolling, ordering, state checks, source handoff, and recovery UI. | The cross-platform interaction suite passes; no feedback loops, dropped edits, duplicate actions, or silent divergence on fixtures. |
| 4. Extended interactions and flows | Add hover, pointer gestures, DOM drag/drop, open shadow roots, tested frame support, managed popups/dialogs; port recording/replay onto the same interaction engine. Persist plans and screen checkpoints. | A recorded multi-page form journey replays across responsive views, captures each marked state, survives interruption honestly, and retains completed evidence on cancellation. Advanced-control support is reported explicitly. |
| 5. Audit and data parity | Adapt masked full-page capture, axe/DOM checks, page-code evidence, Codex, findings/history, PDF/JSON, Miro; add preference/flow/history migration. | Masked 2× captures, matching reports, original/A4 PDF, history, cancellation, and optional integrations pass desktop tests. No captured action races with an audit. |
| 6. Release and cutover | Signed installers, updates, native-module packaging, accessibility/keyboard checks, upgrade/uninstall verification, clean-machine smoke tests, desktop docs and onboarding. | The platform matrix passes on packaged builds. Make desktop the default and retire extension setup after parity is documented. |

Phase 1 is a decision gate. Native browser surfaces do not behave like ordinary React elements: prove clipping, panel/modal stacking, canvas scrolling, zoom, hit testing, and OS display scaling. A desktop viewport displayed smaller must retain its target CSS width and breakpoints. Do not use ordinary page zoom as a substitute. If embedded surfaces cannot satisfy this, investigate an offscreen composited browser presentation behind the same module before committing to the full UI migration; measure typing, IME, and rendering latency again.

## Platform and distribution work

Use Electron Forge initially, with macOS DMG plus ZIP/update artifacts and a Windows Squirrel installer. Build macOS artifacts on macOS and Windows artifacts on Windows. These makers have platform-specific build requirements. [DMG maker](https://www.electronforge.io/config/makers/dmg), [Squirrel.Windows maker](https://www.electronforge.io/config/makers/squirrel.windows).

- Package Chromium and runtime dependencies with the application. Rebuild/package native dependencies such as `sharp` for each Electron/CPU target and verify they load outside the development checkout.
- Sign and notarize macOS releases; sign Windows installers/executables. Configure signing credentials in release CI. Public distribution requires developer accounts/certificates; local unsigned test builds can precede them. [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).
- Add signed release/update verification and a chosen update feed. Updates must preserve settings, flows, evidence, and browser profiles and wait while a review/export is active. Test upgrade from a previous packaged version. [Updating applications](https://www.electronjs.org/docs/latest/tutorial/updates).
- Handle macOS app/menu lifecycle and Command shortcuts, Windows Control shortcuts and installer startup events, native folder/reveal actions, long/non-ASCII/space-containing paths, display changes, high-DPI scaling, and missing writable folders.
- Resolve optional Codex executables independently of an interactive terminal PATH. Handle macOS GUI launches and Windows executable/npm-shim differences without interpolating page data into shell commands. Missing or unsupported CLI versions must affect only AI analysis.
- Test persistent sign-in, logout, service workers, OAuth popups, and representative SSO. Login compatibility is a release gate, not a promise that every provider accepts embedded browsers. Never import or extract another browser's credential database.

## Site isolation and local data

Keep remote Node integration off, context isolation and renderer sandboxing on, and web security enabled. Validate sender/frame identity, arguments, view ownership, navigation scheme, permissions, and file references on privileged operations. Restrict guest instrumentation to interaction/evidence messages with bounded payloads; page messages are untrusted even when they resemble real user events. Keep certificate checks, CSP, and site headers intact. Permit HTTP development sites under an explicit development-site policy. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Guest pages cannot access report files, AI processes, integration credentials, app updates, or the workspace renderer's privileges. Keep private field values out of interaction telemetry. Handle popup navigation, external links, downloads, and permissions centrally. A malicious-site fixture must fail to invoke privileged operations.

Introduce a versioned preferences/flow export-import package while the extension still runs; its Chrome storage and browser-local settings are not automatically readable by desktop. Migrate with backups, schema validation, dry-run counts, duplicate detection, and explicit errors. Import the existing companion run registry and user-selected evidence folders without moving/deleting originals. Preserve old report and screenshot formats. Chrome cookies and live page state are outside the migration package. After a crash, reopen saved projects but mark unfinished recording/replay/audits interrupted; never automatically repeat an uncertain server action.

## Acceptance and verification

Use real Electron/Chromium integration tests with controlled fixture sites. Retain existing meaningful core tests and port extension behavior assertions to desktop. Do not infer Windows compatibility from macOS execution or Node unit tests.

1. At phone, tablet, and desktop sizes, click an ordinary input in any view and type `Hello`, select part of it, replace it, paste, delete, undo, and continue. Every counterpart reaches the expected value and selection; the physical keyboard remains usable in the source.
2. Repeat with React controlled inputs, textarea, checkbox, radio, select, date/number/range controls, contenteditable, IME, accented characters, emoji, native picker results, Tab/Enter/Escape, and keyboard-operated widgets.
3. Desktop/mobile menus, hidden duplicate fields, repeated labels, delayed mounts, validation updates, different tab order, nested scrolling, and a slow follower either converge or produce a visible, actionable divergence.
4. Rapid typing followed immediately by click/navigation/checkpoint, source switching, redirects, SPA transitions, query/hash changes, and back/forward/reload do not reorder or duplicate actions. A follower event never loops back.
5. Hover, DOM drag/drop, tested frames/open shadow roots, popups, dialogs, file selection, and unsupported custom widgets obey the documented support/interruption contract.
6. Passwords/private regions are masked and absent from saved events, code evidence, and AI payloads. Default consequential actions execute once; the test-mode fixture proves intentional mirroring independently. A malicious page cannot forge privileged workspace commands.
7. Restart retains expected logins, preferences, profiles, devices, flows, findings, and reports. Temporary sessions clear. Interrupted runs retain partial evidence and do not resume side effects automatically.
8. Capture waits for synchronization, preserves exact CSS viewport and 2× pixel dimensions independently of OS DPI, and retains mask, crop, truncation, and PDF behavior.
9. Packaged apps on supported macOS CPUs and Windows x64 pass install, launch, representative authentication, interaction, audit, PDF/JSON export, upgrade, and uninstall tests without developer tools installed. Exercise Mac Retina and Windows 100%, 125%, 150%, and 200% display scales.
10. Measure ordinary edit propagation on three local fixture views; initial target is p95 acknowledgement within 150 ms after source observation, excluding declared page-readiness waits. Report measured latency and resource use; do not present this target as an achieved result. Verify multiple live views remain responsive under the advertised maximum device count.

## Next implementation step

The first slice is implemented and locally verified on macOS Apple silicon. Complete its Windows/Intel CI validation, then continue with phase 2's extraction of the existing review operations and phase 3's broader interaction engine. Preserve the passing viewport, input, evidence, and lifecycle checks as the full workspace is ported. Keep the current extension working until the later parity and cutover gates pass.
