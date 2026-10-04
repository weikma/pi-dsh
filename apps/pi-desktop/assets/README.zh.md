# Pi 品牌资源

[English](README.md) | 中文

共享的 [pi-mark.svg](pi-mark.svg) 是 2026-09-30 从 [Pi 官方 Press Kit](https://pi.dev/press-kit) 的 [logo.svg](https://pi.dev/logo.svg) 下载的三色像素标识。原始下载字节的 SHA-256 为 `abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b`；`logo-auto.svg` 包含相同图形。本地副本只修改 viewBox，裁去透明外围，供紧凑的 GUI 使用。

侧栏、欢迎页和浏览器 favicon 使用这个 SVG。原生应用 PNG 和 Windows 应用／托盘 ICO 通过 `pnpm icons:generate` 从它生成；应用图标保留浅色圆角底板，托盘标识保持透明。macOS 运行中的 Dock 图标也使用生成的应用图片。这些资源不导入 Pi 运行时。

官方 Press Kit 标明资源使用 MIT 许可证。[LICENSE.pi.txt](LICENSE.pi.txt) 保留来自[固定许可证源](https://github.com/earendil-works/pi-website/blob/2f5e410b97474d0a34ec2500aa1aa58d6c3f992c/LICENSE)的官方站点 MIT 声明。彩色 SVG 以当前官方 URL 和内容哈希记录，不归属于该已归档站点版本。
