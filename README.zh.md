# dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的独立桌面客户端：一个**独立项目**，以只读方式消费同级目录中官方仓库的 harness 包，**不改动官方任何文件**。产品决策与进程模型见 [docs/desktop-client-architecture.zh.md](docs/desktop-client-architecture.zh.md)；本 README 讲目录布局、前置条件与命令。

该客户端是与官方 `dsh` Web UI 分离的产品：自己的组合（harness base bundle 加 `overlay/desktop.cordis.patch.yml`）、自己的 renderer、自己的模型可见身份，以及自己的数据目录（`~/.dsh-desktop`，可用 `DSH_DESKTOP_HOME` 覆盖）。它从不启动 `dsh` web profile，不挂载任何 web client 插件，官方仓库永远不会被写入。

## 目录布局

```
vscode-projects/
├── test-bruc3van/     # 官方 deepseek-harness 检出（只读，同级）
└── dsh-desktop/       # 本项目
```

`package.json` 通过 pnpm `link:` 依赖消费官方包，链接指向同级检出。官方仓库需先执行过一次 `pnpm install` 与 `pnpm run build:lib`（客户端运行时加载的是它的 `lib/` 产物）。

## 环境要求

- Node `^22.19.0 || >=24.0.0`（harness 子进程运行在系统 Node 上；捆绑运行时为打包后续事项）
- 官方检出为名为 `test-bruc3van` 的同级目录（或将 `DSH_HARNESS_REPO` 设为其绝对路径）
- macOS（当前开发目标；Windows/Linux 为后续事项）

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

Electron 主进程 spawn harness 子进程（dev 下为普通 Node + tsx），等待 `dsh-desktop: <url>` 就绪行，然后从 `/app/` 回环载体加载 renderer。

## 首次使用

1. 启动客户端（`pnpm run dev`）。
2. 从侧栏底部打开「设置」，粘贴 `DEEPSEEK_API_KEY` 并保存。密钥经 credentials seam 写入客户端自己托管的管理文档（`~/.dsh-desktop` 下），从不以明文进入配置文件。
3. 在 composer 输入消息；没有活动会话时会自动新建。

## 脚本

- `scripts/shot.mjs` —— 截图场景（空状态、设置、composer 草稿、模型菜单；配置了 key 时还包括真实对话）。
- `scripts/audit.mjs` —— 通过计算样式断言视觉契约（侧栏几何、调色板、composer 圆角、字号阶梯、动效时长）。
- `scripts/e2e.mjs` —— 端到端冒烟：经设置面板保存 key，发送真实 prompt，验证流式回复。

## 已知限制

macOS 优先：路径使用 `HOME`，窗口使用 `hiddenInset`，原生目录选择器依赖宿主桌面工具。harness 子进程继承环境；捆绑 Node 运行时与平台打包（electron-builder）为后续工作。已记录的后续席位（见架构文档）：以 IPC 载体取代回环 HTTP、系统托盘与通知、OS Keychain provider、队列编辑、附件、语音输入。
