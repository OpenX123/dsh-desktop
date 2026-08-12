# 桌面客户端——基于 dsh Web UI 公开接口的独立 Electron 应用

[English](desktop-client-architecture.md) | 中文

## 问题

`dsh` Web UI 是官方产品表面。桌面客户端需要保持为**独立第三方壳层**：拥有自己的产品身份与连接设置，同时运行真实 harness 会话。因此它只组合公开产品边界：需要本地运行时便通过 `dsh` CLI 启动 Web UI，主窗口直接加载 Web UI 源站，不导入任何 harness 内部包。

## 决策

客户端（本仓库 `dsh-desktop`）包含三层运行时结构：

- **Electron 主进程**（`src/main/`）：负责窗口和 Web UI 运行时。**本地模式**先探测默认回环实例，否则启动 `dsh web --port 0`；**连接模式**使用配置的 Web UI 源站。命令依次从 `DSH_DESKTOP_DSH`、可选的应用内置 `@deepseek-ai/dsh`、开发用同级检出与 PATH 解析。子进程监护包含有限重试、逐 generation 就绪状态、陈旧回调拦截与优雅退出（POSIX 为 SIGTERM→SIGKILL，Windows 为 `taskkill /T /F`）。打包后通过 Electron 的 Node 模式（`ELECTRON_RUN_AS_NODE`）运行内置 CLI。
- **窗口表面**：主窗口直接加载 **官方 Web UI 本体**。会话标题、控件和所有产品交互因此都是官方行为。preload 只暴露小型连接桥，并可在官方设置弹窗里追加一个明确标注的连接卡片。保留的 `src/renderer/` React 实现仅是归档参考；默认构建和发布窗口都不会构建或加载它。
- **设置接缝**：带随机私密路径的最小回环页面承载原生连接窗口，并把 `settings.json` 写入 `~/.dsh-desktop`。它不是 API carrier，不代理 `/api`、WebSocket 或 renderer 资源。

客户端自己的连接设置放在 `~/.dsh-desktop`（可用 `DSH_DESKTOP_HOME` 覆盖）；本地子进程使用**官方 `DSH_HOME`（`~/.dsh`）**——会话、标题、凭据、模型配置与 `dsh` CLI 和浏览器端官方 Web UI 共享。窗口使用官方 logo（macOS 模板 Dock 图标、Windows/Linux 窗口图标）与标准标题栏（官方 Web UI 自带 header）。凭据接缝按原样使用：`DEEPSEEK_API_KEY` 经官方界面的设置写入。

## 后果

- `pnpm run dev` 构建并启动客户端；`pnpm run shot` / `pnpm run audit` / `pnpm run e2e` 驱动 Playwright 验证。
- 客户端对本地 `dsh web` 与任何可达的 Web UI 实例表现一致（唯一耦合是 Web UI 源站），macOS / Windows / Linux 均支持。
- 会话运行 Web UI 自己的组合（官方 web profile）——内容搜索、`/` 命令与技能菜单、后台任务、消息操作（fork、反馈）、plan 模式、待处理队列、agent 预设、权限选择器、goal 芯片、模型目录，以及会话标题/重命名——因为界面本身就是官方 web 应用。
- 模型可见的身份由官方 web profile 自己的 surface prompt（"Web GUI"）设定；客户端不附加任何自己的部分。

## 备选方案

| 已否决 | 一句话原因 |
|---|---|
| 用官方包组合 harness core（旧架构） | 这些包是内部未发布的——正式发布时不存在 |
| 维护第二套生产 renderer | 会重复实现官方产品表面，并持续与官方行为漂移 |
| 通过桌面 carrier 反代 `/api`、WebSocket 与资源 | 直接加载官方 Web UI 源站边界更小，也更忠实 |
| 自定义 renderer 直接跨源调用 `/api` | 当前没有生产自定义 renderer；官方页面只访问自己的源站 |
| 在 Electron 主进程内运行 harness | Electron 的 Node 落后于引擎范围，原生模块需要按 Electron ABI 重编 |
