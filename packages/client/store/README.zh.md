---
description: "不依赖 React 的 GUI 状态可观察快照及不可变更新。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-store

[English](README.md) | 中文

## 摘要

使用 `createSnapshotStore` 创建可观察的 GUI 状态，使用 `defineStore` 声明操作集合。订阅方读取缓存快照，并显式取消订阅。此私有源码库使用 Zustand 和 Immer，不导入 React、Cordis、Pi 或已移除的 Harness 运行时。

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

包的[源码入口](src/index.ts)导出引擎及其[类型化接口](src/contract.ts)。应用直接打包这些源码。每个存储实例由对应的 GUI 生命周期管理，并在生命周期结束时释放订阅。此库没有配置档、插件激活或可执行文件。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

更新生成新的不可变值；选择器和订阅通知独立于 React。通知默认同步执行，可选择按动画帧合并。可选持久化将完整 JSON 值写入浏览器 localStorage；存储不可用时停用持久化，但不妨碍内存更新。

</details>

<a id="further-exploration"></a>
## 进一步探索

[Pi Desktop 配置说明](../../../docs/pi-desktop/README.zh.md)介绍使用此库的应用及运行时归属。

<a id="model-experience"></a>
## 模型体验

此库不向模型提供工具、提示或会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 启用浏览器持久化时，存储值必须可序列化为 JSON。
- GUI 存储不表示 Pi 凭据、原生会话存储或权威模型上下文。

<a id="dev-note"></a>
### 开发备注

无。
