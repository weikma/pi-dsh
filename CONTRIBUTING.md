# Contributing

English | [中文](CONTRIBUTING.zh.md)

Pi DSH provides a desktop and local Web workspace for the official Pi Coding Agent. Read [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md) before changing the integration.

Keep upstream Pi unmodified. Place RPC compatibility and process changes in the bridge, native carrier changes in the Electron entry, and presentation changes in the shared client. Update the owning bilingual documentation with verified behavior.

Run the focused checks in [testing](docs/testing.md). Use disposable projects for agent execution, describe the Pi version and platforms actually tested, and keep credentials out of changes.
