# Pi-DSH testing

`pnpm typecheck` checks separate Host and Client programs. `pnpm test` runs owner-local tests under `apps/pi-desktop/tests`; historical DSH fixtures are not executed.

Bridge tests exercise correlated JSONL responses, Unicode framing, streamed presentation, interactive extension requests and quiescent subprocess teardown. The Pi flow test starts the selected official CLI against a scripted loopback provider and checks real file/shell effects, streaming, cancellation and native session resume. Temporary workspaces, runtime homes and ports are owned per test.

`pnpm test:ui` covers [first-run](../apps/pi-desktop/tests/first-run.client.spec.tsx), [conversation](../apps/pi-desktop/tests/conversation.client.spec.tsx), [appearance](../apps/pi-desktop/tests/appearance.client.spec.tsx), and retained code/read/diff/streaming and [Tooltip](../packages/client/ui-primitives/tests/tooltip.client.spec.tsx) behavior. Checks cover keyboard/IME, startup races, provider management, drafts, files, editor actions and runtime isolation. Command checks cover native routing, completion, clipboard and single submission. Tooltip checks cover viewport separation, scrolling, Escape and hover/focus. API fixtures establish React behavior, not native hit testing or provider access.

The [isolated first-run Pi test](../apps/pi-desktop/tests/pi-first-run.test.ts) checks fresh discovery, native identity, reconnect failure and retry without external requests. [Startup tests](../apps/pi-desktop/tests/startup.test.ts) hold an environment barrier while the GUI and files serve, then open actual Pi; shutdown joins that barrier, and preparation failures remain visible.

[Provider resolver tests](../apps/pi-desktop/tests/provider-runtime.test.ts) check selected-package public exports, independent Node, and refusal of wrappers/private SDK fallbacks. [Worker tests](../apps/pi-desktop/tests/provider-worker.test.ts) exercise actual Pi ModelRuntime API-key storage, logout, cancellation, configuration preservation and joined EOF. Scripted OAuth callbacks check prompts and callback-server cleanup; they do not complete third-party authentication. [Host tests](../apps/pi-desktop/tests/providers-host.test.ts) exercise project-free inventory, safe HTTP/SSE attempts and worker teardown during runtime replacement.

`pnpm test:compat` checks public RPC against the selected executable. The Pi flow also verifies the public history extension's user/assistant forks and intermediate tool-call navigation with no extra model requests. [Runtime-isolation tests](../apps/pi-desktop/tests/runtime-isolation.test.ts) reject implicit PATH selection; [file-action tests](../apps/pi-desktop/tests/file-actions.test.ts) check literal launch arguments and editor preferences; [Host tests](../apps/pi-desktop/tests/host.test.ts) reject escaping paths/symlinks. External-provider and OAuth acceptance require authorized credentials; never log keys.

[Configuration tests](../apps/pi-desktop/tests/agent-configuration.test.ts) cover native SDK persistence, resource editing and MCP connections; Host tests verify separate resource/request IDs.

`pnpm build` produces the common browser GUI and Electron entries. `pnpm dev:web` and `pnpm dev:desktop` exercise the shared Host with browser and native presentation. Test visible changes through this real Host and Pi flow, including model/tool output, stream recovery, dialogs, themes and platform chrome. macOS evidence does not establish Windows/Linux runtime or packaging success; CI owns those platform checks.

Before claiming installer first-run acceptance, use a pristine GUI home and Pi profile without inherited provider credentials or a registered project. Operate the installed native window with real mouse and keyboard input, including the empty composer/model setup, sidebar collapse/expansion, fullscreen, header menus and minimum window size. Source geometry checks cover macOS/Windows caption rules and drag recollection; they do not establish physical Windows execution.

`pnpm runtime:prepare` assembles the native payload; `pnpm test:runtime` checks executables, Python libraries and Office generation. Missing payloads explicitly skip dependent checks. Native afterPack runs five provider, auxiliary, engine, history and recovery checks against actual Resources; foreign binaries are not executed. Offline tests cover relocation, concurrent publication, independent selection and earlier-version preservation. Office checks use shipped Python and real files; browser evidence covers tabs, sandboxed documents and settled KaTeX rendering.

`pnpm test:docs` validates active documentation and links without changing frozen records. Report executed checks and unverified platforms/provider paths.

GUI regressions also verify project grouping, persisted disclosure, inline search, pin/archive/restore, and immediate New chat drafts with no Pi startup before first send. Host tests verify navigation-only project removal, atomic preference failures, shared session discovery and project-relative session directories.

[Extension verification](pi-desktop/extensions.md#verification) covers package lifecycle, process-tree cancellation and optional checks of published community packages.

[Terminal tests](../apps/pi-desktop/tests/terminals.test.ts) cover real PTY input, resize, recovery, interrupts and cleanup. [Host checks](../apps/pi-desktop/tests/terminal-host.test.ts) validate origins and shutdown. Packaged acceptance exercises terminal helpers, browser navigation, shortcuts and retained tabs.
