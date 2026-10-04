# Pi DSH 测试

`pnpm typecheck` 检查 Host 与 Client。`pnpm test` 运行 `apps/pi-dsh/tests` 中的本地测试。

桥接测试覆盖 JSONL 响应关联、Unicode 分帧、流式呈现、交互扩展请求与等待子进程关闭。Pi 流程测试将选定的官方 CLI 连接到本地脚本模型，并检查真实文件与 Shell 效果、流式输出、取消和原生会话恢复。每个测试独立管理临时工作区、运行时目录与端口。

`pnpm test:ui` 覆盖[首次使用](../apps/pi-dsh/tests/first-run.client.spec.tsx)、[对话](../apps/pi-dsh/tests/conversation.client.spec.tsx)、[外观](../apps/pi-dsh/tests/appearance.client.spec.tsx)，以及保留的代码／读取／差异／流式渲染和 [Tooltip](../packages/client/ui-primitives/tests/tooltip.client.spec.tsx) 行为。检查包括键盘／输入法、启动竞态、服务商管理、草稿、文件、编辑器操作及运行时隔离。命令检查覆盖原生路由、补全、剪贴板及单次提交。Tooltip 检查覆盖视口边界、滚动、Escape 及悬停／焦点。API 夹具验证 React 行为，不能证明原生点击命中或真实服务商访问。

[隔离首次使用 Pi 测试](../apps/pi-dsh/tests/pi-first-run.test.ts)验证新配置发现、原生标识、重连失败及重试，不调用外部服务。[启动测试](../apps/pi-dsh/tests/startup.test.ts)在环境屏障未释放时提供 GUI 和文件，再打开真实 Pi；退出等待屏障结束，准备错误仍会显示。

[服务商解析测试](../apps/pi-dsh/tests/provider-runtime.test.ts)检查所选包的公共导出、独立 Node，以及拒绝包装器／私有 SDK 回退。[worker 测试](../apps/pi-dsh/tests/provider-worker.test.ts)验证实际 Pi ModelRuntime 的 API 密钥存储、退出登录、取消、配置保留和 EOF 后等待退出。脚本化 OAuth 回调检查提示及回调服务器清理，不完成第三方认证。[Host 测试](../apps/pi-dsh/tests/providers-host.test.ts)验证无需项目读取目录、安全 HTTP/SSE 登录状态，以及更换运行时的 worker 关闭。

`pnpm test:compat` 检查所选可执行文件的公共 RPC。Pi 流程验证公共历史分叉和中间工具调用节点导航，不增加模型请求。[运行时隔离测试](../apps/pi-dsh/tests/runtime-isolation.test.ts)拒绝隐式 PATH 选择。外部服务商与 OAuth 验收需要获授权凭据；不要记录密钥。

[配置测试](../apps/pi-dsh/tests/agent-configuration.test.ts) 覆盖原生 SDK 保存、资源编辑和 MCP 连接；Host 测试验证资源／请求使用独立 ID。

`pnpm build` 构建共享浏览器 GUI 和 Electron 入口。`pnpm dev:web`、`pnpm dev:desktop` 分别使用浏览器和原生窗口验证共享 Host。可见变更应通过此真实 Host 与 Pi 流程验证，包含模型和工具输出、流式恢复、对话框、主题及平台窗口。macOS 验证不能证明 Windows/Linux 运行或打包成功；CI 负责这些平台检查。

声明安装包通过首次使用验收前，应使用全新的 GUI 主目录和 Pi 配置，不继承服务商凭据，也不注册项目。使用真实鼠标与键盘操作已安装的原生窗口，包括空输入区／模型配置、侧栏折叠和展开、全屏、顶部菜单及最小窗口尺寸。源码几何检查覆盖 macOS／Windows 标题栏规则和拖动区域重收集，不能确认 Windows 实机执行。

`pnpm runtime:prepare` 准备本机资源；`pnpm test:runtime` 检查可执行文件、Python 库和 Office 生成。缺失资源明确跳过依赖检查。原生 afterPack 对真实 Resources 运行五项服务商、辅助工具、引擎、历史及恢复检查，不执行其他平台二进制。离线测试覆盖迁移、并发发布、独立选择和旧版本保留。Office 检查使用随包 Python 与真实文件；浏览器证据覆盖标签、沙箱文档及流式结束后的 KaTeX 渲染。

`pnpm test:docs` 验证活跃文档和链接，不修改冻结记录。明确报告已执行检查及未验证的平台／服务商路径。

GUI 回归还验证项目分组、折叠持久化、行内搜索、置顶／归档／恢复，以及新建对话立即进入草稿且首次发送前不启动 Pi。Host 测试验证仅移除导航的项目操作、偏好写入失败的原子性、共享会话发现及项目相对会话目录。

[扩展验证](pi-dsh/extensions.zh.md#verification)涵盖包生命周期、进程树取消和可选的社区发布包检查。

[终端测试](../apps/pi-dsh/tests/terminals.test.ts) 覆盖真实 PTY 输入、尺寸调整、恢复、中断及清理。[Host 检查](../apps/pi-dsh/tests/terminal-host.test.ts) 验证源限制和退出。打包验收检查终端 helper、浏览器导航、快捷键及标签状态保留。

[本地文件测试](../apps/pi-dsh/tests/local-files.client.spec.tsx)覆盖导航、创建、过期响应和应用菜单。[Host 检查](../apps/pi-dsh/tests/local-files-host.test.ts)验证来源／项目边界；[启动进程检查](../apps/pi-dsh/tests/local-applications.test.ts)覆盖字面参数和取消。
