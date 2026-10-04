# Shared client libraries

Only `ui-primitives`, `ui-dockkit` and `store` are active. They are static browser build inputs, with no Cordis services, slots or DSH Session events. Follow [root instructions](../../AGENTS.md); presentation and Pi UI adapters live in `apps/pi-desktop/client`.

Reuse existing visual controls and design tokens, require localized label props, and preserve safe Markdown/link/ANSI rendering. Shared stores remain React-free observables. Keep rendering independent from Pi RPC and filesystem access.
