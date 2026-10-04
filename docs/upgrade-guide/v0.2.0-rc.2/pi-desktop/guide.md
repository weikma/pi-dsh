---
kind: upgrade-guide
description: "Pi's public RPC replaces the DSH Desktop agent runtime and the DSH CLI and SDK entry points."
---

# Pi replaces the Desktop agent runtime

English | [中文](guide.zh.md)

## Change

Desktop and local Web use the same GUI with the unmodified official Pi Coding Agent. Native packages include independent Node/Pi/pnpm and Python/Office resources; explicit external runtime selection takes priority. Pi owns execution, tools, authentication, settings, resources, and native sessions. Desktop owns GUI preferences, project navigation, and versioned offline runtime copies. The DSH CLI, SDKs, agent loop, profile bundles, and DSH-specific controls are removed. Retained GUI libraries are private TypeScript source packages; their generated `lib/` entry points and separate publication workflow are removed.

The existing DSH Session data remains in its original location and format. Pi does not resume or convert those logs. Committed Session generations and their format records remain unchanged. This change affects users of the DSH Desktop, Web interface, CLI, and SDKs.

## Migration

1. Retain a compatible DSH installation separately if you need to inspect existing DSH Sessions. Back up your data before replacing an installation. Do not pass DSH logs to Pi's `--session` option or rewrite them as Pi session files.
2. Follow the [Pi Desktop setup](../../../pi-desktop/README.md). Native installations use the bundled runtime when no external selection exists; first use copies it offline into the GUI home's `runtimes` directory. A checkout can use `pnpm pi:install` and `apps/pi-desktop/runtime/selected.json`. Keep authentication, resource configuration, and session management in Pi.
3. Open Desktop or the local Web interface, add a project directory, and create a Pi chat. Resume a native Pi session to confirm that the selected runtime and GUI use the same session storage. DSH permission presets, goals, jobs, schedules, workflows, account billing, and plugin-management settings have no migration to this GUI.
4. Replace DSH CLI and SDK automation with an independently installed Pi interface that supports the required operation. This application supplies a GUI and a local GUI host; it supplies no compatibility command or SDK for the removed DSH interfaces.
5. For checkout integrations that consume retained GUI libraries, bundle their TypeScript and CSS sources through a browser bundler. Follow their source exports instead of the removed `lib/` paths. The repository no longer builds or publishes standalone DSH packages.
6. Before upgrading Pi again, use the [compatibility workflow](../../../pi-desktop/README.md#upgrade-pi) against the selected executable. A new version number alone does not establish compatibility.
