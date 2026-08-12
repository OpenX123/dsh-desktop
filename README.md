# DeepSeek Harness Desktop

English | [中文](README.zh.md)

**Use DeepSeek Harness like a desktop app — with the official Web UI, your existing sessions, and your local workspace in one focused window.**

DeepSeek Harness Desktop is an independent Electron client for `dsh`. It starts or connects to the official `dsh Web UI` and displays that UI directly, so you get the complete Harness experience without keeping another browser tab open.

> [!IMPORTANT]
> This project is currently a **developer preview**. There is no downloadable installer yet; run it from source using the instructions below.

![DeepSeek Harness Desktop home screen](docs/images/readme-home.png)

## Why use the desktop client?

- **The real Harness experience** — the app loads the official Web UI itself. Projects, conversations, tasks, models, permissions, goals, plans, skills, and slash commands behave exactly as they do in the official product.
- **Start with less setup** — in Smart mode, the app reuses an official Web UI already running on your computer. If none is found, it starts `dsh web` for you.
- **Keep your work continuous** — local mode uses the same `~/.dsh` data as the `dsh` CLI and browser Web UI. Your conversations, titles, credentials, and model configuration stay together.
- **Connect wherever your Agent runs** — use the local runtime for everyday work, or point the app at another reachable `dsh Web UI` instance.
- **A desktop-native home for long-running work** — close the window without stopping the app, reopen it from the system tray, and keep Agent sessions separate from browser clutter.
- **A small, auditable integration boundary** — the client uses only the public `dsh web` CLI and `/api` contract. It does not patch the official repository or import private Harness internals.

## What you can do

Use the client for the same work you already give to an Agent:

- open a local project and let the Agent read or modify workspace files;
- keep multiple conversations and find previous sessions from the sidebar;
- monitor background tasks and long-running goals;
- choose a model and adjust permissions before sending a request;
- attach files, use plans, queue follow-up work, and invoke available skills or `/` commands;
- manage your API key, Agent preset, and connection from the settings UI.

This interface is not a reimplementation. It is the official Web UI running inside a secure Electron window, so new official UI capabilities can reach the desktop without maintaining a second product surface.

## Quick start

### Prerequisites

- macOS, Windows, or Linux;
- Node.js `^22.19.0 || >=24.0.0`;
- [pnpm](https://pnpm.io/);
- the official `dsh` CLI available on `PATH`, or an already running/reachable `dsh Web UI`.

### Run from source

```sh
git clone https://github.com/bruc3van/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run dev
```

On launch, **Smart mode** first checks `http://127.0.0.1:3080`:

1. If an official Web UI is already running there, the desktop client connects to it. The browser and desktop app then share one live Harness process.
2. Otherwise, the app starts its own `dsh web --port 0` process.

If the local CLI cannot be found, or you want to use another instance, open the application menu and choose **Web UI Connection…**.

### First conversation

1. Open **Settings** at the bottom of the sidebar.
2. Enter your `DEEPSEEK_API_KEY` and save it. The official Web UI manages the credential under `DSH_HOME`; it is not stored in the desktop connection settings.
3. Optionally choose a default Agent preset or model.
4. Add a project folder for workspace-aware tasks, or start a conversation directly.
5. Describe the outcome you want and send the message.

## Two connection modes

| Mode | Best for | Behavior |
|---|---|---|
| **Smart** (default) | Most local users | Reuses the official instance on `127.0.0.1:3080`, or starts a local `dsh web` process when needed. |
| **Connect** | Remote machines, containers, or a manually managed runtime | Connects to the Web UI address you provide and does not start a local runtime. |

Leave the Web UI address empty to return to Smart mode. Connection settings can be changed from the enhanced block in General Settings or from **Web UI Connection…** in the application menu.

![Connection settings in the current desktop client](docs/images/readme-settings.png)

> [!TIP]
> For a remote instance, use a trusted network and HTTPS where available. The configured address is a direct connection target, not a relay operated by this project.

## Data and privacy

The desktop shell and the Harness runtime keep separate responsibilities:

| Data | Default location | Owner |
|---|---|---|
| Conversations, credentials, model configuration, and official Harness state | `~/.dsh` | Official `dsh` runtime |
| Desktop connection preference | `~/.dsh-desktop/settings.json` | Desktop client |

Override these locations with `DSH_HOME` and `DSH_DESKTOP_HOME` respectively.

The Electron window runs with context isolation and sandboxing enabled, Node integration disabled, navigation restricted to the configured Web UI origin, and external links opened in the system browser. The project never modifies the official Harness repository.

## Desktop behavior

- Closing the main window keeps the app available in the system tray/menu bar.
- Reopen the window from the tray icon.
- Quit from the tray menu, application menu, or `Cmd+Q` on macOS.
- If a locally managed Web UI exits unexpectedly, the client performs a small number of bounded restart attempts instead of retrying forever.

## Development

```sh
pnpm run build          # build the Electron main process and preload
pnpm run typecheck      # TypeScript validation
pnpm run lint           # source and script linting
pnpm run audit          # boot and browser-surface smoke test
pnpm run shot           # refresh screenshots in shots/
pnpm run e2e            # send a real prompt and verify the streamed response
```

`pnpm run e2e` needs a valid API key. The retained `src/renderer/` tree is archival reference code; the production window loads the official Web UI and does not build or use that renderer.

For the process model, trust boundary, and design decisions, see [Desktop client architecture](docs/desktop-client-architecture.md).

## Project status

The core desktop shell, Smart/Connect modes, shared `DSH_HOME`, tray behavior, runtime supervision, and smoke-test scripts are implemented. Before a general-user release, the project still needs signed installers, release packaging, and final integration with the official published `@deepseek-ai/dsh` package. Notifications, OS keychain integration, and voice input are also future work.

Contributions and issue reports are welcome, especially around Windows/Linux behavior, remote connections, and packaging.

## License

[MIT](LICENSE)
