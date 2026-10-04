# Documentation instructions

Active documentation covers Pi DSH, its shared local Web entry, bridge, independent Pi runtime and retained UI libraries. Historical DSH persistence records remain unchanged and do not describe the current runtime.

Use current-state prose and one physical line per paragraph. Keep English/Chinese counterparts structurally aligned. Commands must be executed before describing their observed behavior; report unavailable runtime, provider credentials or platform checks explicitly. Keep one owner for each fact, link to source and owning tests, and maintain the Pi compatibility rules in root `AGENTS.md` when verified evidence supersedes them.

Run `pnpm test:docs` and `git diff --check`. Do not rewrite historical session files or frozen archived Agent Notes to satisfy active documentation checks.
