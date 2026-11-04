# Viewport Atlas
<!-- impeccable:product-schema 1 -->
## Platform
desktop preview (macOS and Windows targets), with the existing web workspace and Chrome extension retained during migration
## Stack
Implementation choice: Electron desktop runtime with sandboxed Chromium views, React and TypeScript workspace, Chrome Manifest V3 extension, Node.js local companion, Playwright Chromium captures, axe-core checks, PDFKit reports. The desktop migration starts with live views, synchronized text editing, persistent website sessions, and viewport evidence exports. Advanced synchronization, flows, audits, and release installers are later milestones. No cloud deployment.
## Product Purpose
Responsive preview and evidence-based audits. Every screen. One clear picture.
## Users
Website designers, developers, and reviewers working across mobile, tablet, and desktop viewports (inferred from the supplied workflow).
## Operating Context
The desktop preview runs its own Chromium without extension or companion setup. The existing complete audit workflow uses local Chrome or Playwright, the companion, and optional authenticated Codex CLI analysis. Files remain local; selected evidence is sent for AI analysis only when enabled.
## Capabilities and Constraints
The attached brief and subsequent user requests are the implementation specification. Never fabricate audit results, measured scores, device testing, or successful integrations. Preserve site security headers. Chromium viewport emulation is not real-device or cross-engine testing. Audit the current page or explicitly selected screens in a recorded user flow; never crawl unrecorded pages. State and authentication may be shared in extension mode.
## Brand Commitments
Use the supplied hat-and-eye SVG verbatim. Turquoise #00C8B8, coral #FF704B, navy #071F46, cyan #22D9EF, white. Restrained accents, readable controls, room for previews.
## Evidence on Hand
User-provided brief in .context/attachments/rNTF2j/. No existing implementation. An original synthetic demo site may demonstrate preview behavior, labeled as an example.
## Product Principles
Evidence before judgments. Honest failure states. Local ownership of reports. Safe semantic synchronization. Explicit control of AI and external board exports.
