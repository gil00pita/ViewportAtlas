# Architecture

## Components

The React/TypeScript workspace is built once by Vite. The same UI runs in the loopback companion and as a Chrome extension page. `src/api.ts` selects same-origin HTTP or the extension's internal message bridge. Profiles and device sets persist in localStorage; audit history persists through the companion's run registry.

Standalone previews use a shared, in-memory Playwright Chromium context and one page per device, with an exact CSS viewport and device scale factor 2. The Chrome extension uses the same density through CDP device metrics. The frontend displays real viewport captures, forwards source interactions to the browser, and refreshes captures after actions and on a bounded interval. A capture is an interactive screenshot transport, not an iframe. Page CSP and X-Frame-Options remain intact. It does not inherit Chrome credentials.

Chrome mode uses `chrome.debugger`, one ordinary tab per viewport, CDP device metrics, mouse input, screenshot capture, and Runtime evaluation of fixed product functions. The extension uses Chrome's current profile, preserving its cookies and storage. It does not modify security headers or open a remote debugging TCP port. Chrome's debugger warning remains visible. Device names represent viewport presets, not hardware or browser-engine emulation. Opening DevTools or restrictive enterprise policy can detach or deny instrumentation.

The toolbar action stores the source URL and opens the workspace. Cloned tabs load that URL; unsaved in-memory state from the original tab is not copied. Users can prepare each created view before capture. Runtime messages are accepted only from this extension's own pages. No externally connectable web-message bridge exists.

The service worker opens a persistent Native Messaging connection. The native executable decodes little-endian length-prefixed JSON, forwards an allowlisted request to the loopback companion with a local token, and writes framed JSON only to stdout. It can start the companion when absent. Responses stay below Chrome's native-message limit. Large screenshots travel from the extension to the companion; screenshots written to disk are served as loopback evidence resources.

## Local service and run lifecycle

The Express companion binds to 127.0.0.1. It validates Host, Origin, cross-site fetch metadata, HTTP URLs, viewport limits, profiles, and evidence paths. Native requests carry a randomly generated local token. CORS is limited to the installed extension ID. No generic proxy, shell command, executable path, or arbitrary CDP command is exposed through HTTP.

Browser mutations are serialized to keep viewport changes and audit evidence consistent. One audit runs at a time. Each run receives a fresh directory; metadata is atomically written after progress updates. Graceful cancellation retains partial results. On restart, interrupted runs are marked failed with an explicit recovery message. A failed check is stored separately from completed checks.

Screenshots and minimized metadata are collected per device. axe-core executes in the existing page; DOM-based observations remain distinct from AI judgments. The capture has bounded font waits, lazy-load preparation, and maximum page height. Coordinate-based crops are derived from the original PNG with sharp; the original is never overwritten. PDFKit generates Original (default) as one canvas of complete screens with findings alongside, or A4 with one fitted full screenshot per screenshot page. Original dimensions scale uniformly when necessary to stay within a 14,000-point page extent; embedded images retain their full resolution. Each layout writes atomically to its own filename. Filesystem paths stay inside the registered run root when served as evidence.

## Interaction synchronization

A single explicit source sends events. Followers never become sources as a result of a mirrored operation; navigation events are suppressed during controlled propagation. Source clicks are executed once. Before propagation, a fixed browser function describes the element. Follower matching tries stable test ID, ID, URL, then role and accessible name, considering only uniquely visible eligible targets at each step. Hidden ID matches can fall back to a corresponding visible URL match in a responsive layout. Missing and ambiguous targets are marked out of sync. The app exposes a resync action.

Only recognized navigation and UI controls are eligible for mirroring. Consequential and unclassified actions remain source-only. Inputs require explicit opt-in and sensitive controls are excluded. This reduces accidental repeats but cannot make arbitrary third-party sites transactionally safe; shared cookies and server state remain shared. Scroll synchronization uses the current identified content section and offset when available, otherwise a normalized document position.

Back/forward use browser history. Full navigations, SPA history updates, queries, and hashes are handled in source actions; page navigation listeners handle delayed changes. Custom widgets without semantic identity can require independent interaction. Popups, downloads, nested-frame interactions, closed shadow roots, and nested scroll regions are not fully synchronized.

## Codex boundary

`companion/codex.mjs` probes the installed CLI and login status without reading or logging credential files. Analysis is an opt-in `codex exec` invocation, using image arguments, JSONL events, a strict output schema, an isolated temporary directory, a read-only sandbox, and disabled shell and other action tools. It ignores user config and rule inheritance to avoid inadvertently enabling unrelated MCP servers, hooks, and plugins. It forwards only the simple top-level model setting from Codex's user config as an explicit argument, unless `ATLAS_CODEX_MODEL` overrides it; other configuration is never inherited. Fatal JSONL events provide error details when stderr contains only progress output. Prompts are passed through stdin via `spawn` with `shell: false`; website data never becomes a shell command. Page evidence is explicitly delimited and classified as untrusted. Agent-generated source, device IDs, and evidence references are validated and constrained to this run. The process times out or aborts on cancellation. The temporary work directory is removed.

Optional page-code evidence uses the same serialized `collectPageCode` implementation in Playwright and the extension's CDP runtime. It reads the current document and accessible CSSOM without fetching script or stylesheet bodies. A bounded allowlist serializer omits form state and executable/data payloads, honoring capture masks before persistence. Sanitized snapshots live in separate per-view JSON files. `codexEvidence` projects metadata and optional HTML/CSS into a per-view share of the prompt budget; it serializes complete JSON instead of cutting the final string. Page code, including apparent instructions within it, remains untrusted evidence with no extra tools or execution permissions.

This is local orchestration of the supported CLI; it is not a desktop API, and may invoke a cloud model. Unsupported CLI options or model errors fail only the AI check and retain local results.

## Board exports

Miro export happens only after a destination-board preview and explicit user action. Tokens live in the companion environment. Each device receives a frame, screenshot image, editable finding sticky notes, supported annotation rectangles, and evidence connectors. A persistent operation ledger enables safe retry of known failures and skips completed creates. Unknown outcomes require explicit ledger reconciliation, avoiding an unsafe retry after an ambiguous network failure. Confluence's documented APIs do not expose equivalent canvas-object creation.

## Verified primary references

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): host manifest registration, extension-origin allowlist, stdio framing, and size limits.
- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger): CDP transport, required debugger permission, target attachment, and policy restrictions.
- [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/), [Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), and [Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/): viewport and screenshot/input operations.
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode): supported `exec`, read-only sandbox, image inputs, ephemeral operation, and JSON schema outputs; verified against the installed CLI help and feature list.
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic): shell tools, feature flags, and configuration inheritance.
- [Playwright screenshots](https://playwright.dev/docs/screenshots) and [axe-core Playwright integration](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright).
- [Miro device-frame creation](https://developers.miro.com/reference/create-frame-item), [editable sticky notes](https://developers.miro.com/reference/create-sticky-note-item-1), and [local image upload](https://developers.miro.com/reference/create-image-item-using-local-file).
- [Confluence Whiteboard API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard/): create, retrieve, and delete whiteboards; no canvas-node creation operations listed.

References checked 29 October 2026. Dependencies and local CLI capabilities may evolve; errors remain visible instead of being represented as successful checks.

Optional live Codex output reads public CLI JSONL and stderr lines as the child process runs, with Node readline handling split UTF-8 and event boundaries. It projects status, assistant-message, warning, and error events into a bounded per-run log, excludes unsupported internal event types, and preserves CLI isolation. Existing one-second audit polling transports updates in standalone and Chrome modes. Partial logs are saved at most once per second while events arrive, and final/cancelled audits retain received output. Run lists omit logs to limit native-messaging payloads; opening history fetches the full run. No extra inference call is made for live output.
