---
description: "供 Pi Desktop 和本地 Web 复用的 React 控件及 transcript 渲染器。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-primitives

[English](README.md) | 中文

## 摘要

使用保留的 React 基础组件构建控件并渲染 agent（智能体）输出，包括按钮、输入框、菜单、模态框、图标、Markdown、代码、终端输出及文件卡片。调用方提供本地化标签和应用的 `--dsw-*` 设计令牌。此私有源码库不包含 agent 执行或 Cordis 注册。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

从包的[源码入口](src/index.ts)导入具名组件。Pi Desktop 的 Vite 构建直接打包 TypeScript、React 和 CSS 模块；此库没有独立可执行文件、插件安装命令或生成的 `lib/` 入口。标签及无障碍名称由使用方应用的类型化语言字典管理。

`MarkdownText` 在流式输出时渲染已经闭合的行内公式。块级公式和 `math` 围栏中的当前内容只要能被 KaTeX 解析就会渲染；解析错误在消息结束前保持隐藏。普通代码保留原文。既有的 `$…$`、`$$…$$`、`\(…\)` 和 `\[…\]` 写法保留完成状态下的含义。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

控件管理局部浏览器交互及渲染。功能状态和回调由调用方提供。Markdown 导航通过 `MarkdownDelegateProvider` 委托；工具卡片渲染传入内容，不执行工具。组件属性和行为要求记录在各自导出声明旁。

流式解析器将未闭合的块级公式及其内部空行保留在可变尾部。稳定的源码键和带缓存的公式组件会在后续文字更新时复用已渲染的公式。[流式公式测试](tests/markdown-streaming-math.client.spec.tsx)覆盖定界符闭合、错误的 TeX、增量切分和渲染复用；`pnpm test:ui` 包含这些检查及 Markdown DOM 夹具。

</details>

<a id="further-exploration"></a>
## 进一步探索

[Pi Desktop 配置说明](../../../docs/pi-desktop/README.zh.md)介绍使用此库的应用及运行时归属。

<a id="model-experience"></a>
## 模型体验

此库不向模型提供工具、提示或会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 使用方需要能处理 CSS 模块及应用设计令牌样式的浏览器打包器。
- 此库只提供展示；桥接层和宿主管理 Pi 命令、进程生命周期和文件访问。

<a id="dev-note"></a>
### 开发备注

无。
