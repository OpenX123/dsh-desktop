# The desktop client — an independent Electron application over the dsh Web UI's public interface

[中文](desktop-client-architecture.zh.md)

## Problem

The `dsh` Web UI is the official product surface. The desktop client must remain an **independent third-party shell** with its own identity and connection settings while running real harness sessions. It therefore composes only public product boundaries: the `dsh` CLI starts a local Web UI when needed, and the window loads the Web UI origin directly. No internal harness package is imported.

## Decision

The client (this repository, `dsh-desktop`) has three runtime layers:

- **Electron main** (`src/main/`): owns the windows and Web UI runtime. In **local mode** it probes the default loopback instance and otherwise spawns `dsh web --port 0`; in **connect mode** it uses a configured Web UI origin. The command resolves from `DSH_DESKTOP_DSH`, the optional app-bundled `@deepseek-ai/dsh`, development sibling checkouts, then PATH. Child supervision provides bounded relaunch, per-generation readiness, stale-callback rejection, and graceful shutdown (SIGTERM→SIGKILL on POSIX; `taskkill /T /F` on Windows). Packaged builds run the bundled CLI through Electron's Node mode (`ELECTRON_RUN_AS_NODE`). Before spawning a local child, the main process overlays the **desktop-owned Web UI patch** (see below).
- **Window surface**: the main window loads the **official Web UI itself** at its origin. Session titles, controls, and all product interactions are therefore official behavior. The preload exposes a small connection bridge and may append a clearly marked connection card to the official settings dialog. The retained `src/renderer/` React implementation is an archival reference only: the default build and shipped window neither build nor load it.
- **Settings seam**: a private random-path loopback page provides the native connection window and writes `settings.json` under `~/.dsh-desktop`. It is not an API carrier and does not proxy `/api`, WebSockets, or renderer assets.

### The desktop-owned Web UI patch

The desktop ships two product changes that live inside the official Web UI's own packages: the **skills management** settings section (list, disable, delete — backed by the `skill.adminList` / `skill.setEnabled` / `skill.remove` RPCs and a durable disabled set under `$DSH_HOME/skills-state.json`), and the **full-roster composer launcher** (the input-box "+" button opens the same commands + skills menu as typing `/`). Both were built against a fixed dsh snapshot; instead of forking dsh, this repository carries the **pre-built patched artifacts** under `vendor/dsh-web-patch/` (2 host bundles + 5 client plugin bundles + a sha256 manifest). `src/main/dsh-patch.ts` copies them over the resolved local dsh installation — a monorepo-checkout layout (`<root>/packages/<pkg>/lib`) — right before `dsh web` spawns: already-patched files are skipped, replaced files keep a one-time `.dsh-desktop-backup`, and unsupported layouts (PATH-dsh, an unrecognized npm layout, or a **remote** origin in probe/connect mode) are skipped loudly, leaving the stock UI. The overlay runs at spawn time only, needs no build toolchain or network, and is disabled by removing the manifest.

The client's own connection settings live in `~/.dsh-desktop` (override `DSH_DESKTOP_HOME`); the local child runs with the **official `DSH_HOME` (`~/.dsh`)** so conversations, titles, credentials, and model configuration are shared with the `dsh` CLI and the browser Web UI. The window wears the official logo (macOS template dock icon, Windows/Linux window icon) and a standard title bar (the official Web UI carries its own header). The credentials seam is used as-is: `DEEPSEEK_API_KEY` is set through the official UI's settings.

## Consequences

- `pnpm run dev` builds and launches the client; `pnpm run shot` / `pnpm run audit` / `pnpm run e2e` drive Playwright-based verification.
- The client works identically against a local `dsh web` or any reachable Web UI instance (the Web UI origin is the only coupling), on macOS, Windows, and Linux. The Web UI patch applies only to a client-spawned local child; connecting to a remote/probed official instance serves that instance's stock UI.
- Sessions run the Web UI's composition (the official web profile) — content search, the `/` command and skill menus, background tasks, message actions (fork, feedback), plan-mode, pending-queue rows, agent presets, the permission selector, the goal chip, the model catalog, and session titles/renaming — because the interface IS the official web app.
- The model-visible orientation is set by the official web profile's own surface prompt (the "Web GUI" identity); the client adds nothing of its own.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Compose the harness core from the official packages (previous architecture) | The packages are internal and unpublished — they cannot exist at release |
| Maintain a second production renderer | It duplicates the official product surface and drifts from official behavior |
| Reverse-proxy `/api`, WebSockets, and assets through a desktop carrier | Loading the official Web UI origin directly is a smaller and more faithful boundary |
| Direct cross-origin `/api` calls from a custom renderer | There is no production custom renderer; the official page talks to its own origin |
| Run the harness inside the Electron main process | Electron's Node lags the engine range and native modules would need an Electron-ABI rebuild |
