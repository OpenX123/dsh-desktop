# 桌面客户端——基于 dsh Web UI 公开接口的独立 Electron 应用

[English](desktop-client-architecture.md) | 中文

## 问题

`dsh` Web UI 是官方产品表面。桌面客户端需要保持为**独立第三方壳层**：拥有自己的产品身份与连接设置，同时运行真实 harness 会话。因此它只组合公开产品边界：需要本地运行时便通过 `dsh` CLI 启动 Web UI，主窗口直接加载 Web UI 源站，不导入任何 harness 内部包。

## 决策

客户端（本仓库 `dsh-desktop`）包含三层运行时结构：

- **Electron 主进程**（`src/main/`）：负责窗口和 Web UI 运行时。**本地模式**先探测默认回环实例，否则启动 `dsh web --port 0`；**连接模式**使用配置的 Web UI 源站。开发环境的命令依次从 `DSH_DESKTOP_DSH`、应用固定依赖中的 `@deepseek-ai/dsh`、同级检出与 PATH 解析。正式安装包必须携带完整的官方 CLI 运行时闭包；缺失时直接报告安装损坏，不会静默回退到 PATH。子进程监护包含有限重试、逐 generation 就绪状态、陈旧回调拦截与优雅退出（POSIX 为 SIGTERM→SIGKILL，Windows 为 `taskkill /T /F`）。打包后通过 Electron 的 Node 模式（`ELECTRON_RUN_AS_NODE`）运行内置 CLI。macOS 发布版在启动它之前会在受限时间内合并登录 shell PATH，供后续 Agent 子进程继承。
- **窗口表面**：Electron ready 后立即显示一个本地 Loading 文档，运行时就绪后由同一安全窗口直接加载 **官方 Web UI 本体**。会话标题、控件和所有产品交互因此都是官方行为。preload 只暴露小型连接桥，并可在官方设置弹窗里追加明确标注的连接卡片和 DeepSeek Key 帮助链接。仓库不维护或构建第二套产品 renderer。
- **设置接缝**：带随机私密路径的最小回环页面承载原生连接窗口，并把 `settings.json` 写入 `~/.dsh-desktop`。它不是 API carrier，不代理 `/api`、WebSocket 或 renderer 资源。

客户端自己的连接设置放在 `~/.dsh-desktop`（可用 `DSH_DESKTOP_HOME` 覆盖）；本地子进程使用**官方 `DSH_HOME`（`~/.dsh`）**——会话、标题、凭据、模型配置与 `dsh` CLI 和浏览器端官方 Web UI 共享。窗口使用官方 logo（macOS 模板 Dock 图标、Windows/Linux 窗口图标）与标准标题栏（官方 Web UI 自带 header）。凭据接缝按原样使用：`DEEPSEEK_API_KEY` 经官方界面的设置写入。

开发/诊断环境变量 `DSH_DESKTOP_DSH` 和 `DSH_DESKTOP_NODE` 可覆盖 CLI 与 Node 路径。`DSH_DESKTOP_SKIP_PROBE=1` 仅供自动化测试强制走内置本地运行时，不属于用户配置接口。

当前发布矩阵覆盖 macOS Universal 与 Windows x64。`dsh-runtime/package.json` 保留 Linux x64 原生可选包，供源码构建及未来恢复发布支持使用。新增发布架构或升级 dsh 时必须同步核对该清单并运行对应平台的安装包 smoke。

## 后果

- `pnpm run dev` 构建并启动客户端；`pnpm run shot` / `pnpm run audit` / `pnpm run e2e` 驱动 Playwright 验证。`pnpm run smoke:package` 在空 PATH 下启动打包应用，要求它明确选择内置 CLI 并通过 `host.describe` 探针。
- 客户端对本地 `dsh web` 与任何可达的 Web UI 实例表现一致（唯一耦合是 Web UI 源站），macOS / Windows / Linux 均支持；本地、探测和远程连接均呈现对应实例的原生官方界面。
- 会话运行 Web UI 自己的组合（官方 web profile）——内容搜索、`/` 命令与技能菜单、后台任务、消息操作（fork、反馈）、plan 模式、待处理队列、agent 预设、权限选择器、goal 芯片、模型目录，以及会话标题/重命名——因为界面本身就是官方 web 应用。
- 模型可见的身份由官方 web profile 自己的 surface prompt（"Web GUI"）设定；客户端不附加任何自己的部分。

## 备选方案

| 已否决 | 一句话原因 |
|---|---|
| 直接拼装大量细粒度 harness 包（旧架构） | 发布后的 `@deepseek-ai/dsh` CLI 已提供更稳定、完整的公开运行边界 |
| 维护第二套生产 renderer | 会重复实现官方产品表面，并持续与官方行为漂移 |
| 通过桌面 carrier 反代 `/api`、WebSocket 与资源 | 直接加载官方 Web UI 源站边界更小，也更忠实 |
| 自定义 renderer 直接跨源调用 `/api` | 当前没有生产自定义 renderer；官方页面只访问自己的源站 |
| 在 Electron 主进程内运行 harness | Electron 的 Node 落后于引擎范围，原生模块需要按 Electron ABI 重编 |
