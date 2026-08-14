# DeepSeek Harness Desktop

中文 | [English](README_EN.md)

**把 DeepSeek Harness 当作桌面应用来使用：官方界面、已有会话和本地工作区，都在一个专注的窗口里。**

DeepSeek Harness Desktop 是一个独立的 `dsh` Electron 客户端。它会启动或连接官方 `dsh Web UI`，并直接呈现官方界面，让你无需一直保留浏览器标签页，也能完整使用 Harness。

> [!IMPORTANT]
> **这是社区维护的非官方第三方项目。** 本项目并非 DeepSeek 官方产品，不由 DeepSeek 开发、发布、背书或提供支持，也不代表 DeepSeek 的立场。`DeepSeek`、`DeepSeek Harness`、`dsh` 及相关名称、标识和商标归其各自权利人所有。桌面客户端的问题请提交到本仓库，不要联系 DeepSeek 官方支持。

发布安装包内置固定版本的官方 `@deepseek-ai/dsh` 运行时；普通用户无需另外安装 Node.js、pnpm 或 `dsh` CLI。桌面外壳、安装包、连接增强与发布签名均由本项目独立负责，不属于官方运行时的一部分。

桌面客户端与官方 `dsh` 使用各自独立的版本号，两者没有对应关系。应用的连接设置页会同时显示“桌面客户端版本”和“内置 dsh 版本”，便于排查兼容问题。

![DeepSeek Harness Desktop 首页](docs/images/readme-home.png)

## 为什么值得使用？

- **原汁原味的 Harness 能力**：应用直接加载官方 Web UI。项目、会话、任务、模型、权限、目标、计划、技能与斜杠命令都沿用官方产品行为。
- **桌面端连接增强**：在官方设置界面中追加明确标注的连接卡片，并提供独立的原生连接窗口；这些增强属于本项目，不是官方 Web UI 功能。
- **更少的启动步骤**：智能模式会优先复用电脑上已经运行的官方 Web UI；没有可用实例时，再用你自己安装的 `dsh`（如果有）或内置运行时替你在后台启动 `dsh web`。
- **工作上下文自然延续**：本地模式与 `dsh` CLI、浏览器版共用 `~/.dsh`，已有会话、标题、凭据和模型配置无需搬家。
- **Agent 在哪里都能连接**：日常使用可以运行本地实例，也可以让桌面端连接另一台机器或容器中的 `dsh Web UI`。
- **更适合长时间 Agent 任务**：关闭窗口不会立即退出应用，可从系统托盘重新打开，让 Agent 工作与浏览器标签页彼此独立。
- **边界小、容易审计**：客户端只使用公开的 `dsh web` CLI 和 `/api` 协议，不修改官方仓库，也不依赖 Harness 私有内部包。

## 你可以用它做什么？

它适合承接你平时交给 Agent 的工作，例如：

- 打开本地项目，让 Agent 读取或修改工作区文件；
- 同时管理多个会话，并从侧栏找回历史任务；
- 查看后台任务和持续时间较长的目标；
- 发送前选择模型、调整权限范围；
- 添加附件、使用计划、排队后续请求，调用可用技能或 `/` 命令；
- 在设置中管理 API Key、默认 Agent 预设与连接方式。

这套界面不是桌面端重新仿制的版本，而是运行在安全 Electron 窗口中的官方 Web UI。因此官方界面增加新能力时，桌面端无需长期维护另一套容易分叉的产品表面。

## 快速开始

### 下载发布版

从 [GitHub Releases](https://github.com/bruc3van/dsh-desktop/releases) 下载适合当前系统的安装包并启动即可。发布版内置官方 `dsh` 运行时，不依赖开发环境，也不会在首次启动时执行 npm 安装。

当前安装包尚未经过正式的开发者签名认证，首次打开时系统可能会弹出提示，按下方说明操作一次即可正常使用。

#### 首次打开被系统拦截时

- **macOS**：把应用拖入「应用程序」后双击打开。系统会提示无法打开，去「系统设置 → 隐私与安全性」，在「安全性」区域点击「仍要打开」，输入密码即可。

  极少数情况下如果提示「已损坏，无法打开」、且系统设置里没有「仍要打开」按钮，打开「终端」执行以下命令后再双击打开应用：

  ```sh
  xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness Desktop.app"
  ```
- **Windows**：如果 Microsoft Defender SmartScreen 弹出提示，点击「更多信息」，再点击「仍要运行」即可。

### 从源码运行

源码开发需要 Node.js `^22.19.0 || >=24.0.0` 和 [pnpm](https://pnpm.io/zh/)；不需要另外安装 `dsh`。

```sh
git clone https://github.com/bruc3van/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run dev
```

应用启动后，默认的**智能模式**会按以下顺序选择运行时：

1. 先检查 `http://127.0.0.1:3080`。如果这里已经运行官方 Web UI，桌面端直接复用它。此时浏览器和桌面端共享同一个 Harness 进程，会话状态可以实时同步。
2. 没有可复用实例时，找 PATH 上是否装有 `dsh`（`dsh --version` 能正常返回即算可用）。
3. 再找 npx 是否已经缓存过官方包。**官方安装方式 `npx @deepseek-ai/dsh web` 不会往 PATH 里装任何东西**，而是把完整的包留在 npm 缓存里（POSIX 在 `~/.npm/_npx/`，Windows 在 `%LOCALAPPDATA%\npm-cache\_npx\`）。只要你按官方文档跑过一次，这份包就能直接复用。
4. 都没有时，才使用安装包或项目依赖中固定的内置运行时。

第 2、3 步都跑在**你自己的 Node** 上，且只使用**已经存在**的包——不联网、不下载、不替你安装 Node.js；缓存里没有就直接跳过。客户端读取缓存包的 `package.json` 校验其确实是 `@deepseek-ai/dsh` 并取用真实版本号，不会误启动同路径下的其他东西。

启动的都是纯后台服务进程（`dsh web --port 0`），不会打开浏览器窗口，也不占用 3080；退出桌面端时，客户端启动的服务会被一并关闭。若选中的运行时启动失败，客户端会自动回退到内置运行时。连接设置里会显示当前用的是哪一种（本机安装 / npx 缓存 / 内置）及其版本。

如果内置运行时无法启动，或希望使用其他实例，请打开**「设置 → 通用设置 → 连接」**修改连接；页面完全加载不出来时，启动界面会直接给出**「Web UI 连接…」**按钮。

### 开始第一次对话

1. 首次启动时，在「添加一个 API Key 开始使用」引导中填写密钥；也可以选择「稍后配置」，之后从「设置 → 模型 → DeepSeek」完成。
2. 还没有 Key 时，点击输入框下方的「前往 DeepSeek 开放平台创建」，系统浏览器会打开 <https://platform.deepseek.com/api_keys>。该链接是本项目的桌面增强；API 账户、余额与费用由 DeepSeek 开放平台管理。
3. 根据需要选择默认 Agent 预设或模型。
4. 若任务需要读写文件，先添加一个项目文件夹；也可以直接新建会话。
5. 描述希望 Agent 完成的结果，然后发送消息。

> [!TIP]
> 全新数据目录下，官方 Web UI 可能默认显示英文。可从 **Settings → General → Language** 切换为中文。

## 两种连接方式

客户端同时服务两类用户，两条路径都是一等公民：

- **内置运行时**：为“装好就能用”准备。安装包自带固定版本的官方运行时，不需要 Node.js、pnpm 或 `dsh` CLI，双击即可开始对话。
- **连接已有的完整服务**：为专业开发准备。你在终端里用自己的 Node 环境跑 `dsh web`（本机、远程机器或容器均可），桌面端只作为窗口连上去，运行时版本、插件与环境完全由你掌控。

| 模式 | 适合场景 | 实际行为 |
|---|---|---|
| **智能模式**（默认） | 大多数本机用户 | 依次尝试：复用 `127.0.0.1:3080` 上的官方实例 → PATH 上的 `dsh` → npx 缓存中的官方包 → 内置运行时。 |
| **连接模式** | 远程机器、容器或自行维护的运行时 | 直接连接你填写的 Web UI 地址，不启动本地运行时。 |

在智能模式下，只要你已经在终端里跑着官方 Web UI，桌面端就会直接复用它——这正是开发者路径：会话与桌面端实时共享，而 Agent 跑在你自己的完整 shell 环境里。

保存过有效的远程地址后，连接设置中会显示“切换到本地 / 切换到远程”快捷按钮。切换到本地会进入智能模式，但保留远程地址，之后可以一键切回；只有编辑地址时才需要使用“保存并重连”。

清空 Web UI 地址即可恢复智能模式。连接设置位于官方设置弹窗「通用设置」里的「连接」增强区块。

![当前桌面端的 Web UI 连接设置](docs/images/readme-settings.png)

> [!TIP]
> 连接远程实例时，请使用可信网络，并在条件允许时使用 HTTPS。这里填写的是客户端直连地址，本项目不会通过第三方中转你的请求。

## 数据与隐私

桌面外壳和 Harness 运行时各自管理不同的数据：

| 数据 | 默认位置 | 管理方 |
|---|---|---|
| 会话、凭据、模型配置与其他官方 Harness 状态 | `~/.dsh` | 官方 `dsh` 运行时 |
| 桌面端连接偏好 | `~/.dsh-desktop/settings.json` | 桌面客户端 |

可以分别通过 `DSH_HOME` 和 `DSH_DESKTOP_HOME` 覆盖这两个目录。

Electron 窗口已开启上下文隔离与沙箱、关闭 Node 集成，将页面导航限制在当前 Web UI 源站，并把外部链接交给系统浏览器打开。项目不会修改官方 Harness 仓库。

使用本客户端仍需遵守 DeepSeek、模型提供方和所连接服务各自的条款与隐私政策。API Key、模型请求、费用、生成内容以及 Agent 对本机文件或命令的操作由用户和对应服务负责。本软件按 MIT 许可证“原样”提供，不承诺适用于特定用途，也不对数据丢失、服务中断、模型输出或第三方费用承担保证责任；法律另有强制规定的除外。

## 桌面端行为

- 关闭主窗口后，应用继续驻留在系统托盘或 macOS 菜单栏。
- 点击托盘图标可以重新打开主窗口。
- 可通过托盘菜单，或 macOS 的应用菜单 / `Cmd+Q` 完全退出。Windows、Linux 窗口内不显示菜单栏。
- 发布版启动约 4 秒后会检查 GitHub Releases 上的新版本（12 小时内不重复自动检查）。也可在「设置 → 通用设置 → 应用更新」、托盘菜单或 macOS 应用菜单中手动检查；确认后下载安装包、校验 SHA-256 并启动安装程序。开发态默认不自动检查。
- 智能模式复用的 `127.0.0.1:3080` 官方实例失联时，客户端会自动回落到内置本地 `dsh web`；固定远程连接失败不会擅自改用本地服务。
- 本地 Web UI 意外退出时，客户端只会进行有限次数的重启，不会无限循环。
- 系统唤醒或长时间后台运行后若页面异常空白，客户端会在确认 Web UI 可达后自动重新加载。
- macOS 发布版会在启动本地服务前读取一次用户 shell 的 `PATH`（先尝试交互式登录 shell，最长 3 秒；失败再退回非交互登录 shell，最长 2 秒），只合并绝对路径目录，使 Agent 从 Finder/Dock 启动时仍能找到 Homebrew、`~/.local/bin` 以及写在 `~/.zshrc` 里的工具目录。

## 内置运行时下的 Agent 执行环境

使用内置运行时时，Agent 的能力与官方 `dsh` 一致（同一份运行时、同一个 `~/.dsh`、同样的系统级沙箱机制），执行环境按以下方式对齐到“你在终端里跑 dsh”的效果：

- **`node` 始终可用**：发布版把 Electron 内置的 Node 以 `node` 之名发布到 `~/.dsh-desktop/bin`，并**追加**到运行时的 `PATH` 末尾。没装过 Node 的用户，Agent 也能执行 `node script.js`；装过 Node 的用户仍优先使用自己的版本。该目录不提供 `npm`/`npx`——需要它们的场景（例如用 `npx` 启动 MCP 服务）请自行安装 Node.js，或改用连接模式。这个 shim 依靠设置 `ELECTRON_RUN_AS_NODE` 让 Electron 以 Node 方式运行，因此**经它启动的 node 进程及其子进程**会带上该变量：如果你的 node 脚本里还要再启动基于 Electron 的工具，需自行清除该变量，或安装一份真正的 Node.js。
- **不污染 Agent 的环境**：内置运行时依靠 `ELECTRON_RUN_AS_NODE` 跑在 Electron 的 Node 上，这是启动方式的实现细节。客户端会在运行时启动后将其从环境中摘除，只在运行时自身需要重新拉起 Node 子进程时（原生文件夹选择器、Windows ACL 沙箱执行器）临时补回，因此 Agent 执行的命令**不会**继承它——否则 Agent 运行任何基于 Electron 的工具（如 `code`）都会失败。
- **文件权限**：应用未启用 App Sandbox，Agent 的文件读写权限与普通用户进程相同。macOS 首次访问桌面、文稿、下载等受保护目录时会以本应用名义询问，授权按应用记账（终端里已有的授权不会自动带过来）；系统弹窗会说明用途。
- **版本固定**：内置运行时版本随安装包发布，不能单独升级。需要紧跟官方最新版本时，请使用连接模式。

## 开发与验证

```sh
pnpm run build          # 构建 Electron 主进程与 preload
pnpm run prepare:runtime # 准备内置 dsh 运行时闭包
pnpm run check:picker   # 验证内置 Win32 目录选择器兼容补丁
pnpm run check:runtime-env # 验证 Agent 执行环境不继承 Electron Node 模式变量
pnpm run dist           # 为当前平台生成安装包
pnpm run typecheck      # TypeScript 类型检查
pnpm run lint           # 检查源码与脚本
pnpm run check:updater  # 验证应用内更新检查、哈希校验与忽略版本
pnpm run audit          # 启动与浏览器界面冒烟验证
pnpm run smoke:package  # 验证打包应用确实使用内置 dsh 运行时
pnpm run shot           # 更新 shots/ 中的截图
pnpm run shot:readme    # 更新 README 使用的隐私安全截图
pnpm run e2e            # 发送真实请求并验证流式回复
```

`pnpm run e2e` 需要有效的 API Key。生产窗口直接加载官方 Web UI；仓库不维护第二套产品 renderer。`pnpm run check:updater` 用本地更新清单夹具验证检查、下载校验和忽略版本。

进程模型、信任边界和设计取舍详见[桌面客户端架构](docs/desktop-client-architecture.zh.md)。

## 版本发布

发布版本时直接推送版本 tag；GitHub Actions 会以 tag 为唯一版本来源，并在构建时写入 `package.json`：

```sh
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions 会校验 tag 格式，并以 tag 作为发布版本分别构建：

- macOS Apple Silicon：DMG；
- macOS Intel：DMG；
- Windows x64：NSIS 安装程序。

Linux 安装包暂不在自动发布范围内；源码中的通用平台兼容逻辑仍予保留。

全部平台构建成功后，工作流会生成 SHA-256 校验文件和 `latest.json` 在线更新清单，并创建或更新对应的 GitHub Release。包含 `-rc`、`-beta` 等预发布标识的 tag 会自动标记为预发布版本；预发布不会成为 `/releases/latest` 上的更新源。

## 当前状态

桌面外壳、智能/连接模式、共享 `DSH_HOME`、托盘常驻、运行时监护、应用内在线更新、内置官方 `@deepseek-ai/dsh`、macOS/Windows 打包和 tag 自动发布流程均已实现。发布流水线会在空 PATH 下启动打包应用并探测 Web UI，阻止遗漏内置运行时的产物发布。当前自动产物尚未进行代码签名；macOS/Windows 签名与公证仍是面向普通用户无警告安装的发布前置条件。系统通知、OS Keychain 与语音输入也属于后续工作。

欢迎提交贡献与问题反馈，尤其是 Windows 使用、远程连接和打包方面的反馈。

## 许可证

[MIT](LICENSE)

MIT 许可证仅适用于本仓库自行维护的代码和素材。随安装包分发的官方 `@deepseek-ai/dsh` 及其他第三方依赖分别适用其自身许可证。本项目名称中的 “DeepSeek Harness” 仅用于说明兼容对象，不表示官方关系。
