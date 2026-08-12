# dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的独立桌面客户端：一个**独立 Electron 应用**，只消费官方 **dsh Web UI 的公开接口** —— 它的 CLI（`dsh web`）与 `/api` wire 协议。它不导入任何内部 harness 包；官方仓库既不是依赖，也永远不会被写入。

客户端的窗口直接加载**官方 Web UI 本体**——会话标题与重命名、按钮、一切交互都是官方产品的原生行为。客户端使用官方 DeepSeek Harness 图标（macOS Dock 模板图标、Windows/Linux 窗口图标）与标准标题栏。客户端自己的表面只剩一个小的连接设置窗口（菜单 →「Web UI 连接…」）。产品决策与进程模型见 [docs/desktop-client-architecture.zh.md](docs/desktop-client-architecture.zh.md)；本 README 讲目录布局、前置条件与命令。

## 运行时模型

客户端通过公开接口连接 **dsh Web UI**，两种模式可在设置中切换：

- **智能（默认，未填地址）**：客户端先探测本机默认端口（`http://127.0.0.1:3080`）上是否已有官方实例在运行，有则直接连接——窗口与浏览器共享**同一个 harness 进程**，对话与会话状态**实时同步**；探测不到时才自行拉起 `dsh web --port 0`（CLI 按以下顺序解析：`DSH_DESKTOP_DSH` → **应用内置的 `@deepseek-ai/dsh` npm 包**（官方发行版，声明在 `optionalDependencies`；包发布后，构建时一次 `pnpm install` 即随应用打包——终端用户永远不需要执行 npm 命令）→ PATH 上的 `dsh` → 开发用的同级检出）。注意：两个独立 harness 进程只共享磁盘上的 `~/.dsh` 数据，只有共用同一进程才会实时同步。
- **连接模式**：在设置中填写 Web UI 地址（本地或远程）。客户端只讲 `/api` wire 协议，不启动本地运行时。

**打包说明**：安装包随附应用的 `node_modules`（标准 Electron 打包），因此内置的 `dsh` 随应用一起分发。打包后的应用里，子进程用 Electron 自带的 Node 运行（`ELECTRON_RUN_AS_NODE`），满足 harness 引擎范围——系统无需安装 Node。开发期已验证的注意事项：Electron 的 run-as-node 模式的 ESM 解析器不跟随符号链接的 `node_modules`（pnpm workspace 布局），因此打包的依赖树必须是真实 npm 布局（electron-builder 的产物即是）；打包时需验证一次。

**托盘常驻**：关闭窗口后客户端不退出，转入系统托盘（macOS 菜单栏 / Windows 任务栏区域）。macOS 左键点击图标重新打开窗口；托盘菜单保持精简（「显示主窗口」「退出」）。仅通过托盘菜单、应用菜单或 Cmd+Q 退出。

**增强功能**：官方「通用设置」表单流末尾会追加一个「连接」区块（带「增强功能」徽标）——连接状态 + Web UI 地址，经主进程保存。注入是启发式且纯追加，样式与官方表单一脉相承；检测不到官方设置弹窗时区块自动缺席，官方功能不受影响。原生连接窗口仍可从应用菜单打开。

**数据**：本地模式下子进程使用**官方 `DSH_HOME`（`~/.dsh`，可用环境变量 `DSH_HOME` 覆盖）**——与 `dsh` CLI、浏览器端官方 Web UI 完全同一份数据，已有对话、标题、凭据与模型配置天然同步。客户端自己的连接设置放在自己的数据目录（`~/.dsh-desktop`，可用 `DSH_DESKTOP_HOME` 覆盖）。

## 环境要求

- Node `^22.19.0 || >=24.0.0`（本地模式时 `dsh` CLI 运行在系统 Node 上；捆绑运行时为打包后续事项）
- macOS / Windows / Linux 均支持（窗口标题栏、进程终止方式、主目录解析均按平台处理）
- 本地模式需要官方 `dsh` CLI（见上）；连接模式需要一个可达的 Web UI 实例

## 命令

```sh
pnpm install            # 仅首次（Electron 二进制下载）
pnpm run dev            # 构建 renderer + shell，然后启动 Electron
pnpm run build:renderer # 仅 renderer（vite）
pnpm run build:shell    # main + preload（esbuild）
pnpm run typecheck
pnpm run lint
pnpm run audit          # 设计契约审计（计算样式 + Playwright）
pnpm run shot           # 截图场景，输出到 shots/
pnpm run e2e            # 真实端到端冒烟（需要 API key，见下）
```

## 首次使用

1. 启动客户端（`pnpm run dev`）。默认自动启动本地 `dsh web` 并在窗口中打开官方 Web UI；若缺少 CLI 或想连远程实例，用应用菜单 →「Web UI 连接…」。
2. 从侧栏底部打开「设置」，粘贴 `DEEPSEEK_API_KEY` 并保存。密钥经 credentials seam 写入官方 Web UI 在 `DSH_HOME` 下管理的数据，不会进入桌面客户端的连接设置。
3. 在 composer 输入消息；没有活动会话时会自动新建。

## 脚本

- `scripts/shot.mjs` —— 对客户端窗口里的官方 Web UI 截图（空状态、设置、composer 草稿）。
- `scripts/audit.mjs` —— 界面启动冒烟：官方 UI 必须正常启动（boot manifest、侧栏、composer）且无页面错误。
- `scripts/e2e.mjs` —— 端到端冒烟：经官方 composer 发送真实 prompt，验证流式回复。

自定义 renderer（`src/renderer/`）保留在树中供参考，但不再构建、不再加载；`pnpm run build:renderer` 仍可单独产出。

## 后续工作

- **官方 npm 发布同步** —— 阻塞于官方 `@deepseek-ai/dsh` npm 包正式发布（目前尚未上 registry）。发布后：把 `optionalDependencies` 中的它提升为固定版本的正式依赖，新增 bump 脚本（查官方最新版本 → 更新 package.json → 重新构建 + 冒烟），发布流程定为「版本 bump + 重新打包」。这条管线就是官方 Web UI 更新到达终端用户的通道。
- 平台打包（electron-builder）、通知、OS Keychain provider、语音输入为后续工作。
