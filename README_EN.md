# DeepSeek Harness Desktop

[中文](README.md) | English

**Use DeepSeek Harness like a desktop app — with the official Web UI, your existing sessions, and your local workspace in one focused window.**

DeepSeek Harness Desktop is an independent Electron client for `dsh`. It starts or connects to the official `dsh Web UI` and displays that UI directly, so you get the complete Harness experience without keeping another browser tab open.

> [!IMPORTANT]
> **This is an unofficial, community-maintained third-party project.** It is not developed, published, endorsed, or supported by DeepSeek and does not represent DeepSeek. `DeepSeek`, `DeepSeek Harness`, `dsh`, and related names, logos, and trademarks belong to their respective owners. Report desktop-client issues to this repository, not to DeepSeek support.

Release packages bundle a pinned version of the official `@deepseek-ai/dsh` runtime. End users do not need to install Node.js, pnpm, or the `dsh` CLI separately. The desktop shell, installers, connection enhancements, and release signatures are independently maintained by this project and are not part of the official runtime.

The desktop client and official `dsh` use independent version numbers; there is no required correspondence between them. The connection settings page displays both the desktop version and bundled dsh version for compatibility diagnostics.

![DeepSeek Harness Desktop home screen](docs/images/readme-home.png)

## Why use the desktop client?

- **The real Harness experience** — the app loads the official Web UI itself. Projects, conversations, tasks, models, permissions, goals, plans, skills, and slash commands behave exactly as they do in the official product.
- **Desktop connection enhancements** — a clearly labeled connection card is added to the official settings surface, with a separate native connection window. These additions belong to this project and are not official Web UI features.
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

### Download a release

Download the package for your system from [GitHub Releases](https://github.com/bruc3van/dsh-desktop/releases) and launch it. Release builds include the official `dsh` runtime, require no development tools, and do not run an npm install on first launch.

Automated packages are currently unsigned on macOS and Windows. The operating system may show a first-launch security warning; until signing and notarization are configured, this remains a known limitation of the “download and run” experience. Download only from this repository and verify the included `SHA256SUMS.txt`.

#### If the operating system blocks the first launch

- **macOS:** Double-click the app once so macOS records the blocked attempt. Then open **System Settings → Privacy & Security**, find the Security section, choose **Open Anyway**, and enter your login password. The button is available only for a limited time after the launch attempt. See [Apple's official instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).
- **Windows:** If Microsoft Defender SmartScreen shows a protection prompt, first verify the download source and SHA-256 checksum. Then choose **More info → Run anyway** only if they match.

### Run from source

Source development requires Node.js `^22.19.0 || >=24.0.0` and [pnpm](https://pnpm.io/). A separate `dsh` installation is not required.

```sh
git clone https://github.com/bruc3van/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run dev
```

On launch, **Smart mode** first checks `http://127.0.0.1:3080`:

1. If an official Web UI is already running there, the desktop client connects to it. The browser and desktop app then share one live Harness process.
2. Otherwise, the app starts `dsh web --port 0` with the pinned official runtime bundled in the installer or project dependencies.

If the bundled runtime cannot start, or you want to use another instance, open the application menu and choose **Web UI Connection…**.

### First conversation

1. On first launch, enter your key in **Add an API key to get started**. You can also choose **Configure later** and return through **Settings → Models → DeepSeek**.
2. If you do not have a key, use **Create one on the DeepSeek platform** below the field; it opens <https://platform.deepseek.com/api_keys> in your system browser. The link is a desktop-client enhancement. DeepSeek manages the API account, balance, and usage charges.
3. Optionally choose a default Agent preset or model.
4. Add a project folder for workspace-aware tasks, or start a conversation directly.
5. Describe the outcome you want and send the message.

> [!TIP]
> With a fresh data directory, the official Web UI may initially appear in English. Use **Settings → General → Language** to switch languages.

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

Use of this client remains subject to the terms and privacy policies of DeepSeek, model providers, and any connected service. Users and those services are responsible for API keys, model requests, charges, generated content, and Agent actions on local files or commands. The software is provided “as is” under the MIT License, without warranties of fitness, data preservation, service availability, model output, or third-party cost, except where applicable law requires otherwise.

## Desktop behavior

- Closing the main window keeps the app available in the system tray/menu bar.
- Reopen the window from the tray icon.
- Quit from the tray menu, application menu, or `Cmd+Q` on macOS.
- If a locally managed Web UI exits unexpectedly, the client performs a small number of bounded restart attempts instead of retrying forever.
- If the page is unexpectedly blank after system resume or a long idle, the client verifies the Web UI and reloads it automatically.
- Before starting the local service, the packaged macOS app reads the user's login-shell `PATH` once with a three-second deadline and merges only absolute directories. This keeps Homebrew and version-manager tools available to Agents when the app starts from Finder or the Dock.

## Development

```sh
pnpm run build          # build the Electron main process and preload
pnpm run dist           # build packages for the current platform
pnpm run typecheck      # TypeScript validation
pnpm run lint           # source and script linting
pnpm run audit          # boot and browser-surface smoke test
pnpm run smoke:package  # prove the packaged app uses its bundled dsh runtime
pnpm run shot           # refresh screenshots in shots/
pnpm run shot:readme    # refresh the privacy-safe README screenshots
pnpm run e2e            # send a real prompt and verify the streamed response
```

`pnpm run e2e` needs a valid API key. The production window loads the official Web UI; this repository does not maintain a second product renderer.

For the process model, trust boundary, and design decisions, see [Desktop client architecture](docs/desktop-client-architecture.md).

## Releasing a version

To release a version, push its tag directly. GitHub Actions treats the tag as the single version source and writes it to `package.json` during the build:

```sh
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions validates the tag format, uses the tag as the release version, then builds:

- macOS Apple Silicon: DMG;
- macOS Intel: DMG;
- Windows x64: NSIS installer.

Linux packages are temporarily outside the automated release scope; the source-level cross-platform compatibility code remains in place.

After every platform succeeds, the workflow generates SHA-256 checksums and creates or updates the matching GitHub Release. Tags containing prerelease identifiers such as `-rc` or `-beta` are marked as prereleases automatically.

## Project status

The desktop shell, Smart/Connect modes, shared `DSH_HOME`, tray behavior, runtime supervision, bundled official `@deepseek-ai/dsh`, macOS/Windows packaging, and tag-based release automation are implemented. The release workflow launches each packaged app with an empty PATH and probes its Web UI, preventing artifacts that accidentally omit the bundled runtime. Automated artifacts are still unsigned; macOS/Windows signing and notarization remain prerequisites for a warning-free general-user installation. Notifications, OS keychain integration, and voice input are also future work.

Contributions and issue reports are welcome, especially around Windows behavior, remote connections, and packaging.

## License

[MIT](LICENSE)

The MIT License covers only code and assets maintained in this repository. The bundled official `@deepseek-ai/dsh` runtime and other third-party dependencies remain under their own licenses. “DeepSeek Harness” is used in the project name only to identify the compatible product; it does not imply an official relationship.
