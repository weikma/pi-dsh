# Pi-DSH 架构

Electron 与本地 Web 共用 React、回环 Host 及桥接。官方 Pi 独立运行。

## 运行时归属

公开 SDK 发现偏好与资源时不执行扩展。[扩展包管理](pi-desktop/extensions.zh.md)使用独立原生任务。Markdown／MCP 编辑保留版本检查、符号链接和其它字段。

`apps/pi-desktop/main.ts` 管理原生窗口、菜单、目录选择和后台运行，其隔离 preload 仅开放明确的原生操作。`server.ts` 提供 GUI 与 HTTP/SSE 接口，本地 Web 入口直接连接此 Host。`client/` 包含共享界面和类型化语言字典。

`bridge/` 为每个打开的会话启动官方 Pi RPC 进程，关联响应，将原生消息／工具投影为 GUI 状态，并等待进程关闭。Pi 管理执行、模型上下文、资源、压缩和会话。服务商管理由独立 Node worker 加载所选官方 Pi 包的公共 ModelRuntime SDK；登录／退出的写入由 Pi 认证存储管理。桥接层不实现 Agent 循环，也不伪造 DSH 事件。

`runtime/` 在 ASAR 外准备官方 Node／Pi／pnpm 及锁定的 Python／Office／搜索资源。首次使用将资源离线安装到不可变的 `runtimes/pi-<version>-<target>-<manifest-hash>` 目录。Desktop 在安装和 shell 环境读取期间打开 GUI；Pi／Office 请求等待就绪。外部选择优先，兼容 Pi 升级无需重建 Electron。验证过的版本与检查记录在 `bridge/version.json` 和[配置指南](pi-desktop/README.zh.md)。

独立加载的 `runtime/pi-auxiliary.ts` 使用 Pi 公共扩展 API 注册 `load_workspace_dependencies` 并发现 Office skill。它以 Pi 原生工具输出返回可执行文件和库路径，不注入 Host 提示，也不修改 Pi 的循环、认证或会话。GUI 导入桥接层管理的视图模型，不导入 Pi SDK 类。

自己的 `runtime/pi-session-controls.ts` 扩展通过公共命令上下文 `navigateTree` 和 `fork` 导航或从用户及 AI 节点分叉。Pi 执行原生会话写入。桥接层检查空闲状态和公开能力，再刷新完整节点及当前位置。编译后的扩展资源位于 ASAR 外，在所选官方 Pi 中加载，不修改 Pi。

运行时选择不会隐式回退到 PATH 中的 `pi`。显式外部配置保持独立于 Desktop 升级；`mode: bundled` 解析当前发行版默认运行时。GUI 外观变更不写入运行时选择。运行时隔离与凭据隔离不同：除非显式覆盖，Pi 默认 agent 目录仍然共用。

选择项目前，GUI 使用相同的实际 Pi agent 目录读取原生服务商／模型元数据：默认 `~/.pi/agent`，可由 `PI_CODING_AGENT_DIR` 或显式运行时 `agentDir` 覆盖。登录提示通过临时桥接交互传递，输入的密钥不进入 GUI 偏好或对话记录。自定义端点编辑保留 `models.json` 其他字段。服务商 SDK 代码与 worker 位于 ASAR 和 GUI 依赖之外。不支持的公共导出、运行时包装器和扩展服务商管理保留原生 CLI 配置入口。

`office-preview.ts` 使用随包 Python 读取 XLSX／CSV／TSV 工作表及 DOCX／PPTX 内容，供文件面板显示。电子表格预览保留值和公式，不计算公式；文档 HTML 经过清理，并显示在沙箱 frame 中。这些只读预览不渲染打印页面。对话数学使用保留的 Markdown／KaTeX 渲染链。

Host 根据真实的已注册项目根目录解析预览、下载及原生文件操作目标，拒绝越界符号链接并限制文件大小。浏览文件无需对话。`file-actions.ts` 将用户选择的编辑器保存为 GUI 偏好，不通过 shell 启动规范化文件。原生 IPC 仅接受可信主 frame 的明确操作，不接受 renderer 提供可执行文件。Web 提供文件下载。

`terminals.ts` 管理项目 PTY、有界屏幕及等待完成的进程树清理；客户端断开后 20 秒释放终端。`browser-guests.ts` 使沙箱 webview 与 Node、原生 IPC 及 GUI 源隔离。项目标签保留其内容；Web 使用沙箱 iframe。

## 保留的库与历史数据

六个源码库保留 React 基础组件、状态存储、停靠、品牌类型、语言映射和工作区路径。DSH／Cordis 运行时包已移除。

已提交的 DSH 会话夹具与持久化记录保留在原位置，作为历史证据，不参与当前程序。Pi 只恢复自己的原生会话文件，不迁移 DSH 会话。参见 [升级指南](upgrade-guide/v0.2.0-rc.2/pi-desktop/guide.zh.md)。

## 升级验证

兼容的 Pi 升级只改变外部运行时，不需重建 Electron。公共 RPC 或认证 SDK 变更可能需要桥接适配或回退原生配置。应验证所选可执行文件及公共导出、启动、关联、流式输出、工具、取消、会话恢复、支持的登录交互及受影响的 GUI 入口。参见[测试](testing.zh.md)。
