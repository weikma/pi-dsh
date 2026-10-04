# Pi DSH

[English](README.md) | 中文

基于 DeepSeek Harness 界面组件构建的 [Pi Coding Agent](https://github.com/earendil-works/pi) 桌面与本地 Web 工作区。把 Pi 的扩展生态、原生会话和编程工具带到图形界面，也可以在本地浏览器中使用同一套工作区。

![使用本地演示模型的 Pi DSH 工作区](docs/assets/pi-dsh-workspace.png)

## Desktop 与 Web 共享的主要功能

两种界面使用相同的 Pi 集成，均提供以下核心功能：

- **Pi 插件生态。** 浏览 [Pi 包目录](https://pi.dev/packages)，从 npm、Git 或本地路径安装包，管理扩展、技能和提示词模板。自定义工具、斜杠命令和标准 Pi 交互弹窗通过原生运行时执行。[兼容性说明](docs/pi-dsh/extensions.zh.md)。
- **会话分支与恢复。** 浏览 Pi 会话树，从先前的用户或 AI 消息继续执行、分叉新对话，并恢复 Pi 原生历史。
- **随时调整任务方向。** 使用 Pi 原生机制发送 Steer、排队 Follow up、停止执行或压缩上下文。
- **选择模型与思考深度。** 配置服务商，使用 Pi 支持的 API 密钥或 OAuth 登录；新对话沿用上次使用的模型和思考深度。
- **完整的编程工作区。** 按项目组织历史、模型生成对话标题、流式 Markdown 与数学公式、文件和差异预览、Git 操作、终端，以及电子表格和文档预览。
- **本地文件与应用。** 选择项目文件夹，在已安装编辑器或系统默认应用中打开文件，在文件管理器中显示、复制路径和下载文件。也可在运行 Pi DSH 的电脑上，用已安装编辑器或终端打开项目文件夹。

Desktop 使用原生文件夹和应用选择器；Web 提供文件夹浏览、新建及已安装应用列表。SSH 和无桌面环境的主机隐藏本机应用操作。浏览器面板在 Desktop 中使用隔离的原生标签页，在 Web 中使用沙箱嵌入；禁止嵌入的网站可在外部浏览器打开。

Pi 独立运行，保持上游代码不变。兼容的 Pi 升级不需要重新构建 Pi DSH。依赖自定义终端界面的包仍需使用 Pi 终端，不会自动转换成桌面组件。

## 快速开始

需要 **Node 22.x 系列的 22.19 或更高版本，或 Node 24+**，以及 **pnpm 11.7.0**。在 `pi-dsh` 仓库目录中运行：

```sh
pnpm install
pnpm pi:install 0.99.1
```

**启动 Desktop：**

```sh
pnpm dev:desktop
```

**启动本地 Web，支持热更新：**

```sh
pnpm dev:web
```

打开 [http://127.0.0.1:5174](http://127.0.0.1:5174)。保持终端运行，按 Ctrl+C 停止服务。

**构建后启动本地 Web：**

```sh
pnpm build
pnpm start:web
```

打开 [http://127.0.0.1:19388](http://127.0.0.1:19388)。两种 Web 模式默认都使用 Host 端口 `19388`，请选择一种运行。已安装的 Desktop 应用也提供 **File → Open in Browser**，直接使用其正在运行的 Host 和所选运行时。

在任一界面的**设置 → 模型与服务商**中连接模型，选择项目后即可发送消息。两端使用 Pi 原生配置和会话存储；Host 使用相同的 `PI_DSH_HOME` 时，也共享 GUI 偏好与项目列表。

仓库包含 macOS、Windows 和 Linux 打包目标；目前实际桌面验证覆盖 macOS arm64。打包、运行时选择与平台限制见[配置与升级](docs/pi-dsh/README.zh.md)。

## 参与贡献

请阅读[贡献指南](CONTRIBUTING.zh.md)、[架构](docs/architecture.zh.md)、[测试](docs/testing.zh.md)和[安全说明](SAFETY.zh.md)。Pi 及其扩展以当前用户权限运行。

## 许可证与致谢

采用 [MIT 许可证](LICENSE)。Pi DSH 是独立社区项目，基于 [Pi](https://github.com/earendil-works/pi) 和 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的部分组件构建，保留上游版权及[第三方声明](THIRD_PARTY_NOTICES.md)。

欢迎大家提 issue，交流想法、反馈问题！
