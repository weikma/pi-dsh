---
kind: upgrade-guide
description: "Pi DSH standardizes product paths, environment variables and runtime manifests."
---

# Pi DSH naming and configuration paths

English | [中文](guide.zh.md)

## Change

The next release uses **Pi DSH** for visible names and `pi-dsh` for source directories, CI filenames and package artifacts. `apps/pi-desktop` and `docs/pi-desktop` become `apps/pi-dsh` and `docs/pi-dsh`. Environment variables use `PI_DSH_` instead of `PI_DESKTOP_`. Electron's native bridge is internal and now uses `piDsh` and `pi-dsh:` names.

The default GUI home is `~/.pi-dsh`. The packaged native profile uses the operating system's application-data directory under `pi-dsh`. When a destination file does not exist, default launches import GUI preferences, the chosen editor and unread state from `~/.pi-desktop`, and the packaged runtime selection from `@deepseek-ai/pi-desktop/runtime.json`. Existing destination files win. Explicit GUI homes, native profiles and runtime configuration paths do not import settings for that selection. Pi credentials and sessions keep their native locations; old runtime installations remain usable by an explicitly selected command.

## Migration

1. Stop previous GUI instances before installing the new application. Rename launcher environment variables to the `PI_DSH_` prefix, including `PI_DSH_HOME`, `PI_DSH_RUNTIME_CONFIG` and `PI_DSH_PORT` when configured.
2. For a source checkout, run `pnpm install --frozen-lockfile` to refresh workspace links, then `pnpm pi:install 0.99.1` to select the official CLI at its new checkout path. Packaged default launches preserve their existing explicit runtime selection automatically.
3. Run `pnpm runtime:prepare` to regenerate a source runtime payload with the new manifest names. Bundled resources use `.pi-dsh-build` and a `pi-dsh-runtime.ts` auxiliary extension; explicitly supplied older payload roots need regeneration.
4. Launch Desktop or Web and check the displayed **Pi DSH** name, project list, model setup and runtime selection. No session deletion is part of the upgrade.
