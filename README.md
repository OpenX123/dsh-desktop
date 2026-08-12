# dsh-desktop

English | [中文](README.zh.md)

The standalone desktop client for DeepSeek Harness: an **independent Electron application** that consumes **only the public interface of the official dsh Web UI** — its CLI (`dsh web`) and its `/api` wire contract. It imports no internal harness packages; the official repository is neither a dependency nor ever written to.

The client's window loads the **official Web UI itself** — session titles and renaming, buttons, and every interaction are the official product's, by construction. It wears the official DeepSeek Harness logo (macOS dock template icon, Windows/Linux window icon) and a standard title bar. The client's own surface is a small connection-settings window (menu → "Web UI 连接…"). Product decisions and the process model live in [docs/desktop-client-architecture.md](docs/desktop-client-architecture.md); this README covers layout, prerequisites, and commands.

## Runtime model

The client connects to a **dsh Web UI** through its public interface — two modes, switched from the settings panel:

- **Smart (default, no address set)**: the client first probes a locally running official instance on the default port (`http://127.0.0.1:3080`) and connects to it — the window and the browser then share ONE harness process, so conversations and session state sync **in real time**. Only when nothing answers does the client launch its own `dsh web --port 0` (CLI resolved in this order: `DSH_DESKTOP_DSH` → the **app-bundled `@deepseek-ai/dsh` npm package** (the official distribution, declared in `optionalDependencies`; once it is published, a plain `pnpm install` at build time bundles it — end users never run npm) → `dsh` on PATH → the conventional sibling checkouts for development). Two harness processes share the same `~/.dsh` data on disk, but only a shared process syncs live.
- **Connect**: a Web UI address (local or remote) entered in 设置 (Settings). The client speaks only the `/api` wire contract; no local runtime is spawned.

**Packaging note**: the installer bundles the app's `node_modules` (standard Electron packaging), so the bundled `dsh` ships inside the app. In the packaged app the child runs on Electron's own Node (`ELECTRON_RUN_AS_NODE`), which satisfies the harness engine range — a system Node is not required. Caveat verified during development: Electron's run-as-node ESM resolver does not follow symlinked `node_modules` (the pnpm workspace layout), so the packaged dependency tree must be a real npm-style install (what electron-builder produces); verify once at packaging time.

**Tray-resident**: closing the window keeps the client running in the system tray (macOS menu bar / Windows taskbar area). Left-click (macOS) reopens the window; the tray menu is minimal ("显示主窗口" / "退出"). Quit only via the tray menu, the app menu, or Cmd+Q.

**Enhanced features**: the official General settings form flow gains a trailing "连接" block (marked 增强功能) — connection status + Web UI address, saved through the main process. The injection is heuristic and additive, styled like the official rows; if the official settings dialog cannot be detected the block is simply absent. The native connection window stays reachable via the app menu.

**Data**: in local mode the child runs with the **official `DSH_HOME` (`~/.dsh`, override via the `DSH_HOME` environment variable)** — the same data the `dsh` CLI and the browser Web UI use, so existing conversations, titles, credentials, and model configuration are shared. The client's own connection settings live in its own home (`~/.dsh-desktop`, override `DSH_DESKTOP_HOME`).

## Requirements

- Node `^22.19.0 || >=24.0.0` (for local mode, the `dsh` CLI runs on the system Node; a bundled runtime is a packaging follow-up)
- macOS, Windows, or Linux — no platform-specific code paths (the window title bar, process termination, and home-directory resolution are platform-aware)
- Local mode additionally needs the official `dsh` CLI (see above); connect mode needs a reachable Web UI instance

## Commands

```sh
pnpm install            # first time only (electron binary download)
pnpm run dev            # build renderer + shell, then launch Electron
pnpm run build:renderer # renderer only (vite)
pnpm run build:shell    # main + preload (esbuild)
pnpm run typecheck
pnpm run lint
pnpm run audit          # design-contract audit (computed styles, Playwright)
pnpm run shot           # screenshot scenario into shots/
pnpm run e2e            # live end-to-end smoke (needs an API key, see below)
```

## First run

1. Launch the client (`pnpm run dev`). A local `dsh web` is started automatically and the official Web UI opens in the window. If the CLI is missing or a remote Web UI is preferred, use the app menu → "Web UI 连接…".
2. Open 设置 (Settings) in the sidebar footer, paste a `DEEPSEEK_API_KEY`, and save. The key is written through the credentials seam into the Web UI's managed document under the client's data home — never into configuration files in plain text.
3. Type a message in the composer; a session starts automatically if none is active.

## Scripts

- `scripts/shot.mjs` — screenshot scenario of the official Web UI in the client window (empty state, settings, composer draft).
- `scripts/audit.mjs` — interface boot smoke: the official UI must boot (boot manifest, sidebar, composer) without page errors.
- `scripts/e2e.mjs` — end-to-end smoke: sends a real prompt through the official composer, verifies the streamed reply.

The custom renderer tree (`src/renderer/`) is retained for reference but is no longer built or loaded; `pnpm run build:renderer` still produces it.

## Follow-up work

- **Official npm release sync** — blocked on the official `@deepseek-ai/dsh` npm package being published (not on the registry yet). Once it is: promote it from `optionalDependencies` to a pinned dependency, add a bump script (check latest version → update package.json → rebuild + smoke), and make the release flow "bump version + repackage". This pipeline is how official Web UI updates reach end users.
- Bundled Node runtime, packaging/distribution (electron-builder), system tray and notifications, OS keychain provider, and voice input remain follow-up work.