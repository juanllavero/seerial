# Releases and auto-update

Every push to `main` runs `.github/workflows/release.yml`, which builds and publishes **only the apps that changed** since their last release.

| App | Platforms | Update |
|---|---|---|
| Server + web (Electron) | Windows (NSIS), macOS arm64 (dmg/zip), Linux (AppImage) | Downloaded in the background; an admin installs it from the web (floating "Update ready" button) and the server restarts |
| Desktop (Tauri) | Windows (NSIS), macOS arm64 (app/dmg) | Checked at startup only: downloaded and installed before the app opens, then it restarts |

## How a release is decided

`.github/scripts/release-info.mjs`:

- **Changed?** `git diff <last tag>..HEAD` over the paths the app is built from (server: `apps/server`, `apps/web`, `libs`; desktop: `apps/desktop`, `libs`; both: root `package.json`, `pnpm-lock.yaml`). Markdown and tests are ignored. Comparing with the last *release tag* (not the previous push) means a failed run is retried on the next push.
- **Version:** `MAJOR.MINOR` from `apps/server/package.json` / `apps/desktop/src-tauri/tauri.conf.json` (bump by hand when you want) + `PATCH` = number of commits. Always grows, no manual bumps.
- **Notes:** commit subjects since the last release of that app.
- Force a release without changes: *Actions → Release → Run workflow* with `force = server,desktop`.

## Where it is published

`.github/scripts/publish-release.mjs`:

- `server-vX.Y.Z` / `desktop-vX.Y.Z`: one prerelease per version with the installers (history and manual downloads).
- `server-channel` / `desktop-channel`: fixed releases the installed apps poll. They only hold the manifests (`latest*.yml` for electron-updater, `latest.json` for the Tauri updater), pointing at the versioned release. **Do not delete them.**

## Native libraries (libmpv)

The desktop app ships its own libmpv: users do not need mpv installed.

- **Windows:** `apps/desktop/scripts/fetch-libmpv-windows.ps1` downloads the shinchiro build and creates `src-tauri/lib/mpv.dll` (shipped next to the .exe) + `mpv.lib` (link time only). Needs the MSVC build tools and 7-Zip.
- **macOS:** `pnpm --dir apps/desktop bundle:libmpv:mac` (needs `brew install mpv`) copies libmpv and its ~50 dylibs into `src-tauri/lib/macos`, rewritten to load from `Contents/Frameworks`, plus MoltenVK and its Vulkan ICD manifest (`main.rs` points `VK_DRIVER_FILES` at it). The app is ad-hoc signed without hardened runtime (required to load ad-hoc signed dylibs) and needs macOS 15+.
- `pnpm --dir apps/desktop dev:app` / `build:app` use the bundled libmpv when present (dev falls back to Homebrew).

## No Apple Developer account

Both macOS apps are ad-hoc signed and not notarized:

- **First install:** after copying the app to Applications, open it once with right click → *Open* (or *System Settings → Privacy & Security → Open anyway*). If macOS says it is damaged: `xattr -cr "/Applications/<App>.app"`.
- **Updates** are not affected: files downloaded by the apps themselves are not quarantined. The server replaces its own `.app` with a small script (Squirrel.Mac, electron-updater's macOS installer, only accepts Developer ID signed apps).

## One-time setup

1. Repository secrets `TAURI_SIGNING_PRIVATE_KEY` (content of `~/.tauri/seerial-desktop.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if none). Losing the key means installed desktop apps can no longer update.
2. `pnpm-lock.yaml` must be committed (CI installs with `--frozen-lockfile`).
3. *Settings → Actions → General → Workflow permissions*: read and write (the workflow also declares `contents: write`).
4. Install each app once by hand from its `*-vX.Y.Z` release; from then on they update themselves.
