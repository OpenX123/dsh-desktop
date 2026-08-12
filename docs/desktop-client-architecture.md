# The desktop client — an independent Electron application over the harness core

[中文](desktop-client-architecture.zh.md)

## Problem

The `dsh` web UI is the official product surface. A desktop client was requested as an **independent third-party product**: its own identity, its own data home, its own frontend, and no coupling to the web bundle — while still running real harness sessions. The GUI layering RFC reserved the Electron seat ([GUI layering and RPC protocol](2026-07-19-gui-layering-and-rpc-protocol.md): "a future Electron application reuses the same web client packages over an IPC fetch carrier"), but the product-separation stance means the client must not mount the `web-app` bundle, its client-plugin roster, or its "Web GUI" surface prompt.

## Decision

The client (this repository, `dsh-desktop`) is an independent Electron application with three layers:

- **Harness child** (`src/host/`): a plain Node process (tsx in dev; a bundled Node runtime in the packaged app) that composes the harness CORE — the `dsh-base` bundle plus the desktop overlay patch (`overlay/desktop.cordis.patch.yml`) — and mounts the desktop glue plugin programmatically. It never boots the `dsh` web profile, and it consumes the official packages read-only from a sibling checkout (`link:` dependencies; the official repository is never modified). The overlay adds only the GUI host plane the client needs: webserver (loopback), api-gateway, the connection node half (the `/api` binding and loopback trust fence), workspace, storage/message-feedback, session-projection-cache, and the adaptive directory picker. The base's `hmr` and `telemetry-otel` rows are disabled: the client has no module system to reload and does not phone home by default.
- **Desktop glue** (`src/host/glue.ts`): provides the `desktopStartup` service (the invocation's `--port`), serves the client's built renderer under the `/app/` prefix route (same-origin with `/api`, so the trust fence passes), serves the `/desktop/context` route (workspace path + git branch for the composer's context bar), registers the `app:desktop-surface` prompt section (the model is told it is in the desktop client, never the Web GUI), and prints the readiness line (`dsh-desktop: <url>`) the main process parses.
- **Electron main** (`src/main/`): spawns and supervises the harness child (relaunch budget on startup failure, fatal dialog on live-child exit), creates the window (`hiddenInset` title bar, `contextIsolation` + `sandbox`, no Node in the renderer), installs the standard role menu, and holds the single-instance lock. The preload exposes only platform facts; the OS username arrives via an additional argv flag because sandboxed preloads cannot import Node built-ins.
- **Renderer** (`src/renderer/`): an independent React app (Vite, `base: '/app/'`) implementing the client's visual system (black/white/neutral grays, `#F7F7F5` 320px sidebar, white main area, 860px floating composer with 26px radius, 31px empty-state title, Lucide 1.5px stroke icons, SF Pro / PingFang SC, 120–180ms motion). It consumes the shared wire contract through `AbstractApiClient` (`@deepseek-ai/dsh-host-apiproxy/client`) with a same-origin WebSocket carrier — the transport-aspect subclass the RFC reserves — and folds the mux stream into its own conversation model (`state/fold.ts`).

The client's data home is `~/.dsh-desktop` (override `DSH_DESKTOP_HOME`): settings, credentials, sessions, and profiles are fully separate from the CLI's `~/.dsh`. The credentials seam is used as-is: the settings panel writes `DEEPSEEK_API_KEY` through `credentials.set` into the client's own managed document.

## Consequences

- `pnpm run dev` builds and launches the client; `pnpm run shot` / `pnpm run audit` / `pnpm run e2e` drive Playwright-based verification (the audit asserts the visual contract through computed styles — sidebar width/color, composer geometry, type scale, motion duration).
- Sessions created in the client run the base agent plane (all base tools), not the web profile's preset-restricted plane; agent presets are not mounted.
- The client's model-visible identity is its own: `app:desktop-surface` says "desktop client", and the harness-source section still names the checkout for the self-modification toolset.
- The feature surface tracks the official web UI: content search (`session.search`), the `/` command and skill menu (`command.list` + `skill.list`), the background-task panel (`session/tasks` frames), message actions (fork via `session.fork`, feedback via the `messageFeedback/*` Remote through the `api-remotes` gateway), plan-mode chip (the `plan` projection + `/plan`), pending-queue rows (`session/queue` + `session.updateQueue`), image attachments (prompt image parts), the agent-preset roster (`agent-presets` row over the official presets with the base agent plane disabled exactly like the web profile), the permission-preset selector (the host `/permission` command), the goal chip (`goal.*` domain), and the settings panel (credential, default preset, model catalog via `llm.models`).
- Deferred to later iterations (each is a documented seat, not a gap): the IPC fetch carrier (the client currently rides loopback HTTP + WebSockets), system tray/notifications, OS keychain provider for the credentials seam, voice input, packaging/distribution (electron-builder), and the trajectory/subagent-tree view.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Boot the `dsh` web profile and serve the client UI from it | The client is an independent product: no web-app bundle, no web surface prompt, no shared data home |
| Drive the runtime through the SDK JSON-RPC protocol | The protocol carries no GUI domains (settings, credentials, approvals, workspace management, model selection) — it is an automation protocol |
| Run the harness inside the Electron main process | Electron's Node lags the engine range and `node:sqlite` (fixed only recently), and native modules (node-pty/koffi) would need an Electron-ABI rebuild; a plain-Node child keeps them stock |
| Mount the web client-plugin roster in the renderer | The renderer is an independent app with its own design system; the plugin system would drag in the web UI's composition |
| A new bundle package `dsh-desktop-app` | The overlay patch + programmatic glue mount is the "assembly written in the app" form; a bundle package adds no consumer |
