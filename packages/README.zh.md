# 保留的 UI 库

[English](README.md) | 中文

六个私有源码库为 Pi-DSH 保留 DeepSeek Harness 视觉体系与浏览器工具，不包含 Cordis 或 Agent 运行时。

| 目录 | 用途 |
|---|---|
| [client/ui-primitives](client/ui-primitives/README.zh.md) | React 控件、图标及安全的 Markdown 和工具输出渲染 |
| [client/ui-dockkit](client/ui-dockkit/README.zh.md) | 停靠和分割布局 |
| [client/store](client/store/README.zh.md) | 不依赖 React 的可观察状态和快照存储 |
| [util/brand](util/brand/README.zh.md) | 区分不同标量的品牌类型 |
| [util/code-language](util/code-language/README.zh.md) | 文件扩展名与高亮语言映射 |
| [util/workspace-path](util/workspace-path/README.zh.md) | 浏览器安全的文件路径格式化 |

Pi 集成位于 [apps/pi-desktop](../apps/pi-desktop/package.json)。已移除包内的历史会话夹具目录仍然保留，但不是当前工作区。
