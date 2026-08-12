# dsh-desktop

English | [中文](README.zh.md)

The standalone desktop client for DeepSeek Harness: an **independent project** that consumes the official harness packages from a sibling checkout **without modifying them**. Product decisions and the process model live in [docs/desktop-client-architecture.md](docs/desktop-client-architecture.md); this README covers layout, prerequisites, and commands.

The client is a separate product from the official `dsh` web UI: its own composition (the harness base bundle plus `overlay/desktop.cordis.patch.yml`), its own renderer, its own model-visible identity, and its own data home (`~/.dsh-desktop`, override with `DSH_DESKTOP_HOME`). It never boots the `dsh` web profile, mounts no web client plugins, and the official repository is never written to.

## Layout

```
vscode-projects/
├── test-bruc3van/     # the official deepseek-harness checkout (read-only, sibling)
└── dsh-desktop/       # this project
```

`package.json` consumes the official packages through pnpm `link:` dependencies that point at the sibling checkout. The official repo must have run `pnpm install` and `pnpm run build:lib` once (its `lib/` artifacts are what the client loads at runtime).

## Requirements

- Node `^22.19.0 || >=24.0.0` (the harness child runs on the system Node; a bundled runtime is a packaging follow-up)
- The official checkout as a sibling named `test-bruc3van` (or set `DSH_HARNESS_REPO` to its absolute path)
- macOS (current development target; Windows/Linux are follow-ups)

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

The Electron main spawns the harness child (plain Node + tsx), waits for the `dsh-desktop: <url>` readiness line, and loads the renderer from the loopback carrier at `/app/`.

## First run

1. Launch the client (`pnpm run dev`).
2. Open 设置 (Settings) from the sidebar footer, paste a `DEEPSEEK_API_KEY`, and save. The key is written through the credentials seam into the client's own managed document under `~/.dsh-desktop` — never into configuration files in plain text.
3. Type a message in the composer; a session starts automatically if none is active.

## Scripts

- `scripts/shot.mjs` — screenshot scenario (empty state, settings, composer draft, model menu; plus the live conversation when a key is configured).
- `scripts/audit.mjs` — asserts the visual contract (sidebar geometry, palette, composer radius, type scale, motion duration) through computed styles.
- `scripts/e2e.mjs` — end-to-end smoke: saves the key through the settings panel, sends a real prompt, verifies the streamed reply.

## Known limitations

macOS-first: paths use `HOME`, the window uses `hiddenInset`, and the native directory picker requires the host's desktop tooling. The harness child inherits the environment; a bundled Node runtime and platform packaging (electron-builder) are follow-up work. Deferred seats (each recorded in the architecture doc): IPC carrier instead of loopback HTTP, system tray and notifications, OS keychain provider, queue editing, attachments, voice input.
