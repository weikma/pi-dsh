---
kind: upgrade-guide
description: "Source launches no longer select a terminal Pi implicitly when Desktop has no selected or bundled runtime."
---

# Explicit Pi runtime selection

## Change

Upgrading from `0.2.0-rc.4` to `0.2.0-rc.5` removes implicit fallback to `pi` on PATH. This affects source Desktop/Web launches without a runtime selection or prepared payload. Packaged Desktop uses its independent bundled runtime; existing explicit external selections remain authoritative. Saving appearance alone preserves runtime selection. **Use bundled Pi** stores `mode: bundled` and follows the installed Desktop distribution's default.

## Migration

1. For a checkout, run `pnpm pi:install 0.99.1` to create the ignored `apps/pi-dsh/runtime/selected.json`, or run `pnpm runtime:prepare` to prepare the native bundled default.
2. To keep a terminal installation, explicitly configure `command` and `args` in the file selected by `PI_DSH_RUNTIME_CONFIG`, or set `PI_EXECUTABLE`. On Windows select Node with the official Pi CLI JavaScript entry in `args`; do not select an npm `.cmd` shim.
3. To restore packaged defaults, choose **Settings → Use bundled Pi**, then reopen a native session. Keep the existing agent directory unless you intend to use another Pi profile.
4. Run `pnpm pi --version` and `pnpm test:compat` for a checkout. In packaged Desktop, check **Settings → Current runtime** and the displayed version. Desktop upgrades preserve explicit external choices; terminal CLI upgrades do not change the bundled default.
