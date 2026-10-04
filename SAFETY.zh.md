# 安全

[English](SAFETY.md) | 中文

Pi-DSH 以当前操作系统用户的权限启动官方 Pi Coding Agent。Pi 工具和扩展可以读取文件、修改项目和运行命令；GUI 不对 Agent 执行额外施加沙箱限制。请检查选用的 Pi 运行时和扩展，并在临时环境中执行不可信任务。

共享 Host 绑定本机回环地址，并验证 Host 和 Origin 请求头。Electron 渲染器启用上下文隔离和沙箱，禁用 Node 集成。这些措施保护 GUI 访问，不限制 Pi 工具执行。

凭据保存在 Pi 自有配置中，请备份其可以访问的文件。本项目尚未经过安全审计。软件按 [MIT 许可证](LICENSE)提供，不作担保。
