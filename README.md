# DeepSeek Harness Desktop

中文 | [English](README_EN.md)

**把 DeepSeek Harness 当作桌面应用来使用：官方界面、已有会话和本地工作区，都在一个专注的窗口里。**

DeepSeek Harness Desktop 是一个独立的 `dsh` Electron 客户端。它会启动或连接官方 `dsh Web UI`，并直接呈现官方界面，让你无需一直保留浏览器标签页，也能完整使用 Harness。

> [!IMPORTANT]
> 项目目前仍是**开发者预览版**。推送版本 tag 后会自动构建未签名的跨平台安装包；也可以按照下方说明从源码运行。

![DeepSeek Harness Desktop 首页](docs/images/readme-home.png)

## 为什么值得使用？

- **原汁原味的 Harness 能力**：应用直接加载官方 Web UI。项目、会话、任务、模型、权限、目标、计划、技能与斜杠命令都沿用官方产品行为。
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

### 环境要求

- macOS、Windows 或 Linux；
- Node.js `^22.19.0 || >=24.0.0`；
- [pnpm](https://pnpm.io/zh/)；
- PATH 中可用的官方 `dsh` CLI，或者一个已经运行且可以访问的 `dsh Web UI`。

### 从源码运行

```sh
git clone https://github.com/bruc3van/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run dev
```

应用启动后，默认的**智能模式**会先检查 `http://127.0.0.1:3080`：

1. 如果这里已经运行官方 Web UI，桌面端直接复用它。此时浏览器和桌面端共享同一个 Harness 进程，会话状态可以实时同步。
2. 如果没有找到可用实例，桌面端会自行启动 `dsh web --port 0`。

如果找不到本地 CLI，或希望使用其他实例，请从应用菜单打开**「Web UI 连接…」**。

### 开始第一次对话

1. 点击侧栏底部的**「设置」**。
2. 填写并保存 `DEEPSEEK_API_KEY`。凭据由官方 Web UI 管理并写入 `DSH_HOME`，不会进入桌面端的连接设置。
3. 根据需要选择默认 Agent 预设或模型。
4. 若任务需要读写文件，先添加一个项目文件夹；也可以直接新建会话。
5. 描述希望 Agent 完成的结果，然后发送消息。

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

## 桌面端行为

- 关闭主窗口后，应用继续驻留在系统托盘或 macOS 菜单栏。
- 点击托盘图标可以重新打开主窗口。
- 可通过托盘菜单、应用菜单或 macOS 的 `Cmd+Q` 完全退出。
- 本地 Web UI 意外退出时，客户端只会进行有限次数的重启，不会无限循环。

## 开发与验证

```sh
pnpm run build          # 构建 Electron 主进程与 preload
pnpm run dist           # 为当前平台生成安装包
pnpm run typecheck      # TypeScript 类型检查
pnpm run lint           # 检查源码与脚本
pnpm run audit          # 启动与浏览器界面冒烟验证
pnpm run shot           # 更新 shots/ 中的截图
pnpm run e2e            # 发送真实请求并验证流式回复
```

`pnpm run e2e` 需要有效的 API Key。仓库中的 `src/renderer/` 仅作为历史参考保留；生产窗口直接加载官方 Web UI，不会构建或使用这套 renderer。

进程模型、信任边界和设计取舍详见[桌面客户端架构](docs/desktop-client-architecture.zh.md)。

## 版本发布

发布版本前，先将 `package.json` 中的版本号更新为目标版本并提交，然后推送同版本 tag：

```sh
git tag v0.0.1-rc.1
git push origin v0.0.1-rc.1
```

GitHub Actions 会校验 tag 与 `package.json` 版本一致，并分别构建：

- macOS 通用版：DMG 与 ZIP；
- Windows x64：NSIS 安装程序与免安装 ZIP；
- Linux x64：AppImage 与 DEB。

全部平台构建成功后，工作流会生成 SHA-256 校验文件，并创建或更新对应的 GitHub Release。包含 `-rc`、`-beta` 等预发布标识的 tag 会自动标记为预发布版本。

## 当前状态

桌面外壳、智能/连接模式、共享 `DSH_HOME`、托盘常驻、运行时监护、跨平台打包和 tag 自动发布流程均已实现。当前自动产物尚未进行代码签名；面向普通用户正式发布前，仍需配置 macOS/Windows 签名，并完成与官方 `@deepseek-ai/dsh` 发布包的最终集成。系统通知、OS Keychain 与语音输入也属于后续工作。

欢迎提交贡献与问题反馈，尤其是 Windows/Linux 使用、远程连接和打包方面的反馈。

## 许可证

[MIT](LICENSE)
