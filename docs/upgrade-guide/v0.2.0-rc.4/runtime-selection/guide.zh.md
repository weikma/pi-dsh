---
kind: upgrade-guide
description: "源码启动缺少已选择或内置运行时时，不再隐式选择终端中的 Pi。"
---

# 显式选择 Pi 运行时

## 变更

从 `0.2.0-rc.4` 升级到 `0.2.0-rc.5` 后，不再隐式回退到 PATH 中的 `pi`。此变更影响缺少运行时选择或已准备资源的源码 Desktop／Web 启动。打包 Desktop 使用自己独立的内置运行时；已有显式外部选择仍然优先。只保存外观会保留运行时选择。**使用内置 Pi**保存 `mode: bundled`，跟随已安装 Desktop 发行版的默认运行时。

## 迁移

1. 工作副本运行 `pnpm pi:install 0.99.1`，创建被忽略的 `apps/pi-desktop/runtime/selected.json`；或运行 `pnpm runtime:prepare`，准备本机内置默认运行时。
2. 若要继续使用终端安装，在 `PI_DESKTOP_RUNTIME_CONFIG` 选择的文件中明确配置 `command` 和 `args`，或设置 `PI_EXECUTABLE`。Windows 应选择 Node，并在 `args` 中填写官方 Pi CLI JavaScript 入口，不能选择 npm `.cmd` 包装脚本。
3. 恢复打包默认版本时，选择**设置 → 使用内置 Pi**，再重新打开原生会话。除非打算使用其他 Pi 配置，保持现有 agent 目录。
4. 工作副本运行 `pnpm pi --version` 和 `pnpm test:compat`。打包 Desktop 检查**设置 → 当前运行时**及显示的版本。Desktop 升级保留显式外部选择；终端 CLI 升级不改变内置默认版本。
