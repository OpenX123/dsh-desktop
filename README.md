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
- **更少的启动步骤**：智能模式会优先复用电脑上已经运行的官方 Web UI；没有可用实例时，再替你启动 `dsh web`。
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

当前自动构建的安装包尚未进行 macOS/Windows 代码签名。操作系统可能在首次启动时显示安全警告；在签名与公证配置完成前，这仍是“直接下载即可运行”的已知发布限制。请只从本仓库 Release 下载，并使用随附的 `SHA256SUMS.txt` 校验文件。

#### 首次打开被系统拦截时

- **macOS**：当前安装包尚未使用 Apple Developer ID 签名和公证。只从本仓库 Release 下载 DMG，并先在「终端」核对 SHA-256：

  ```sh
  cd ~/Downloads
  shasum -a 256 dsh-desktop-*.dmg
  ```

  将输出与同一 Release 中 `SHA256SUMS.txt` 对应文件的值比较。确认一致后，把应用拖入「应用程序」，双击一次，然后打开「系统设置 → 隐私与安全性」，在「安全性」区域点击「仍要打开」并输入登录密码。该按钮只会在尝试打开后的一段时间内出现。详见 [Apple 官方说明](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)。

  如果仍显示“已损坏，无法打开”且没有「仍要打开」，仅在 SHA-256 已确认一致时执行：

  ```sh
  xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness Desktop.app"
  open "/Applications/DeepSeek Harness Desktop.app"
  ```

  该命令只移除此应用的下载隔离标记，不会全局关闭 Gatekeeper，不需要 `sudo`。如果校验值不一致，请删除文件并重新下载，不要执行上述命令。
- **Windows**：如果 Microsoft Defender SmartScreen 显示保护提示，请先核对下载来源和 SHA-256，确认后选择「更多信息 → 仍要运行」。

### 从源码运行

源码开发需要 Node.js `^22.19.0 || >=24.0.0` 和 [pnpm](https://pnpm.io/zh/)；不需要另外安装 `dsh`。

```sh
git clone https://github.com/bruc3van/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run dev
```

应用启动后，默认的**智能模式**会先检查 `http://127.0.0.1:3080`：

1. 如果这里已经运行官方 Web UI，桌面端直接复用它。此时浏览器和桌面端共享同一个 Harness 进程，会话状态可以实时同步。
2. 如果没有找到可用实例，桌面端会使用安装包或项目依赖中固定的官方运行时启动 `dsh web --port 0`。

如果内置运行时无法启动，或希望使用其他实例，请从应用菜单打开**「Web UI 连接…」**。

### 开始第一次对话

1. 首次启动时，在「添加一个 API Key 开始使用」引导中填写密钥；也可以选择「稍后配置」，之后从「设置 → 模型 → DeepSeek」完成。
2. 还没有 Key 时，点击输入框下方的「前往 DeepSeek 开放平台创建」，系统浏览器会打开 <https://platform.deepseek.com/api_keys>。该链接是本项目的桌面增强；API 账户、余额与费用由 DeepSeek 开放平台管理。
3. 根据需要选择默认 Agent 预设或模型。
4. 若任务需要读写文件，先添加一个项目文件夹；也可以直接新建会话。
5. 描述希望 Agent 完成的结果，然后发送消息。

> [!TIP]
> 全新数据目录下，官方 Web UI 可能默认显示英文。可从 **Settings → General → Language** 切换为中文。

## 两种连接方式

| 模式 | 适合场景 | 实际行为 |
|---|---|---|
| **智能模式**（默认） | 大多数本机用户 | 优先复用 `127.0.0.1:3080` 上的官方实例；没有实例时启动本地 `dsh web`。 |
| **连接模式** | 远程机器、容器或自行维护的运行时 | 直接连接你填写的 Web UI 地址，不启动本地运行时。 |

清空 Web UI 地址即可恢复智能模式。你可以通过通用设置里的「连接」增强区块，或应用菜单的「Web UI 连接…」修改连接。

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
- 可通过托盘菜单、应用菜单或 macOS 的 `Cmd+Q` 完全退出。
- 本地 Web UI 意外退出时，客户端只会进行有限次数的重启，不会无限循环。
- 系统唤醒或长时间后台运行后若页面异常空白，客户端会在确认 Web UI 可达后自动重新加载。
- macOS 发布版会在启动本地服务前读取一次用户的登录 shell `PATH`（最长等待 3 秒），只合并绝对路径目录，使 Agent 从 Finder/Dock 启动时仍能找到 Homebrew 和版本管理器中的工具。

## 开发与验证

```sh
pnpm run build          # 构建 Electron 主进程与 preload
pnpm run prepare:runtime # 准备内置 dsh 运行时闭包
pnpm run check:picker   # 验证内置 Win32 目录选择器兼容补丁
pnpm run dist           # 为当前平台生成安装包
pnpm run typecheck      # TypeScript 类型检查
pnpm run lint           # 检查源码与脚本
pnpm run audit          # 启动与浏览器界面冒烟验证
pnpm run smoke:package  # 验证打包应用确实使用内置 dsh 运行时
pnpm run shot           # 更新 shots/ 中的截图
pnpm run shot:readme    # 更新 README 使用的隐私安全截图
pnpm run e2e            # 发送真实请求并验证流式回复
```

`pnpm run e2e` 需要有效的 API Key。生产窗口直接加载官方 Web UI；仓库不维护第二套产品 renderer。

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

全部平台构建成功后，工作流会生成 SHA-256 校验文件，并创建或更新对应的 GitHub Release。包含 `-rc`、`-beta` 等预发布标识的 tag 会自动标记为预发布版本。

## 当前状态

桌面外壳、智能/连接模式、共享 `DSH_HOME`、托盘常驻、运行时监护、内置官方 `@deepseek-ai/dsh`、macOS/Windows 打包和 tag 自动发布流程均已实现。发布流水线会在空 PATH 下启动打包应用并探测 Web UI，阻止遗漏内置运行时的产物发布。当前自动产物尚未进行代码签名；macOS/Windows 签名与公证仍是面向普通用户无警告安装的发布前置条件。系统通知、OS Keychain 与语音输入也属于后续工作。

欢迎提交贡献与问题反馈，尤其是 Windows 使用、远程连接和打包方面的反馈。

## 许可证

[MIT](LICENSE)

MIT 许可证仅适用于本仓库自行维护的代码和素材。随安装包分发的官方 `@deepseek-ai/dsh` 及其他第三方依赖分别适用其自身许可证。本项目名称中的 “DeepSeek Harness” 仅用于说明兼容对象，不表示官方关系。
