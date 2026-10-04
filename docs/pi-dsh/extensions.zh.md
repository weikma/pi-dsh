---
description: "管理 Pi 原生扩展包、默认社区组合和桌面兼容性。"
---

# Pi 扩展与技能

[English](extensions.md) | 中文

## 概述

从侧栏打开 **扩展**，或进入 **设置 → 扩展**，发现和管理 Pi 扩展包。Pi 负责安装、配置、执行和升级；桌面与本地 Web 展示相同的包资源。

## 目录

- [扩展与技能市场](#marketplace)
- [默认组合](#defaults)
- [安装和管理](#manage)
- [重载与恢复](#recovery)
- [兼容性与架构](#compatibility)
- [验证](#verification)

<a id="marketplace"></a>
## 扩展与技能市场

侧栏底部提供 **扩展** 和 **设置**。从 **设置 → 技能** 打开技能工作区；项目标题旁的 **+** 用于添加项目。扩展页保留精选组合，并提供 **市场** 与 **已安装**；技能页默认打开技能市场。市场读取 [Pi 官方包目录](https://pi.dev/packages)的类型、作者和月下载量，支持提交搜索、排序及分页。已安装页保留本地资源管理，市场不可用时仍可查看和管理这些资源。

包详情读取 npm 当前发布清单，展示安装范围、确切版本、许可证、声明的 Pi 版本要求和资源路径。市场标签可能不完整；缺少显式清单时，Pi 会在安装后扫描标准资源目录。安装固定到详情中显示的版本。Pi 按整个包安装与卸载，包括混合包中的扩展、技能、提示词及主题；单项资源通过原生过滤器启停。技能名称遵循 SKILL.md 的 name 字段，包内文件保持只读，本地技能仍可创建和编辑。

`/skill:名称` 的原生展开内容在对话中可折叠查看，请求正文保持可见。自动发现的对话标题使用请求正文或技能命令；原始消息和复制文本不变，用户主动设置的标题优先。

<a id="defaults"></a>
## 默认组合

[目录](../../apps/pi-dsh/bridge/extension-catalog.ts)记录了 2026 年 10 月 3 日检查的确切版本。筛选依据是 [Pi 官方扩展目录](https://pi.dev/packages)、维护者文档和实际 RPC 验证，不只依据下载量。**安装默认组合** 在选定的用户或项目范围内安装缺少的成员，保留已有版本及资源过滤规则。打开页面不会安装任何内容。社区扩展由 Pi 单独下载，与离线桌面运行时分开。

默认组合会保留已启用的 `pi-web-search`，避免再添加一个搜索默认项。这是推荐策略，不是兼容性限制：单独安装和资源开关遵循 Pi 的原生行为。不能仅凭包名判断实际注册的工具。`pi-web-access` 支持在自己的 `web-search.json` 中设置原生 `toolNames.webSearch`（如 `web_access_search`），或 `tools.webSearch.enabled: false`；桌面保留这些设置，不会自动改写。因此两个包可以共存，参见[扩展配置文档](https://github.com/nicobailon/pi-web-access#configuration)。

| 扩展包 | 版本 | 桌面行为 |
|---|---|---|
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | 0.74.0 | 原生子代理通过工具输出返回结果，终端仪表盘仍在 Pi 中使用。 |
| [pi-web-access](https://github.com/nicobailon/pi-web-access) | 0.35.0 | 搜索和读取工具在对话中展示，外部服务遵循扩展自身配置。 |
| [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) | 2.12.0 | 扩展的 RPC 回退使用原生选择框和输入框。 |
| [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) | 2.12.0 | 展示待办工具结果和 `/todos`；自定义终端浮层不可用。 |

目录还提供 Plannotator、pi-mcp-adapter、pi-lens、pi-interactive-shell、billion-context 和 Langfuse。这些扩展可按需选择：Pi 已提供 MCP，终端组件需要 TUI，而格式化、替代压缩流程或上传追踪会改变重要行为。进入目录不代表每个功能和版本都已验证兼容。

<a id="manage"></a>
## 安装和管理

选择范围后安装精选包，或点击 **添加扩展**。来源支持 `npm:名称@版本`、不含凭据的 HTTPS Git 仓库和本地绝对路径。项目安装需要 Pi 项目信任。扩展具有 Pi 进程的访问能力，包管理器可能执行安装脚本；安装使用选定的原生包管理器，需要其通常所需的网络连接和凭据。

**已安装 → 管理** 展示版本、来源和发现的资源。单项开关保存 Pi 原生包过滤规则，保留其它资源类型和模式。**更新** 在所选范围内遵循原生规则：确切版本和 Git 引用保持固定。要选择其它版本，请添加明确的新来源。**移除** 经过确认后调用 Pi 卸载，本地源码目录保留。操作失败会保留表单并显示错误。

更改在新对话中生效，也可在执行、排队输入和对话框结束后 **重新加载当前对话**。扩展包更改需要先结束当前任务、排队输入和对话框；操作期间无法启动或重新加载 Pi。新社区扩展使用相同的来源和资源管理能力，无需专门向桌面注册。不支持的管理 SDK 保留 **打开 Pi 终端** 或 **复制 Pi 启动命令**。

<a id="recovery"></a>
## 重载与恢复

**重新加载当前对话** 和 `/reload` 在当前进程中调用 Pi 公开的扩展命令上下文 `reload()`，保留会话身份和历史，并要求执行、排队输入和对话框先结束。Pi 0.99.1/0.99.2 在资源重载时保留扩展：同名工具由先注册者生效，后续扩展中不重名的工具仍可使用。桌面遵循这个原生顺序，不按安装时间另造优先级。提供商认证／模型目录刷新仍使用新进程。

冷启动会执行 Pi 对扩展诊断错误的致命检查。失败后可以选择 **以恢复模式继续**，明确为当前进程使用 `--no-extensions`。自动发现和内置扩展关闭，显式 `-e` 选择（含桌面控制扩展）仍作为 Pi 原生输入。基础编程工具可用，但依赖扩展的模型提供商可能仍无法请求。不会改写扩展配置或凭据，也不会自动发送草稿；Pi 恢复同一个会话文件。恢复模式是临时选择，不写入 CLI 配置，也不延续到重新启动的应用中。

修好配置后，**恢复正常扩展加载** 会重新打开原生会话。如果这次尝试失败，桌面会恢复之前已选用的恢复模式并显示错误。RPC 扩展事件处理错误保持可见，不会停止健康进程。Pi RPC 不提供重载后的完整资源加载诊断列表，相关详情需查看原生 Pi 诊断。扩展中的 `process.exit()`、损坏的显式扩展及任意副作用，无法在 Pi 共享的扩展进程内隔离。

<a id="compatibility"></a>
## 兼容性与架构

React 使用桥接层拥有的包记录，以及通用的原生工具、命令、对话框、通知和文本组件。React 不导入扩展 JavaScript、Pi SDK 类或终端渲染器。未知工具保留安全的通用展示方式。Pi 负责命令发现与调用，因此使用标准 RPC 行为的新扩展不需要 GUI 命令适配器。

独立配置进程读取清单，并调用公开的 `SettingsManager`、`DefaultPackageManager` 和 `ProjectTrustStore`。发现资源时不会导入扩展或安装缺失包。Host 串行执行修改操作。包任务在单独的选定 Node 进程中运行，通过专用管道返回结果，npm/Git 输出不会破坏认证或对话 JSONL。关闭 Host 时先取消并等待包进程树退出，再等待管理请求。工作进程文件位于 ASAR 外部。

[marketplace.ts](../../apps/pi-dsh/marketplace.ts) 只从 Pi 公共目录页面和 npm 清单读取元数据，不接收凭据或执行包代码。页面有五分钟的内存缓存，响应大小、重定向源和请求期限均有限制；关闭 Host 会取消并等待请求结束。公共页面格式变化时显示错误和官方市场链接，不会阻止 Pi 对话。市场收录与声明的版本范围不代表每个包都已通过当前 Pi 的兼容性验证。

Pi 0.99.1 RPC 支持 `select`、`confirm`、`input`、`editor`、通知和文本状态／组件输出。`ctx.ui.custom()` 返回 `undefined`，任意 TUI 组件及自定义工具渲染器无法自动转换为网页界面。带浏览器界面的包可打开自己的本地页面，其它仅限终端的流程使用原生 Pi。桌面不会为任意扩展自有配置文件假设统一结构。参阅 [Pi RPC UI 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)。

<a id="verification"></a>
## 验证

[配置测试](../../apps/pi-dsh/tests/agent-configuration.test.ts)覆盖原生安装、发现、过滤、更新、移除和数据保留。[包进程测试](../../apps/pi-dsh/tests/package-operation.test.ts)检查包管理器杂乱输出，以及忽略 SIGTERM 的后代进程的取消。[打包工作进程检查](../../apps/pi-dsh/tests/packaged-provider.test.ts)要求使用真实 Resources 中的工作进程。

在独立目录安装确切的默认版本后，将 `PI_DSH_TEST_EXTENSION_ROOT` 指向其 `node_modules`，运行 `node --import tsx --test apps/pi-dsh/tests/community-extensions.test.ts`。该检查通过实际 Pi、发布的扩展包及本地脚本服务商验证待办、RPC 问卷、真实前台子会话和私有网页目标拒绝，无需服务商凭据。缺少目录时明确跳过。macOS 浏览器验收还通过实际网页扩展读取了公开页面。这不代表所有社区功能、TUI 等价性、第三方登录或 Windows/Linux 实机运行均已验证。

`node --import tsx --test apps/pi-dsh/tests/marketplace.test.ts apps/pi-dsh/tests/agent-configuration.test.ts apps/pi-dsh/tests/records.test.ts` 检查目录解析、混合资源清单、缓存、请求终止、原生技能过滤和消息投影。macOS 浏览器验收在隔离配置中通过界面安装 `pi-tandem@0.6.4`，查看和启停其七个技能，再以 `/skill:writing` 调用实际 Pi 0.99.1，通过本地脚本服务商完成文件与 shell 工具操作。会话标题投影保留原生 JSONL 内容。这不证明该包所有扩展功能或其它 Pi 版本的兼容性。

## 开发备注

将 `PI_DSH_TEST_SEARCH_EXTENSION` 指向 `pi-web-search@1.5.0`，并让上述扩展目录包含 `pi-web-access@0.35.0` 后，运行 `node --import tsx --test apps/pi-dsh/tests/extension-parity.test.ts`。可用 `PI_DSH_TEST_PI_CLI` 明确指定官方 CLI 入口。macOS 实测中，Pi 0.99.1/0.99.2 的冷启动拒绝重复 `web_search`，但原生重载后可以用第一个搜索工具和后一个包的 `fetch_content` 正常完成对话。配置不同工具名后的冷启动 CLI/RPC 对话也通过检查。这些结果不代表完整的 0.99.2 SDK 兼容性。

运行 `node --import tsx --test apps/pi-dsh/tests/resource-recovery.test.ts`，验证原生重名工具执行、重载期间对话框／命令互斥、历史保留、Host 错误分类、显式恢复、真实文件写入及恢复正常加载失败后的回退。原生 afterPack 使用 Resources 中编译后的扩展运行该检查。
