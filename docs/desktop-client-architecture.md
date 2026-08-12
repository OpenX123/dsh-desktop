# The desktop client — an independent Electron application over the dsh Web UI's public interface

[中文](desktop-client-architecture.zh.md)

## Problem

The `dsh` web UI is the official product surface. A desktop client was requested as an **independent third-party product**: its own identity, its own data home, its own frontend, and no coupling to the web bundle — while still running real harness sessions. The harness packages are internal to the official repository and are not published, so the client cannot depend on them: at release only the Web UI's **public interface** exists — the `dsh` CLI and the `/api` wire contract it serves.

## Decision

The client (this repository, `dsh-desktop`) is an independent Electron application with three layers:

- **Electron main** (`src/main/`): owns the window, a local loopback **carrier** server, and the Web UI runtime. In **local mode** it spawns the official `dsh web --port 0` — resolved from `DSH_DESKTOP_DSH`, then the **app-bundled `@deepseek-ai/dsh` npm package** (declared in `optionalDependencies`; bundled by the installer, no user-facing npm), then PATH, then the conventional sibling checkout for development — and parses the readiness line (`dsh web: <url>`); in **connect mode** it points at a user-configured Web UI origin. The carrier serves the client's built renderer under `/app/`, reverse-proxies `/api` to the Web UI origin (HTTP POST and WebSocket upgrade, stripping browser markers so the Web UI's loopback trust fence sees a plain client), and owns the client's own `/desktop/*` routes (workspace context, connection status, connection settings). Child supervision mirrors the earlier design: a relaunch budget on startup failure, a fatal dialog on live-child exit, and a graceful stop ladder (SIGTERM→SIGKILL on POSIX, `taskkill /T /F` on Windows, where signals cannot be caught). Inside the packaged app the child runs on Electron's bundled Node (`ELECTRON_RUN_AS_NODE`), so no system Node is required.
- **Window surface**: the client window loads the **official Web UI itself** at the Web UI origin. Session titles and renaming, buttons, and every interaction are the official product's, by construction — the client never re-implements the interface. The client's own surface is a small connection-settings window (menu → "Web UI 连接…") served by a minimal loopback server (`/desktop/status`, `/desktop/settings`, and a self-contained settings page); it selects local-vs-connect mode and the Web UI address. (An earlier iteration of this project shipped a custom React renderer — `src/renderer/`, with a self-contained wire client and vendored protocol schemas under `src/renderer/api/contract/` — retained in-tree for reference but no longer built or loaded.)
- **Settings seam**: the client's own `settings.json` in its data home (`~/.dsh-desktop`) selects the mode and Web UI address; the settings panel and the boot error screen both edit it through `/desktop/settings`.

The client's own connection settings live in `~/.dsh-desktop` (override `DSH_DESKTOP_HOME`); the local child runs with the **official `DSH_HOME` (`~/.dsh`)** so conversations, titles, credentials, and model configuration are shared with the `dsh` CLI and the browser Web UI. The window wears the official logo (macOS template dock icon, Windows/Linux window icon) and a standard title bar (the official Web UI carries its own header). The credentials seam is used as-is: `DEEPSEEK_API_KEY` is set through the official UI's settings.

## Consequences

- `pnpm run dev` builds and launches the client; `pnpm run shot` / `pnpm run audit` / `pnpm run e2e` drive Playwright-based verification.
- The client works identically against a local `dsh web` or any reachable Web UI instance (the Web UI origin is the only coupling), on macOS, Windows, and Linux.
- Sessions run the Web UI's composition (the official web profile) — content search, the `/` command and skill menus, background tasks, message actions (fork, feedback), plan-mode, pending-queue rows, agent presets, the permission selector, the goal chip, the model catalog, and session titles/renaming — because the interface IS the official web app.
- The model-visible orientation is set by the official web profile's own surface prompt (the "Web GUI" identity); the client adds nothing of its own.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Compose the harness core from the official packages (previous architecture) | The packages are internal and unpublished — they cannot exist at release |
| Boot the `dsh` web profile and serve the client UI from it | The client is an independent product: its own renderer, its own data home, no web-app bundle dependency |
| Direct cross-origin `/api` calls from the renderer | The Web UI's trust fence refuses cross-site browser markers; the loopback carrier proxies as a plain client instead |
| IPC fetch carrier | Reserved as a follow-up seat; the loopback HTTP/WS carrier keeps the renderer transport code unchanged |
| Run the harness inside the Electron main process | Electron's Node lags the engine range and native modules would need an Electron-ABI rebuild |