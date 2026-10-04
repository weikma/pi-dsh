---
description: "为容易混淆的 GUI 值提供编译期字符串和数字品牌类型。"
kind: "package-library"
---

# @deepseek-ai/dsh-brand

[English](README.md) | 中文

## 摘要

使用 `Branded`、`BrandedNumber`、`brandString` 和 `brandNumber`，为不同的字符串或数字领域提供独立 TypeScript 类型。辅助函数保留原始基础值。此私有源码库没有依赖、共享注册表或运行时状态。

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

从[源码入口](src/index.ts)导入类型和辅助函数。领域拥有方声明其品牌类型，并在应用品牌类型前验证输入。应用直接使用 TypeScript 源码；此库没有生成的库产物或可执行文件。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

模块私有符号为每个基础值提供交叉类型。TypeScript 从输出程序中移除该符号，两个构造函数都原样返回输入。比较、日志和 JSON 序列化维持普通基础值的行为。

</details>

<a id="further-exploration"></a>
## 进一步探索

[Pi DSH 配置说明](../../../docs/pi-dsh/README.zh.md)介绍使用此库的应用及运行时归属。

<a id="model-experience"></a>
## 模型体验

此库不向模型提供工具、提示或会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 品牌类型提供编译期区分；构造函数不验证字符串或数字范围。
- 算术运算返回普通数字，因此领域拥有方必须先验证结果，再重新应用品牌类型。

<a id="dev-note"></a>
### 开发备注

无。
