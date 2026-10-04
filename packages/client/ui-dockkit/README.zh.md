---
description: "带可逆操作的标签页、分栏和浮动面板布局组件。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-dockkit

[English](README.md) | 中文

## 摘要

使用 `DockController` 和 React 停靠组件构建标签页、分栏及浮动布局。嵌入的 GUI 提供本地化标签、标签页内容和交互回调。此私有源码库将标签页类型视为不透明值，不管理 agent（智能体）或会话执行。

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

使用[源码入口](src/index.ts)及[嵌入接口](src/contract/adapter.ts)。应用直接打包 TypeScript 和此库的 CSS 模块。每个控制器属于一个停靠区域；使用方订阅其快照，并随区域生命周期释放订阅。此库没有独立可执行文件或插件激活。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

规划器将完成的手势转为布局操作，序列管理器支持撤销和重做。React 组件渲染生成的树。此库不解释标签页内容；内容由嵌入应用的渲染器解释。

</details>

<a id="further-exploration"></a>
## 进一步探索

[Pi DSH 配置说明](../../../docs/pi-dsh/README.zh.md)介绍使用此库的应用及运行时归属。

<a id="model-experience"></a>
## 模型体验

此库不向模型提供工具、提示或会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 使用方必须提供所有可见标签和无障碍标签，以及支持 CSS 模块的浏览器打包器。
- 布局历史更改 GUI 排列；它不 fork、撤销或恢复 Pi 对话。

<a id="dev-note"></a>
### 开发备注

无。
