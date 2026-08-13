# The desktop client — an independent Electron application over the dsh Web UI's public interface

[中文](desktop-client-architecture.zh.md)

## Problem

The `dsh` Web UI is the official product surface. The desktop client must remain an **independent third-party shell** with its own identity and connection settings while running real harness sessions. It therefore composes only public product boundaries: the `dsh` CLI starts a local Web UI when needed, and the window loads the Web UI origin directly. No internal harness package is imported.

## Decision

The client (this repository, `dsh-desktop`) has three runtime layers:

- **Electron main** (`src/main/`): owns the windows and Web UI runtime. In **local mode** it probes the default loopback instance and otherwise spawns `dsh web --port 0`; in **connect mode** it uses a configured Web UI origin. In development, the command resolves from `DSH_DESKTOP_DSH`, the pinned `@deepseek-ai/dsh` dependency, sibling checkouts, then PATH. Release packages must carry the official CLI's complete runtime closure; a missing closure is reported as a damaged installation instead of silently falling through to PATH. Child supervision provides bounded relaunch, per-generation readiness, stale-callback rejection, and graceful shutdown (SIGTERM→SIGKILL on POSIX; `taskkill /T /F` on Windows). Packaged builds run the bundled CLI through Electron's Node mode (`ELECTRON_RUN_AS_NODE`). Before that launch, packaged macOS builds merge a deadline-bounded login-shell PATH for later Agent subprocesses to inherit.
- **Window surface**: Electron paints a local loading document immediately after ready, then the same secure window loads the **official Web UI itself** at its origin. Session titles, controls, and all product interactions are therefore official behavior. The preload exposes a small connection bridge and may append a clearly marked connection card and DeepSeek key-help link to the official settings dialog. The repository does not maintain or build a second product renderer.
- **Settings seam**: a private random-path loopback page provides the native connection window and writes `settings.json` under `~/.dsh-desktop`. It is not an API carrier and does not proxy `/api`, WebSockets, or renderer assets.

The client's own connection settings live in `~/.dsh-desktop` (override `DSH_DESKTOP_HOME`); the local child runs with the **official `DSH_HOME` (`~/.dsh`)** so conversations, titles, credentials, and model configuration are shared with the `dsh` CLI and the browser Web UI. The window wears the official logo (macOS template dock icon, Windows/Linux window icon) and a standard title bar (the official Web UI carries its own header). The credentials seam is used as-is: `DEEPSEEK_API_KEY` is set through the official UI's settings.

Development/diagnostic variables `DSH_DESKTOP_DSH` and `DSH_DESKTOP_NODE` override the CLI and Node paths. `DSH_DESKTOP_SKIP_PROBE=1` is test-only: it forces automation through the bundled local runtime and is not a user configuration surface.

The current release matrix covers separate macOS Apple Silicon and Intel packages plus Windows x64. Each native runner deploys only its current architecture. `dsh-runtime/package.json` retains Linux x64 native optional packages for source builds and future release re-enablement. Adding a release architecture or upgrading dsh requires rechecking that list and running the package smoke on the corresponding platform.

## Consequences

- `pnpm run dev` builds and launches the client; `pnpm run shot` / `pnpm run audit` / `pnpm run e2e` drive Playwright-based verification. `pnpm run smoke:package` launches the packaged app with an empty PATH, requires explicit bundled-CLI selection, and probes `host.describe`.
- The client works identically against a local `dsh web` or any reachable Web UI instance (the Web UI origin is the only coupling), on macOS, Windows, and Linux; local, probed, and remote modes show that instance's stock official UI.
- Sessions run the Web UI's composition (the official web profile) — content search, the `/` command and skill menus, background tasks, message actions (fork, feedback), plan-mode, pending-queue rows, agent presets, the permission selector, the goal chip, the model catalog, and session titles/renaming — because the interface IS the official web app.
- The model-visible orientation is set by the official web profile's own surface prompt (the "Web GUI" identity); the client adds nothing of its own.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Compose many fine-grained harness packages directly (previous architecture) | The published `@deepseek-ai/dsh` CLI is a more stable and complete public runtime boundary |
| Maintain a second production renderer | It duplicates the official product surface and drifts from official behavior |
| Reverse-proxy `/api`, WebSockets, and assets through a desktop carrier | Loading the official Web UI origin directly is a smaller and more faithful boundary |
| Direct cross-origin `/api` calls from a custom renderer | There is no production custom renderer; the official page talks to its own origin |
| Run the harness inside the Electron main process | Electron's Node lags the engine range and native modules would need an Electron-ABI rebuild |
