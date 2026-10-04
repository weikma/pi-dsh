# Safety

English | [中文](SAFETY.zh.md)

Pi DSH launches the official Pi Coding Agent with the permissions of its operating-system user. Pi tools and extensions can read files, modify projects and run commands; the GUI does not sandbox agent execution. Review the selected Pi runtime and extensions, and use disposable environments for untrusted work.

The shared Host binds to loopback and validates Host and Origin headers. Electron renderers use context isolation, sandboxing and no Node integration. These controls protect GUI access; they do not confine Pi tool execution.

Keep credentials in Pi-owned configuration and keep backups of accessible files. This project has not undergone a security audit. The software is provided under the [MIT License](LICENSE), without warranty.
