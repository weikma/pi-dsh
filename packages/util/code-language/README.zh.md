---
description: "供 GUI 语法高亮预览使用的浏览器安全文件后缀映射。"
kind: "package-library"
---

# @deepseek-ai/dsh-util-code-language

[English](README.md) | 中文

## 摘要

使用 `languageForPath` 根据文件名选择语法高亮语言。`CODE_HIGHLIGHT_EXTENSIONS` 提供人工维护的后缀集合。此私有源码库无状态，由使用方加载语法及分词。

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

从[源码入口](src/index.ts)导入映射。GUI 直接打包此 TypeScript 源码，并将无法识别的后缀渲染为纯文本。此库没有插件配置、原生依赖或可执行文件。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

语言选择读取最后一个路径段，并以不区分大小写的方式匹配其后缀。它接受 POSIX 和 Windows 分隔符。同一张表还提供兼容性提示辅助函数，不读取文件或执行高亮器。

</details>

<a id="further-exploration"></a>
## 进一步探索

[Pi Desktop 配置说明](../../../docs/pi-desktop/README.zh.md)介绍使用此库的应用及运行时归属。

<a id="model-experience"></a>
## 模型体验

此库不向模型提供工具、提示或会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 映射表匹配后缀，不检查内容，也不提供通用文件名规则。
- 使用方必须加载返回的语法；未知或不可用的语法仍渲染为纯文本。

<a id="dev-note"></a>
### 开发备注

无。
