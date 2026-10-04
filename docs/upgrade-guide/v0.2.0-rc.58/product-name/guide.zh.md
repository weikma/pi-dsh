---
kind: upgrade-guide
description: "Pi DSH 统一产品路径、环境变量和运行时清单命名。"
---

# Pi DSH 命名与配置路径

[English](guide.md) | 中文

## 变更

下一版本以 **Pi DSH** 作为显示名称，以 `pi-dsh` 命名源码目录、CI 文件和安装包产物。`apps/pi-desktop` 与 `docs/pi-desktop` 改为 `apps/pi-dsh` 与 `docs/pi-dsh`。环境变量以 `PI_DSH_` 替代 `PI_DESKTOP_` 前缀。Electron 原生桥接属于内部接口，改用 `piDsh` 和 `pi-dsh:` 名称。

默认 GUI 主目录改为 `~/.pi-dsh`，打包应用的原生配置位于操作系统应用数据目录下的 `pi-dsh`。目标文件不存在时，默认启动会从 `~/.pi-desktop` 导入 GUI 偏好、所选编辑器及未读状态，并从 `@deepseek-ai/pi-desktop/runtime.json` 导入打包应用的运行时选择。已有目标文件优先。显式指定 GUI 主目录、原生配置目录或运行时配置路径时，对应选择不导入设置。Pi 凭据与会话保留原生位置；显式选择的命令仍可使用旧运行时安装。

## 迁移

1. 安装新应用前退出旧 GUI 实例。将启动器环境变量改为 `PI_DSH_` 前缀，包括已配置的 `PI_DSH_HOME`、`PI_DSH_RUNTIME_CONFIG` 和 `PI_DSH_PORT`。
2. 源码工作区先运行 `pnpm install --frozen-lockfile` 更新工作区链接，再运行 `pnpm pi:install 0.99.1`，选择迁移后工作区路径中的官方 CLI。打包应用默认启动时会自动保留已有的显式运行时选择。
3. 运行 `pnpm runtime:prepare`，重新生成采用新清单名称的源码运行时资源。内置资源使用 `.pi-dsh-build` 和 `pi-dsh-runtime.ts` 辅助扩展；显式指定的旧资源目录需要重新生成。
4. 启动 Desktop 或 Web，检查 **Pi DSH** 显示名称、项目列表、模型配置和运行时选择。升级本身不会删除会话。
