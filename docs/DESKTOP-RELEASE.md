# Desktop releases

The release destination is [gil00pita/ViewportAtlas on GitHub](https://github.com/gil00pita/ViewportAtlas/releases). Signed builds check that public repository through Electron's update service. Development and unsigned preview builds disable automatic updates.

## Build and install locally

Use Node.js 22.13 or newer and run `npm ci`, then `npm run make:desktop` on the target operating system. macOS produces an application, ZIP, and drag-to-Applications DMG. Windows produces an application, ZIP, Squirrel Setup executable, full NuGet package, and RELEASES metadata. Outputs are in `out/`; cross-compilation is not the validation path.

`npm run test:desktop:packaged` runs the integration suite against the packaged executable. `npm run test:desktop:installed` mounts and copies the Mac DMG app into a temporary directory with spaces and Unicode in its path, or silently installs and uninstalls Squirrel in a clean Windows account. The Windows script refuses to overwrite an existing installation. The installed app runs with system-only PATH, exercising its bundled runtime without Node or Chrome on PATH. This is a local installation check, not a substitute for a clean virtual machine.

The Mac's packaged minimum OS is 13.0. Actual minimum-OS operation, Intel Mac, Windows x64, multiple display scales, and clean-machine behavior remain release gates. The current local artifacts are unsigned Apple silicon previews.

## Signing credentials

Set these in the repository's **Settings → Secrets and variables → Actions**. Never put certificates, passwords, or tokens in source files, issues, logs, or chat.

| Secret | Purpose |
| --- | --- |
| `MAC_SIGNING_IDENTITY` | Developer ID Application identity matching the imported certificate |
| `MAC_CERTIFICATE_BASE64` | Base64-encoded Developer ID signing certificate and private key exported as PKCS#12 |
| `MAC_CERTIFICATE_PASSWORD` | Password protecting that PKCS#12 file |
| `APPLE_ID` | Apple account authorized for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `WINDOWS_CERTIFICATE_BASE64` | Base64-encoded Windows code-signing certificate and private key in PFX format |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password protecting that PFX file |

The workflow writes the Windows certificate path to `WINDOWS_CERTIFICATE_FILE`; this is a temporary CI path, not an additional secret. The Apple certificate is imported into a temporary keychain. Cleanup runs even after failure. `ATLAS_RELEASE=1` makes missing signing configuration fail the build. No signing secrets were configured or used during local implementation.

## Release workflow

`.github/workflows/desktop.yml` builds unsigned previews and exercises source, packaged, and installed applications on Apple silicon Mac, Intel Mac, and Windows x64. `.github/workflows/release.yml` performs the signed equivalent, including Apple notarization and signature verification. Both workflows need successful platform execution before support is treated as verified.

1. Finish the platform and manual release gates below. Set the package version and matching lockfile version.
2. Push a matching `v<package version>` tag when ready to run release CI. The workflow also supports a manual signed artifact build without publishing a release.
3. Every matrix job must pass before CI creates a **draft** GitHub Release and uploads installer and updater artifacts. Existing published release assets cannot be replaced by this workflow.
4. Review the draft, signatures, release notes, and upgrade evidence before publishing it. No release was published from this workspace.

Keep the Mac ZIPs as well as DMGs: Electron's Mac updater consumes ZIP update assets. Windows updates need the Squirrel RELEASES and package assets in addition to Setup.exe. GitHub's automatically generated source archives are not application updates.

## Update behavior

Signed packaged builds use `https://update.electronjs.org/gil00pita/ViewportAtlas/<platform>-<arch>/<version>`. They check after startup and every six hours. Update errors remain visible in **Projects & data**; manual checks are available there. Downloaded updates require the explicit **Restart to update** action.

Checks/restarts wait for active recording, replay, report work, exports, downloads, popup sign-in, synchronization delivery, and settings writes. Interrupted work retains its saved state and is never replayed automatically. An actual signed N → N+1 update has not been tested; the busy-operation guard is unit-tested with an updater fixture.

## Gates before publication

- Complete the full source, packaged, and installed integration suites on each CI target with a usable graphical session. All three 23-check suites passed locally on macOS Apple silicon on 5 November; Windows x64 and Intel Mac remain unverified.
- Install on clean macOS and Windows machines without development tooling. Check first launch, install/uninstall, unsigned warnings versus signed trust, report folder access, spaces/Unicode paths, and restart after a crash.
- Verify Apple signature/notarization and Windows Authenticode trust on the actual downloaded installers. Confirm quarantined downloads launch normally.
- Exercise a real signed upgrade from the previous version on each platform. Confirm preferences, per-project sign-ins, flows, and reports survive; test offline update failure and restart deferral during recording/export.
- Manually check real IME composition, native select/date pickers, edit shortcuts, drag/drop, display scaling, minimum window size, and representative SSO/popups on both operating systems. Canvas, cross-frame control internals, closed-shadow widgets, file uploads, and arbitrary application-specific gestures still require explicit independent preparation.
- Live Codex and Miro operations require their own configured credentials and chosen evidence/board. Local AI tests use a labeled CLI fixture and make no paid model request or board write.
