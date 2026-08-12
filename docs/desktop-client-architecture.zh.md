# 桌面客户端——基于 harness 核心的独立 Electron 应用

[English](desktop-client-architecture.md) | 中文

## 问题

`dsh` Web UI 是官方产品界面。桌面客户端被要求做成**独立的第三方产品**：自己的身份、自己的数据目录、自己的前端，与 web bundle 零耦合——同时仍然运行真实的 harness 会话。GUI 分层 RFC 预留了 Electron 席位（[GUI 分层与 RPC 协议](2026-07-19-gui-layering-and-rpc-protocol.md)："未来的 Electron 应用通过 IPC fetch 载体复用同一套 web client 包"），但产品分离的立场意味着客户端不得挂载 `web-app` bundle、其 client 插件 roster 或其"Web GUI"surface prompt。

## 决策

客户端（本仓库 `dsh-desktop`）是一个包含三层结构的独立 Electron 应用：

- **Harness 子进程**（`src/host/`）：一个普通 Node 进程（dev 用 tsx；打包应用内用捆绑的 Node 运行时），组合 harness 核心——`dsh-base` bundle 加桌面 overlay patch（`overlay/desktop.cordis.patch.yml`）——并以编程方式挂载桌面 glue 插件。它从不启动 `dsh` web profile，并以只读方式（`link:` 依赖）消费同级检出中的官方包，官方仓库永不被修改。Overlay 只添加客户端需要的 GUI 宿主平面：webserver（回环）、api-gateway、connection 节点半（`/api` 绑定与回环信任围栏）、workspace、storage/message-feedback、session-projection-cache 与自适应目录选择器。base 的 `hmr` 与 `telemetry-otel` 行被禁用：客户端没有需要热重载的模块系统，且默认不对外发送遥测。
- **桌面 glue**（`src/host/glue.ts`）：提供 `desktopStartup` 服务（调用方的 `--port`），在 `/app/` 前缀路由下服务客户端构建好的 renderer（与 `/api` 同源，因此信任围栏直接通过），提供 `/desktop/context` 路由（工作区路径与 git 分支，供 composer 的 Context Bar 使用），注册 `app:desktop-surface` prompt 段落（告知模型它身处桌面客户端而非 Web GUI），并打印主进程解析的就绪行（`dsh-desktop: <url>`）。
- **Electron 主进程**（`src/main/`）：spawn 并监管 harness 子进程（启动失败有重启预算，子进程存活期间退出则弹致命对话框），创建窗口（`hiddenInset` 标题栏、`contextIsolation` + `sandbox`、renderer 无 Node），安装标准角色菜单，持有单实例锁。preload 只暴露平台事实；OS 用户名经额外的 argv 参数传入，因为沙箱化 preload 无法导入 Node 内置模块。
- **Renderer**（`src/renderer/`）：一个独立 React 应用（Vite，`base: '/app/'`），实现客户端的视觉体系（黑白中性灰、`#F7F7F5` 320px 侧栏、白色主区、860px 26px 圆角浮动 Composer、31px 空状态标题、Lucide 1.5px stroke 图标、SF Pro / PingFang SC、120–180ms 动效）。它通过 `AbstractApiClient`（`@deepseek-ai/dsh-host-apiproxy/client`）加同源 WebSocket 载体消费共享的线缆契约——正是 RFC 预留的传输面子类——并把 mux 流折叠进自己的会话模型（`state/fold.ts`）。

客户端数据目录为 `~/.dsh-desktop`（可用 `DSH_DESKTOP_HOME` 覆盖）：settings、credentials、sessions 与 profiles 与 CLI 的 `~/.dsh` 完全分离。credentials seam 原样复用：设置面板通过 `credentials.set` 把 `DEEPSEEK_API_KEY` 写入客户端自己的托管文档。

## 后果

- `pnpm run dev` 构建并启动客户端；`pnpm run shot` / `pnpm run audit` / `pnpm run e2e` 驱动基于 Playwright 的验证（audit 通过计算样式断言视觉契约——侧栏宽度/颜色、composer 几何、字号阶梯、动效时长）。
- 客户端创建的会话运行 base agent 平面（全部 base 工具），而非 web profile 的 preset 受限平面；agent presets 未挂载。
- 客户端的模型可见身份是独立的：`app:desktop-surface` 写着"desktop client"，harness-source 段落仍为自我修改工具集指明 checkout 位置。
- 功能面与官方 Web UI 对齐：全内容搜索（`session.search`）、`/` 命令与技能菜单（`command.list` + `skill.list`）、后台任务面板（`session/tasks` 帧）、消息操作（fork 走 `session.fork`，反馈走 `messageFeedback/*` Remote，经 `api-remotes` 网关）、计划模式 chip（`plan` projection + `/plan`）、待发队列行（`session/queue` + `session.updateQueue`）、图片附件（prompt image parts）、Agent 预设清单（`agent-presets` 行引用官方预设，base agent 平面禁用列表与 web profile 完全一致）、权限预设选择器（宿主 `/permission` 命令）、目标 chip（`goal.*` 域）与设置面板（凭据、默认预设、`llm.models` 模型目录）。
- 推迟到后续迭代（每项都是已记录的席位而非缺口）：IPC fetch 载体（客户端当前走回环 HTTP + WebSocket）、系统托盘/通知、credentials seam 的 OS Keychain provider、语音输入、打包分发（electron-builder）与 trajectory/子代理树视图。

## 备选方案

| 否决 | 一句话理由 |
|---|---|
| 启动 `dsh` web profile 并从它提供客户端 UI | 客户端是独立产品：无 web-app bundle、无 web surface prompt、无共享数据目录 |
| 通过 SDK JSON-RPC 协议驱动运行时 | 协议没有 GUI 域（settings、credentials、审批、工作区管理、模型选择）——它是自动化协议 |
| 把 harness 跑在 Electron 主进程内 | Electron 的 Node 落后于引擎范围且 `node:sqlite` 最近才修复；原生模块（node-pty/koffi）需要按 Electron ABI 重编；普通 Node 子进程保持原样 |
| 在 renderer 挂载 web client 插件 roster | renderer 是带自己设计体系的独立应用；插件系统会拖入 web UI 的组合 |
| 新建 bundle 包 `dsh-desktop-app` | overlay patch + 编程挂载 glue 正是"assembly 写在 app 里"的形式；bundle 包没有额外消费者 |
