# Retained UI libraries

These private source packages preserve DeepSeek Harness React components, stores, docking and browser-safe utilities for Pi DSH. They have no Cordis/Agent runtime. Follow [root instructions](../AGENTS.md).

Use explicit source exports and declared workspace dependencies. Keep components pure, labels localized by callers and styles on existing `--dsw-*` tokens. Preserve non-obvious component contracts and meaningful focused tests; active product tests live in `apps/pi-dsh/tests`.
