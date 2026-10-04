---
kind: upgrade-guide
description: "Pi 的公共 RPC 替换 DSH Desktop 的 agent 运行时及 DSH CLI 和 SDK 入口。"
---

# Pi 替换 Desktop 的 agent 运行时

[English](guide.md) | 中文

## 变更

Desktop 与本地 Web 使用同一套 GUI，并连接未修改的官方 Pi Coding Agent（编程智能体）。原生安装包包含独立 Node／Pi／pnpm 和 Python／Office 资源；显式外部运行时选择优先。Pi 管理执行、工具、认证、设置、资源和原生会话。Desktop 管理 GUI 偏好、项目导航和版本化离线运行时副本。此应用移除了 DSH CLI（命令行界面）、SDK、agent loop（智能体循环）、配置档 bundle 和 DSH 专属控件。保留的 GUI 库是私有 TypeScript 源码包；其生成的 `lib/` 入口和独立发布流程已移除。

现有 DSH Session 数据保留其原位置和格式。Pi 不恢复或转换这些日志。已提交的 Session 代际文件及其格式记录保持不变。此变更影响 DSH Desktop、Web 界面、CLI 和 SDK 的使用者。

## 迁移

1. 如需查看现有 DSH Session，请单独保留兼容的 DSH 安装。在替换安装前备份数据。不要把 DSH 日志传给 Pi 的 `--session` 选项，也不要将其重写为 Pi 会话文件。
2. 按照 [Pi DSH 配置说明](../../../pi-dsh/README.zh.md)操作。没有外部选择时，原生安装使用随包运行时；首次使用将其离线复制到 GUI 主目录的 `runtimes`。工作副本可使用 `pnpm pi:install` 和 `apps/pi-dsh/runtime/selected.json`。认证、资源配置和会话管理仍由 Pi 负责。
3. 打开 Desktop 或本地 Web 界面，添加项目目录并创建 Pi 对话。恢复一个 Pi 原生会话，确认所选运行时与 GUI 使用相同的会话存储。DSH 权限预设、目标、后台任务、计划任务、工作流、账户计费和插件管理设置不迁移到此 GUI。
4. 将 DSH CLI 和 SDK 自动化改为独立安装、且支持所需操作的 Pi 接口。此应用提供 GUI 及其本地宿主；它不为已移除的 DSH 接口提供兼容命令或 SDK。
5. 如工作副本集成使用保留的 GUI 库，请通过浏览器打包器打包其 TypeScript 和 CSS 源码。使用其源码导出，不再使用已移除的 `lib/` 路径。仓库不再构建或发布独立的 DSH 包。
6. 再次升级 Pi 前，对所选可执行文件执行[兼容性验证流程](../../../pi-dsh/README.zh.md#upgrade-pi)。仅更新版本号不能确认兼容性。
