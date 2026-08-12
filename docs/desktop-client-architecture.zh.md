# 桌面客户端——基于 dsh Web UI 公开接口的独立 Electron 应用

[English](desktop-client-architecture.md) | 中文

## 问题

`dsh` Web UI 是官方产品表面。桌面客户端被要求作为**独立第三方产品**：自己的身份、自己的数据目录、自己的前端，不依赖 web bundle——同时仍然运行真实 harness 会话。harness 包是官方仓库内部包、不对外发布，因此客户端不能依赖它们：正式发布时唯一存在的是 Web UI 的**公开接口**——`dsh` CLI 与其提供的 `/api` wire 协议。

## 决策

客户端（本仓库 `dsh-desktop`）是一个三层结构的独立 Electron 应用：

- **Electron 主进程**（`src/main/`）：负责窗口、本地回环 **carrier** 服务器与 Web UI 运行时。**本地模式**下拉起官方 `dsh web --port 0`——按 `DSH_DESKTOP_DSH` → **应用内置的 `@deepseek-ai/dsh` npm 包**（声明在 `optionalDependencies`，随安装包分发，用户无需执行 npm）→ PATH → 开发用的同级检出依次解析，解析就绪行（`dsh web: <url>`）；**连接模式**下指向用户配置的 Web UI 地址。carrier 在 `/app/` 下托管客户端构建产物，把 `/api` 反向代理到 Web UI（HTTP POST 与 WebSocket upgrade，剥离浏览器标记，使 Web UI 的回环信任围栏看到的是普通客户端），并承载客户端自己的 `/desktop/*` 路由（工作区上下文、连接状态、连接设置）。子进程监护沿用旧设计：启动失败有重启预算、运行中退出弹致命对话框、退出时优雅停止（POSIX 为 SIGTERM→SIGKILL，Windows 上信号不可捕获，改用 `taskkill /T /F`）。打包后的应用里，子进程用 Electron 自带的 Node 运行（`ELECTRON_RUN_AS_NODE`），系统无需安装 Node。
- **窗口表面**：客户端窗口直接加载 **官方 Web UI 本体**（Web UI 源站）。会话标题与重命名、按钮、一切交互都是官方产品的原生行为——客户端从不重新实现界面。客户端自己的表面只有一个小的连接设置窗口（菜单 →「Web UI 连接…」），由最小回环服务器承载（`/desktop/status`、`/desktop/settings` 与一个自包含设置页），用于选择本地/连接模式与 Web UI 地址。（本项目早期版本曾自带自定义 React renderer——`src/renderer/`，含自包含 wire 客户端与 vendor 协议 schema（`src/renderer/api/contract/`）——保留在树中供参考，不再构建、不再加载。）
- **设置接缝**：客户端数据目录（`~/.dsh-desktop`）里的 `settings.json` 选择模式与 Web UI 地址；设置面板与启动失败页都通过 `/desktop/settings` 修改它。

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
| 启动 `dsh` web profile 并从中托管客户端 UI | 客户端是独立产品：自己的 renderer、自己的数据目录、不依赖 web-app bundle |
| renderer 直接跨源调用 `/api` | Web UI 信任围栏拒绝跨站浏览器标记；回环 carrier 以普通客户端身份代理 |
| IPC fetch carrier | 留作后续席位；回环 HTTP/WS carrier 让 renderer 传输代码保持不变 |
| 在 Electron 主进程内运行 harness | Electron 的 Node 落后于引擎范围，原生模块需要按 Electron ABI 重编 |