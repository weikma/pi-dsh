# Pi 公共 RPC 桥接

[English](README.md) | 中文

桥接层将独立安装、未经修改的官方 Pi Coding Agent 接入 Electron 与本地 Web。[version.json](version.json)单独记录桥接版本及已测试 Pi 发布版本。对话执行使用公共 CLI RPC；服务商配置使用独立 Node worker 和同一所选包的公共 ModelRuntime SDK 导出。Electron 和 React 不导入 Pi SDK 类或私有实现模块。

[process.ts](process.ts) 拥有子进程、以 LF 分隔的公共 JSONL 传输、请求关联和等待退出的关闭流程。CLI 的 get_state 响应确定就绪状态。字符串中的 Unicode 分隔符仍是数据。只读元数据请求具有 Host 期限；交互命令默认不设期限，等待 Pi 的实际响应，让人类对话框和长操作可以完成。关闭 stdin 请求 Pi 正常退出；若进程未在期限内退出，逐级终止后仍等待 close 事件。命令拒绝和进程意外退出会拒绝未完成的请求。

[manager.ts](manager.ts) 把原生消息、工具、队列、压缩及扩展 UI 记录投影为 [PiSnapshot](types.ts)。原生压缩和分支摘要仍可见。`stopReason: 'aborted'` 的 AI 消息保留部分输出，不触发失败通知；没有生成文本的服务商错误仍保留在对话中。最终消息拥有权威性；增量与 `thinking_end` 更新流式内容。Responses 摘要使用普通思考块；token 用量不能补出缺失文本。[Responses 流程测试](../tests/responses-flow.test.ts)验证 Pi 0.99.1 有无增量时的摘要、工具执行、空摘要和原生历史。agent_settled 触发权威状态刷新后才公布空闲。活动记录分支提供包括压缩前消息在内的完整历史。已打开的会话文件复用存活的进程，同时发出的打开请求也会合并。侧栏发现只读取原生 JSONL 元数据；写入、上下文重建及迁移由 Pi 拥有。

Steering 在 Pi 支持的下一个轮次边界进入，不中断运行中的工具。Abort 保留未消费输入，clear_queue 清除它们。扩展 select／confirm／input／editor 对话框使用公共响应；通知、文字状态与组件可以投影，任意终端组件仍不支持。活动对话使用 Pi 的可用模型和思考档位。服务商目录在选择项目前即可读取；待应用的模型选择在打开新对话时转为公共 `set_model`。新对话草稿从所选 SDK 的公开模型元数据（`reasoning` 和 `thinkingLevelMap`）及原生设置获取思考档位。首次发送在选定模型后通过 `set_thinking_level` 应用明确选择的草稿档位；重开历史对话保留其原有档位。[目录测试](../tests/provider-catalog.test.ts) 将草稿档位及默认值与实际 Pi 0.99.1 RPC 对照验证。

[providers.ts](providers.ts)拥有独立管理进程和安全登录状态。[provider-runtime.ts](provider-runtime.ts)解析所选官方 CLI 的公共包导出与独立 Node，不替换为另一安装的 SDK。[provider-worker.ts](../runtime/provider-worker.ts)调用公共 ModelRuntime 登录／退出，并转发 Pi 提示、浏览器链接、设备代码及取消回调。Pi 通过其认证存储写入凭据。自定义端点编辑验证并原子更新非秘密的 `models.json` 字段，保留无关服务商、字段和符号链接目标。实际 agent 目录默认 `~/.pi/agent`，运行时／环境覆盖与 RPC 共用。worker／SDK 文件位于 ASAR 和 GUI 依赖外；包装器、不兼容 SDK 导出及扩展注册使用原生 Pi 配置。

[provider-catalog.ts](provider-catalog.ts) 投影可展开的服务商模型列表。工作进程分别返回公共服务商模型目录与可用模型，并禁用网络发现。打开对话后，公共 RPC 模型替换同一服务商的目录，并包含仅由扩展注册的服务商；这不代表已保存凭据或支持 SDK 配置。设置页不加载扩展代码，也不探查兼容端点。[provider-catalog.test.ts](../tests/provider-catalog.test.ts) 使用 Pi 0.99.1 验证原生注册、模型选择及静态配置保持不变。

运行时选择由[runtime/config.ts](../runtime/config.ts)拥有。`pnpm pi:install [version/latest]`在忽略的 `.pi-runtime/<version>` 中独立安装并验证精确官方包。`runtime/selected.json` 或 `PI_DESKTOP_RUNTIME_CONFIG` 选择命令、参数、环境和 agent 目录。未选择时，明确提供的 `PI_EXECUTABLE` 优先于版本化离线随包安装；没有隐式 PATH 查找。`mode: bundled` 跟随当前发行版默认运行时，优先于环境选择。`pnpm pi --version`、官方 TUI、RPC 和服务商 worker 使用相同所选安装。

[pi-session-controls.ts](../runtime/pi-session-controls.ts)注册公共 `desktop-session` 扩展命令。Pi 0.99.1 没有 `navigate_tree` RPC 命令；其公共命令上下文提供 `navigateTree(entryId, { summarize: false })` 和 `fork(entryId, { position: 'at' })`，支持 AI 节点。桥接层要求该命令可用，并在导航前阻止执行、排队输入、弹窗和重叠命令。Pi 写入分支和新会话文件；命令结束后桥接层刷新原生节点及当前位置。编译后的扩展作为真实打包资源位于 ASAR 外。[pi-flow.test.ts](../tests/pi-flow.test.ts)验证中间 AI 工具调用节点导航、返回最终回复及用户／AI 节点分叉，确认没有额外模型请求且原会话完整。原生 afterPack 对真实 Resources 运行同一流程。

兼容性记录目前覆盖官方 @earendil-works/pi-coding-agent 0.99.1、Git 提交 d86654abb8862e201933517d6f1fce9f88dd117f 与桥接 1.13.0。已执行证据通过带 --import tsx 的 Node 运行 [compat.ts](../runtime/compat.ts)、[bridge.test.ts](../tests/bridge.test.ts) 和 [pi-flow.test.ts](../tests/pi-flow.test.ts)。实际 Pi 流程使用隔离的 loopback 流式提供商，验证 Pi 的真实写入、读取和 shell 工具、文件结果、助手部分输出、steering 与 follow-up 自然交付、HTTP 请求取消、输入队列保留及清除、原生 clone/fork/switch、会话发现及重启恢复。实际 CLI 加载公共扩展，验证 confirm/select/input/editor 响应、通知和持久化自定义输出，不启动模型请求。两个独立引擎流程进程并发通过。[pi-flow.expected.json](../tests/fixtures/pi-flow.expected.json) 记录可见对话和文件结果。Windows fixture 明确选择 Pi 的 PowerShell 工具；POSIX fixture 使用默认 bash 和可移植的 echo。Windows/Linux 实际执行、外部真实提供商及应用打包需要另外验证，不能由这些 macOS 引擎测试推断通过。

选择另一个 Pi 发布版本前，对照公共 RPC、CLI／资源／会话文档及导出的认证 SDK 检查桥接层。对实际可执行文件运行 `pnpm test:compat` 和所属服务商／流程测试，再记录实际结果。RPC 兼容不能确认服务商 SDK 兼容；不支持的管理方式保留原生配置入口。[pi-fixture.ts](../tests/pi-fixture.ts)为 GUI 验证提供可释放的官方 Pi 工作区和本地脚本流式服务商。兼容性不包含上游源码修改或隐藏模型上下文。

侧栏发现可同时接收已注册项目根目录，对共享的原生会话目录只扫描一次，并分别解析各项目的相对会话目录。项目别名、折叠、置顶和归档状态保存在 Host GUI 偏好中；发现过程不改写 Pi 会话。

[agent-configuration.ts](../runtime/agent-configuration.ts)投影包清单和原生资源过滤规则。安装、更新、移除在 [package-worker.ts](../runtime/package-worker.ts) 中通过选定 Node／公开 SDK 执行，fd 3 与 npm/Git 标准输出隔离。[package-operation.ts](../runtime/package-operation.ts)负责取消并等待进程树退出。更新使用内存中的原生配置选择来保留作用域，开关修改所属包的过滤规则。[扩展兼容性](../../../docs/pi-desktop/extensions.zh.md)记录默认组合和已测试的 RPC 限制。

[技能展示](skill-presentation.ts)识别 Pi 0.99.1 原生技能封装，不修改消息或导入 SDK 代码；未知格式仍以普通文本显示。[包发现与管理](../../../docs/pi-desktop/extensions.md#marketplace)将公共目录元数据与原生包执行分开。

[session-records.ts](session-records.ts) 在 RPC 启动前读取已列出的 Pi v3 会话文件，依据持久化的最后条目和父链，复用实时历史的消息投影。该路径不执行扩展、不写会话，也不迁移记录。未知版本、不兼容的树和超过 64 MiB 的文件交由 Pi 加载。首个实时快照替换预览；执行控件要求已有可用的实时句柄。[session-preview.test.ts](../tests/session-preview.test.ts) 在扩展启动被屏障阻塞时，将预览与实际 Pi 0.99.1 RPC 比较，并验证文件字节保持不变。

可选的 `contextUsage` 投影只来自公共 `get_session_stats`。桥接在消息结束后及读取原生状态时刷新它，较新的请求会取代旧结果。无效或不支持的元数据保持不可用，不使对话失败。压缩后的原生 null 占用保持 null；会话累计 token 数不会替代当前上下文。[bridge.test.ts](../tests/bridge.test.ts) 检查缺失、有效、null 和无效记录；[pi-flow.test.ts](../tests/pi-flow.test.ts) 对比实际 Pi 0.99.1 的投影，并验证可见的 `@路径` 提示原样到达 Pi，再由原生文件工具执行读取。

输入框读取 `completedContext`，在公共 `agent_settled` 及权威空闲状态刷新后复制占用、内容占比和缓存命中率。首次完整 AI 回复前不显示；工具执行、流式输出、取消和空闲元数据更新期间保持不变；新的原生会话会清空该显示。加载已有完整回复的原生历史时恢复显示，不改写历史。[context-settlement.test.ts](../tests/context-settlement.test.ts)用实际 Pi 0.99.1 验证首轮工具边界、后续流式输出、取消和恢复。

自有扩展通过公共 `setStatus` 发布仅含数值的 `contextBreakdown` 权重；提示词、工具定义和消息文本均不进入该元数据或原生历史。它在启动、历史或模型变化及执行结束时读取有效提示词、活动工具元数据和 Pi 已处理压缩的会话上下文，并在模型调用前观察当前消息。GUI 将文本和 schema 字符数归一化为估算占比，并按大小降序排列；图片使用固定权重，仅通过 codemode 访问的 MCP 工具计入该活动工具的定义。总占用未知时隐藏分类。[context-composition.test.ts](../tests/context-composition.test.ts) 覆盖分类、原生摘要、隐藏 shell 输出、图片和无效元数据；实际 Pi 流程验证投影以及不变的模型请求。

底部的 **缓存命中率** 使用公共会话 token 总量：`cacheRead / (input + cacheRead + cacheWrite)`。Pi 的 input 不含缓存读取和写入；输出 token 不进入分母。该比值按所有原生会话条目的输入量加权，包括非活动分支和已压缩历史。缺失、无效或总量为零时显示短横线；有效输入的缓存读取为零时显示 0%。[cache-usage.test.ts](../tests/cache-usage.test.ts) 覆盖这些边界，真实 Pi 流程验证服务商缓存明细经过规范化和聚合后的结果。

完成订阅只在公共 `agent_settled` 后接收已持久化的最终助手条目。Host 观察所有自有 Pi 会话，包括没有渲染器订阅的会话。[unread-chats.ts](../unread-chats.ts) 串行、原子地写入 GUI 主目录下的 `unread-chats.json`，每个原生会话身份保留一个条目，并记录规范化文件路径。已读回执包含已显示的条目 ID，较晚到达的旧回执不能清除更新的回复。共享 GUI 只为获得焦点、可见、未被弹窗遮挡且包含该条目的对话确认已读。经过校验的 macOS preload 动作将未读数量传给 Electron 原生 Dock 角标；Web 保留侧栏提示。[unread-host.test.ts](../tests/unread-host.test.ts) 验证实际 Pi 发布、重启、旧回执以及不变的原生会话字节；客户端和存储测试覆盖焦点、可见性、去重、写入失败和关闭流程。

[会话标题](../runtime/session-title.ts)在 `agent_settled` 后通过 Pi 0.99.1 公共 `modelRegistry.streamSimple` 调用当前模型。一次后台请求概括首条用户消息，目标为五个词或十个中文字符；请求不带工具，也不进入主对话记录和上下文。输入最多 12,000 个字符，请求输出上限为 256 token，60 秒后取消。公共 `setSessionName` 保存标题并发出 `session_info_changed`。已有名称及生成期间的手动改名优先；会话替换和关闭会取消请求并等待结束。失败保留首条消息作为临时标题，同一次打开期间不重试；仅浏览或恢复历史不会请求标题。[session-title-flow.test.ts](../tests/session-title-flow.test.ts)通过实际 Pi 验证流式输出和工具阶段的时序、暂停的摘要请求、未改变的对话与上下文、侧栏发现及原生恢复；原生 afterPack 也运行该检查。上下文估算使用公共只读 `buildSessionProjection().messages`，其内容与所选版本的会话上下文消息一致。
