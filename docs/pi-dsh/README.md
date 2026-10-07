---
description: "Configure the independent official Pi runtime, use the shared Desktop and local Web GUI, and verify Pi upgrades."
---

# Pi DSH

English | [中文](README.zh.md)

## Summary

Pi DSH is a desktop and local Web workspace for the official Pi Coding Agent, with native package management, session history and project tools. Electron and local Web share one React interface and one loopback Host. Pi runs as an independent subprocess through its [public RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md); it owns the agent loop, tools, model context, authentication, resources, settings, and native sessions.

## Table of Contents

- [Set up a checkout](#setup)
- [Use the GUI](#usage)
- [Configure the runtime](#runtime)
- [Data ownership and limitations](#ownership)
- [Upgrade Pi](#upgrade-pi)
- [Implementation](#implementation)
- [Dev Note](#dev-note)

-----

<a id="setup"></a>
## Set up a checkout

Use Node.js 22.19 or later in the 22.x series, or Node.js 24 or later, and the repository's declared pnpm version. The Pi installer also requires npm and access to the official npm registry. It installs the selected official release separately from the GUI's dependencies.

```sh
pnpm install
pnpm pi:install 0.99.1
pnpm pi --version
```

Open **Settings → Models and providers** in either GUI to use Pi’s existing provider configuration, enter an API key, or follow an available Pi OAuth login. The official Pi CLI (`pnpm pi`) remains available for resources and unsupported setup methods. Follow [Pi’s documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) for provider requirements. GUI authentication calls Pi’s public SDK; Pi’s own authentication storage writes credentials.

Expand a provider to see its model names and IDs, search long lists, and choose an available model. Counts describe Pi’s registered catalog, not every model offered by the remote service. With a chat open, its public model list takes priority and includes models supplied by loaded extensions. Compatible endpoints configured only in `models.json` retain their explicit model list; opening Settings does not discover remote models.

Choose either development presentation; both use the same application:

```sh
pnpm dev:web
```

```sh
pnpm dev:desktop
```

The development Web interface opens at `http://127.0.0.1:5174`. Its API proxy connects to the local Host. For built assets, run the build first, then choose one entry:

```sh
pnpm build
pnpm start:web
```

```sh
pnpm start:desktop
```

The built Web Host prints its loopback URL; its default port is `19388`. `PI_DSH_PORT` changes the Web Host port. Desktop starts an application-owned Host on an available port and offers **Open in Browser** from the File menu. Native packages carry the official Pi CLI and independent Node/Python resources outside ASAR; they can run without a system Node or Pi installation. Provider authentication and access still follow Pi's configuration.

On Windows x64, `pnpm package:desktop:win` produces the installer in `release/` and a directly runnable `release/win-unpacked/Pi DSH.exe`. Packaging uses node-pty's shipped Node-API prebuilds. Pi retains its native tool selection: its default shell tool requires Bash, available with Git for Windows; select PowerShell through Pi's native `defaultTools` setting when Bash is unavailable. Desktop does not inject `--tools`, which would also exclude unlisted extension tools.

<a id="usage"></a>
## Use the GUI

You can type before selecting a project, opening a session, or configuring a provider. **Send** opens Desktop's folder picker or Web's folder browser when no project is selected and retains the draft through project selection. **New chat**, the project-row button, Command/Ctrl+N and `/new` open an empty composer without adding a sidebar entry or starting Pi. Each new-chat action clears the unsent text and attachments in that draft. Sending the first message starts Pi and refreshes the native history list; the first user message immediately labels the chat until its native name is available. Select an existing native Pi session from its project group to resume it. Switching chats keeps each unsent draft and its images in memory until this GUI closes or reloads; clicking the current chat keeps its draft.

After the first successful complete reply, including tool work and queued input, the current model makes a separate background request to summarize the first message as a short title, aiming for about ten Chinese characters or five words. The sidebar then replaces its temporary first-message title with that model summary, which Pi saves for subsequent opens. Manual renames take priority. If generation fails, the first-message title remains; merely opening old chats does not generate titles.

The new-chat page centers the Pi logo, heading and composer together. Its project bar searches registered folders, opens a folder, or clears the selection while preserving the draft; a cleared selection survives restart. Git repositories also show local branch search, uncommitted-file counts, branch switching, creation from current HEAD, and a paged Git graph with commit details. Git keeps local changes and rejects overwrites, conflicts, ongoing operations and branches occupied by other worktrees. Branch changes wait until Pi tasks, queued input and dialogs finish in that repository. The graph reads existing local, tag and remote refs without fetching. Desktop and Web share these controls.

A submitted message appears immediately while Pi starts in the background. The progress header first appears after one second as **Working for 1s**; Pi’s native message replaces the local bubble without a sending receipt. Startup or send failures restore unsent text and images without dropping later edits. Switching away before startup completes prevents that request from being sent into another chat. Extension questions replace the composer and leave the transcript available for reading and scrolling. Select with the mouse or arrow keys, then choose **Submit** or press Enter. Entering a recognized **Type something.** row selects that native option and keeps its matching text prompt in the same row; Enter submits and Shift+Enter adds a line. Other extensions retain their native request sequence. Pi retains original option strings and cancellation behavior. OpenAI reasoning summaries use the same Thinking display as other models. Expanding the work details reveals thinking text directly; each Thinking section can still be collapsed. A completed empty thinking block explains that no readable text was returned. Displayed thinking omits a leading `Thinking:` label and terminal color codes; generic extension output also omits terminal color codes. Native records and copied message text remain unchanged.

Web **Add project** browses Host folders, filters names, shows dot-prefixed folders on request and creates a child folder. A typed absolute path remains available. Desktop keeps its native directory picker; both preserve the conversation draft.

Opening a saved chat first reads its native transcript while Pi restores in the background. You can read, copy and draft a reply during restoration; sending and history changes become available when Pi is ready. A startup failure keeps the readable transcript. Unsupported native record versions defer to Pi for loading and migration.

Project names expand or collapse their chats. Hover or keyboard focus reveals project and chat actions: new chat, project rename/removal, chat pinning, rename, fork and archive. Search opens within the Projects heading; Escape closes it. **View options → Archived chats** offers restore. Project aliases, disclosure, pinning and archive state belong to Desktop preferences; removing a project retains its folder and native Pi sessions. Chat rename and fork use Pi’s public RPC.
The macOS Dock badge counts chats with unread finished replies; each chat contributes at most one. The same chats have an unread dot in the sidebar on Desktop and Web. A reply is read when its native entry is displayed in a focused, visible chat; opening another chat or Settings leaves it unread. Pi must settle after tools, retries and queued inputs before a reply counts. Stopping a response, reopening history and switching branches do not create completion notices. Read state survives app restarts in Desktop-owned metadata. Archived chats and removed projects are excluded from the count.

The composer **+** opens file references, image attachments and the same curated slash commands above the input. Browse or filter a project directory, or type a directory path; selecting a file inserts its visible `@path` at the cursor and preserves the draft. Spaces are quoted. Pi receives that text unchanged and decides when to read the file; Desktop does not inject file contents. The ring to the left of the model appears after the first complete reply. It retains the last completed reply’s usage, composition and cache hit rate throughout later streaming and tool work, then updates when the next full reply finishes. Hover or keyboard focus shows the estimate with compact `K`/`M` token units and capacity in every interface language. Its hover card shows estimated shares for the system prompt, Pi tools, directly declared MCP tools, extension tools, skills, messages and tool results, omitting empty categories. Shares normalize character counts by category and sort from largest to smallest. The separated **Cache hit rate** row uses session-wide cached input divided by total input tokens; it shows a dash before usable usage is available. Unknown post-compaction usage stays unknown until Pi reports a new estimate. Configure providers in **Settings → Models and providers** before selecting a model; the composer only selects configured models.


Open **Settings → Models and providers** to read Pi’s native configuration without choosing a project or starting a conversation. Configured providers appear first; **Add provider** searches the remaining catalog. API-key inputs are password fields and never show saved keys. Pi OAuth callbacks can request a browser link, device code, text, selection, or manual code; the panel offers link opening/copying, cancellation and retry. Only the selected Pi provider’s available authentication methods appear.

**Add compatible provider** saves the non-secret endpoint, API protocol and model fields into Pi’s `models.json`, preserves other providers and unedited fields, then starts Pi’s API-key prompt. **Model** first lists providers and their model counts, then lets you search the selected provider's models and return to the provider list. The search also matches model names and IDs across providers, showing their provider and native ID. Before opening a conversation, an explicit selection is retained and applied with public `set_model` when the conversation opens. New chats inherit the most recently active model and thinking level across projects and application restarts. Desktop stores this choice in GUI preferences and applies it through public Pi commands before the first message. Existing conversations retain their native model and thinking level; an unavailable remembered model reports an error before sending.

After provider setup, an idle conversation reconnects to read Pi’s updated credentials and models while retaining saved native history and the GUI draft. Execution, compaction, queued input, or an extension dialog defers this reconnect; finish or clear that work, then choose **Refresh models**. A configuration change does not abort the active task.

Extension-registered providers, wrapper executables, compiled Pi runtimes, or missing/incompatible public SDK exports use **Open Pi terminal** on Desktop or **Copy Pi launch command** on Web. The private launcher retains the selected runtime’s environment without displaying keys and remains valid only for the current Host and runtime selection. Conversation RPC still loads Pi extensions; TUI-only setup stays in the Pi terminal; GUI login shortcuts do not become model prompts.

The transcript renders Pi text, thinking, images, tool activity, and expandable native compaction and branch summaries. Each response groups its thinking, intermediate replies and tools under one expandable **Working for …** header with a divider. The header is hidden during the first second. Its elapsed time then updates every second from the native start timestamp, or from local startup when that began earlier. Details open while working and collapse on completion; **Worked for 6h 20m 5s** replaces the header, and the final reply remains visible outside the disclosure. Durations use `h`, `m`, and `s` in every language. Completed durations use native user-message and persisted reply timestamps; records without timing show **Worked**. Stopped and failed responses retain their outcome and any partial reply. Message actions appear on hover or keyboard focus; the latest reply keeps them visible. Compact copy and branch buttons are followed by the native message time in local 24-hour `HH:mm` format; missing timestamps are omitted. Their tooltips stay above the buttons with a gap and dismiss when the transcript scrolls. **Copy message** copies the original message text; **Back to bottom** resumes following the latest reply after scrolling. A cancelled reply stays visible without a failure notice. Bash uses the retained terminal card; unfamiliar tools show their arguments and output generically. A tool's file path opens a read-only preview. The Files panel can browse a registered project before opening a chat, with expandable folders and directory filtering. It previews source files, PNG/JPEG/GIF/WebP images, XLSX/CSV/TSV sheets, and DOCX/PPTX document content. Spreadsheet tabs and grids preserve data and formula text without recalculation; document content appears in a sandboxed frame. These previews do not establish printed layout. Legacy DOC/XLS/PPT formats and PDF preview are absent; unsupported files remain available through native opening or Web download. Conversation formulas use the retained Markdown/KaTeX renderer.

Type `/` in the conversation on Desktop or Web to see the available everyday shortcuts: model, thinking, compaction, fork, session information and Pi history. Before a chat opens, only model selection appears; busy sessions and unavailable history capabilities reduce the list. The grouped menu spans the composer, with icons, localized names and right-aligned descriptions. Search command names, localized titles or description keywords to find other GUI shortcuts, Pi commands, prompt templates and skills. Arrow keys keep focus in the editor; Enter or a click opens a GUI action, and Tab only completes its command text. Native resource choices complete their exact invocation names; Enter on an exact native command submits it to Pi. Escape or an outside click dismisses the menu without changing the draft. Pi-registered commands with the same name take priority. The following shortcuts use public Pi actions or existing GUI controls and do not start a model request by themselves, except `/compact`, which uses Pi's compaction model.

| Command | Desktop and Web behavior |
|---|---|
| `/model [provider/model-id]` | Open model selection or select an exact configured provider/model ID. |
| `/thinking [level]` | Open thinking selection or set a level supported by the current Pi model. |
| `/new` | Start a new chat, selecting a project when needed. |
| `/resume` | Open the sidebar’s saved-chat search. |
| `/name [text]` | Open rename or set the native session name. |
| `/session` | Show Pi's native session file, ID, message/tool counts, tokens, cost and context usage. |
| `/tree` | Open the native session tree. |
| `/fork` | Choose a user message to fork into a separate native session. |
| `/clone` | Ask Pi to clone the current session at its current position. |
| `/compact [instructions]` | Selecting Compact opens optional instructions before starting Pi’s compaction. Stop cancels a pending request; a typed command with arguments forwards them directly. |
| `/copy` | Copy the latest assistant text returned by Pi. |
| `/export [path]` | Export HTML through Pi and show the resulting file path. |
| `/login`, `/logout` | Open provider authentication controls. |
| `/settings` | Open the categorized GUI settings workspace. |

Finish execution, queued input and Pi dialogs before changing history or compacting. Invalid arguments and failed operations retain the command for correction or retry. JSONL export and known TUI-only commands such as `/reload` and `/hotkeys` show native terminal setup; Desktop offers **Open Pi terminal**, and Web offers **Copy Pi launch command**. These commands are not sent as model prompts. Unknown resource commands still pass to Pi unchanged.

Desktop and local Web share **Open in editor** and **File actions** for choosing an installed editor, opening with the system default, showing the file in its file manager, copying its path and downloading. Desktop also offers a native application picker. **Project Files → Open in…** opens the project in an installed editor, terminal or file manager on the Host computer. SSH and headless Hosts hide local application actions. The Host validates project paths and launches applications with literal arguments; GUI-owned `PI_DSH_HOME/editor.json` remembers the selected editor.

The right workspace panel starts with **Project Files**, **Terminal**, and **Browser**. Its **+** opens another choice tab. Closing the final tab collapses the panel; reopening it returns to these three choices. Files shows a read-only root path, rounded search field and reload button; folders expand in place and files open separate preview tabs. Tabs, tree expansion, search and live terminal/browser contents stay with their project while you switch chats or collapse the panel, until the GUI closes or reloads. Terminal starts your local shell in the registered project; closing its tab stops the shell and its child processes. Desktop Browser provides isolated website tabs with address, back, forward and reload controls. Enter an address and click **Go** or press Enter; **Open in browser** sits below the page. Web embeds sites in a sandbox; its back/forward controls cover addresses entered in the toolbar, and sites that block embedding can be opened externally.

Toggle chat history with **Command+B** on macOS or **Ctrl+B** on Windows/Linux. Toggle the right Files panel with **Command+Option+B** or **Ctrl+Alt+B** respectively. These bindings preserve the draft and ignore active IME composition; modal dialogs retain keyboard focus.

While Pi is running, select **Steer** or **Follow up** and press Enter to use Pi's corresponding queue semantics. The composer's **Send** button becomes **Stop** in the same position during execution or compaction and returns to **Send** when Pi stops. Click **Stop**, or press Esc with no menu or dialog open, to request Pi cancellation while retaining your draft. **Clear queue** clears Pi's pending input. Each settled user or assistant message offers **Continue from here** in the same native session or **Fork chat** into a new native session through that entry. **Session branches** searches the full tree, including intermediate assistant tool-call messages, inactive branches and summaries. Pi preserves existing branches; navigation does not start a model request or generate a summary. Finish execution, queued input and dialogs before changing history. An unavailable public history extension disables those actions. Rename and compaction use public RPC; history actions use Pi's public extension command context. Extension dialogs support the public confirm, select, input, and editor requests; status and text-widget updates appear in the transcript.

Settings separates General, Appearance, Models, Agent, Instructions, Skills, Commands, MCP, Extensions, Shortcuts, and Runtime into a searchable-resource workspace. `/settings` opens the same GUI. Language and appearance apply immediately; saving them preserves runtime selection. Changing the runtime stops the existing bridge processes and clears their live GUI handles. Reopen a native session after saving. **Use bundled Pi** restores the distribution's default without fixing its current installation path. Pi remains responsible for the saved conversation.

**Settings → Appearance** independently controls interface text (12–20 px) and code text (10–24 px). Choose separate light/dark code themes, line numbers, and long-line wrapping for Markdown code blocks and source-file previews; shared diff views use the same display preferences. Changes apply immediately and persist across restarts. Interface text changes retain icon sizes and panel dimensions. Code copying excludes the line-number gutter. These GUI preferences leave Pi runtime selection and native settings unchanged.

<a id="runtime"></a>
## Configure the runtime

The checkout installer writes the ignored `apps/pi-dsh/runtime/selected.json` and an isolated npm installation under `apps/pi-dsh/.pi-runtime/<version>/`. It records the official package version, registry integrity, and source revision, and verifies the installed CLI version. The selected `command` is the installer's independent Node executable; `args` starts with the official Pi CLI entry. Pi does not run inside Electron's Node runtime.

Packaged Desktop keeps runtime selection in Electron's user-data directory as `runtime.json`. `PI_DSH_RUNTIME_CONFIG` selects an explicit configuration file for either presentation. An existing selection takes priority, followed by an explicitly supplied `PI_EXECUTABLE`, then the bundled distribution. Desktop never implicitly resolves `pi` from PATH. Without a selection or bundled payload, source launches report the missing runtime and ask you to run `pnpm pi:install` or `pnpm runtime:prepare`. A `{ "mode": "bundled" }` selection follows the current distribution's default, including after a Desktop upgrade. The bundled default runs under its own Node executable; it does not use Electron's Node mode. For an external Windows runtime, select Node and put the official Pi CLI JavaScript entry in `args`; `pnpm pi:install` generates that selection. A global npm `pi.cmd` shim is not a directly supported executable for shell-free spawn. See the [runtime-selection upgrade guide](../upgrade-guide/v0.2.0-rc.4/runtime-selection/guide.md). See the [naming upgrade guide](../upgrade-guide/v0.2.0-rc.58/product-name/guide.md).

Agent settings persist user defaults through the selected official Pi SDK: model/provider, thinking level, automatic compaction and retry, image resizing/blocking, skill commands, and steering/follow-up delivery. Trusted project settings and explicit CLI options take precedence. New chats read saved values; **Reload current chat** applies configuration to an idle native session while preserving its history. Existing session model choices remain Pi-owned.

Skills and Commands list native resources by user/project scope, support search, creation, Markdown editing and enable/disable controls. Instructions show Pi-discovered context files, with inherited parent files read-only. Package resources are inspectable but their source files remain read-only. Unsaved edits require an explicit discard; stale file revisions fail without overwriting external changes. Discovery uses public package resolution without loading extension code or installing missing packages. Project resources follow Pi’s saved trust state; an explicit trust action writes through the public ProjectTrustStore.

MCP settings add stdio/HTTP entries and change enabled state or tool exposure in Pi’s documented `mcp.json`. They preserve unrelated fields, authentication references and symlink targets; credential values are not returned to the GUI. Configured does not mean connected. Native `/mcp` owns connection status, tools, reconnection and OAuth; an extension replacing `/mcp` retains its own configuration. The sidebar’s **Extensions** and **Skills** open the [package centres](extensions.md#marketplace) for official-gallery search, exact-version installation, updates, removal and native resource filters. Extension-specific terminal setup remains available on Desktop, with a copied launch command on Web.

Pi’s default agent directory is `~/.pi/agent`, shared with an existing terminal installation. `PI_CODING_AGENT_DIR` overrides it; runtime `env` overrides the inherited environment, and an explicit `agentDir` takes priority over both. The panel displays the resolved directory. Desktop does not create a separate credential profile by default. POSIX Desktop reads the login-shell environment in the background and applies it before Pi/provider processes start; project settings follow the selected configuration context. The GUI, drafts, project navigation and ordinary file previews do not wait for this read.

The bundled distribution currently pins Node `24.21.0`, official Pi `0.99.1`, pnpm `11.7.0`, Python `3.12.14`, 13 Python distributions, ripgrep `15.2.0`, and fd `10.3.0`. First use copies the complete payload offline into `PI_DSH_HOME/runtimes/pi-<version>-<target>-<manifest-hash>` in the background; subsequent launches reuse that immutable installation. Desktop opens the main interface directly, with no separate “Preparing local runtime” window. Requests that need Pi or Office tools await preparation; errors appear through their normal API/UI paths. Quitting aborts and joins the shell probe and waits for atomic runtime publication. It preserves Pi's independent credentials and native session storage. `PI_DSH_BUNDLED_RUNTIME` selects a prepared payload for source or test launches.

The public Pi extension registers `load_workspace_dependencies`, which returns absolute Node, Python, pnpm, library, and Office-checker paths, and discovers three Office skills through Pi's resource API. Pi records the tool result itself; the Host does not add hidden model context. Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml, XlsxWriter, and their locked dependencies. See [auxiliary resources](../../apps/pi-dsh/runtime/AUXILIARY.md) for assembly and structural-check limits.

| Field | Meaning |
|---|---|
| `mode` | `bundled` restores the current bundled default; omit for an external command. |
| `command` | External executable to start without a shell. |
| `args` | JSON array of arguments before the bridge adds Pi's RPC and session options. |
| `env` | Optional environment overrides for the external Pi process. |
| `agentDir` | Optional Pi agent directory, forwarded as `PI_CODING_AGENT_DIR`. |
| `version` | Optional recorded release label; executable compatibility still requires a check. |

The GUI preserves environment overrides it does not edit. Configure Pi's own CLI options and resources using Pi's documented interfaces. A missing executable, rejected RPC command, provider failure, or unexpected process exit appears as an application error.

<a id="ownership"></a>
## Data ownership and limitations

Pi writes native session JSONL and maintains credentials, settings, and resources. The bridge uses public RPC for execution and session changes. Provider login/logout invokes the selected official public ModelRuntime SDK and its authentication storage; Desktop does not implement a second credential store. Compatible-provider editing changes non-secret `models.json` fields and preserves unedited fields. Password responses remain transient and are not saved in browser storage, transcripts, or GUI preferences.

The Host stores projects, appearance, language, the selected project, and native session navigation in `PI_DSH_HOME/preferences.json`, with `PI_DSH_HOME` defaulting to `~/.pi-dsh`. The GUI reads these preferences before saving changes; localStorage serves as a compatibility cache. Desktop and local Web share preferences when their Hosts use the same home directory. This GUI does not import legacy DSH sessions.

The sidebar discovers sessions under Pi's configured `--session-dir` or `PI_CODING_AGENT_SESSION_DIR`, falling back to the selected agent directory's `sessions` tree. The GUI provides no arbitrary terminal-based extension renderer. DSH permission presets, goals, jobs, schedules, workflows, account billing, SDKs, and plugin-management controls are absent. The application has no automatic Desktop update service; its runtime selection supports independent Pi upgrades.

The packaging configuration declares macOS arm64/x64, Windows x64, and Linux targets. A declared target does not establish installer, signing, or runtime validation on that platform; record those checks separately. Existing DSH users should read the [upgrade guide](../upgrade-guide/v0.2.0-rc.2/pi-dsh/guide.md).

<a id="upgrade-pi"></a>
## Upgrade Pi

Locate the active runtime configuration, the [bridge version record](../../apps/pi-dsh/bridge/version.json), and the [compatibility check](../../apps/pi-dsh/runtime/compat.ts). Compare selected and requested official releases using public RPC, exported authentication SDK, CLI/resource behavior and native session format. RPC compatibility does not establish authentication SDK compatibility. Prioritize Pi when a GUI feature conflicts with it; adapt the bridge or retain the native setup route.

For the checkout, select an exact release with `pnpm pi:install <version>`; omitting the version selects the registry's current `latest`. For another configuration file, select the corresponding executable and set `PI_DSH_RUNTIME_CONFIG` when running checks. This external selection overrides the bundled default and can upgrade Pi without rebuilding Electron. Restart the Host after changing runtime selection. Updating the distribution's default also requires its artifact/production locks and target preparation; a GUI package carries that pinned payload.

```sh
pnpm test:compat
pnpm typecheck
pnpm test
pnpm build
pnpm test:docs
```

The bridge records Pi `0.99.1` as its tested release. The compatibility check uses the actual selected official executable with an isolated agent directory and disposable workspace. Its keyless smoke covers startup, state and transcript reads, models, commands, thinking levels, queue commands, renaming, new sessions, idle abort, and shutdown. The [Pi flow test](../../apps/pi-dsh/tests/pi-flow.test.ts), run by `pnpm test`, separately drives the real CLI against a scripted loopback provider and checks streamed output, file read/write and shell effects, steering and follow-up delivery, active cancellation with preserved queues, native clone/fork/switch, session resume, and four public extension dialogs. That flow uses test-owned agent configuration and disposable files; it does not establish authenticated external-provider access.

The prepared macOS arm64 auxiliary payload passed native Python/version checks, all 13 library imports, `pip check`, DOCX/PPTX/XLSX creation and reopening, and the OOXML checker. The [auxiliary Pi flow](../../apps/pi-dsh/tests/auxiliary-flow.test.ts) used the actual bundled Node/Pi, a scripted loopback provider, and the public extension: Pi called `load_workspace_dependencies`, executed its returned Node/pnpm/Python paths, created and reopened an XLSX file, read the result, recorded the tool output in native JSONL, and discovered the Office skills. `pnpm runtime:prepare` prepares the native distribution used by `pnpm test`; `PI_DSH_TEST_RUNTIME` can select another prepared native payload. The flow explicitly skips when the default payload is absent and rejects a missing or malformed explicit selection.

The macOS arm64 `0.2.0-rc.2` DMG and its actual application passed first-launch offline installation, default independent Node/Pi selection, real Pi read/write/bash calls against the scripted provider, five Office HTTP previews and native spreadsheet/document presentation. These checks used configured fixtures and did not cover an empty Pi configuration with real native keyboard input. The native app exited normally on SIGTERM, stopped its Pi process and closed its Host. Closing the preparation window during the first offline copy also completed and joined startup before exiting. The package contains an external Python decoder and upstream licenses; its GUI ASAR contains no Pi implementation. Native packaging runs the public auxiliary flow against the copied Resources. The local DMG is unsigned and not notarized; these checks do not establish other platforms or an external-provider model run.

A Chrome production-GUI check used the actual bundled Python and Host Office decoder for XLSX, CSV, TSV, DOCX, and PPTX fixtures. Light/dark checks covered sheet tabs, copying, sandboxed document content, Settings layout, and the retained inline/display mathematics renderer; automation reported no page errors. Navigation and Pi snapshots in this viewer check were test fixtures; it did not make a model request.

A macOS Chrome smoke used `pnpm dev:web`, the [scripted local provider](../../apps/pi-dsh/tests/pi-fixture.ts), and the real official Pi `0.99.1` without external API keys. CUA interaction verified streamed conversation output, real tool cards, file preview, Stop, Steer, chat renaming, and the light English interface. An explicit temporary Pi extension exercised confirm, select, input, and editor dialogs, followed by native custom-message and notification output. A confirmation remained answerable after 31 seconds, and a page reload resumed by native Pi UUID, including the macOS path aliases; automation reported no page errors. Windows/Linux execution, signed installation, external-provider/OAuth authentication, multimodal image requests, and a reasoning model's live thinking stream remain unverified.

macOS Electron development smoke launched `pnpm exec electron apps/pi-dsh` with the development UI and Host URLs. CUA confirmed native Pi JSONL resume, conversation text, read/write/bash cards, and opening and cancelling the system project picker. After `pnpm build`, another Electron launch used the fixture runtime configuration and an application-owned Host on an available loopback port. A running streamed request triggered the Quit confirmation; **Keep Working** retained the chat, and the confirmed Quit exited with code zero, stopped the Host, and cleaned up Pi children. A separate built-app restart changed the Host port from `65127` to `65177` and automatically restored the selected native Pi session, complete transcript, light appearance, and English locale from persisted GUI preferences. These checks exercised the built application, not a signed installer.

The macOS arm64 `0.2.0-rc.3` packaged application passed CUA checks starting with no projects or models: real keyboard typing, editing pasted Chinese, clickable model setup, and project selection with the draft preserved. Refresh discovered a test-only model configuration; selection and submission produced real read/write/bash effects through the bundled independent Node and official Pi. Native checks covered the 700×560 window, sidebar collapse/expansion, narrow/wide file previews, titlebar dragging, fullscreen transitions, Settings keyboard input and light English appearance, native-history reload, Stop preserving a new draft, and minimize/restore/close/reopen. Web on the same Host accepted keyboard input and copied the Pi launch command, with no native-terminal button. The native terminal action spawned bundled Node and removed its launcher; CUA could not inspect Terminal, so the `/login` screen and credential entry were not verified. These checks do not establish external-provider access or Windows/Linux execution.

The macOS arm64 `0.2.0-rc.4` packaged application passed checks with isolated Pi/GUI homes and no projects: real keyboard provider search, masked password entry and saving a deliberately invalid test-only key, model-list refresh and logout. OpenAI OAuth displayed its authorization URL and manual-callback input; the authorization page was not opened. Cancel closed the local callback listener on port 1455 and stored no OpenAI credential. The 700×560 window kept the provider modal within the viewport; Escape dismissal, sidebar collapse and composer keyboard input worked. Chrome on the same Host verified provider search, API-key prompt cancellation and absence of the native-terminal control. Packaged Resources passed the provider-worker and auxiliary afterPack checks. These checks establish UI, native storage and cancellation behavior, not external-provider model access or completed OAuth authentication.

The installed `0.2.0-rc.4` application also read existing native Pi configuration before any project was registered. The model picker and provider dialog displayed configured providers, custom models and the default selection from `~/.pi/agent`. Byte hashes of `auth.json`, `models.json` and `settings.json` were unchanged before and after this read-only check, and no model request was made. Final source checks passed 49 Node tests with one explicit packaged-Resources worker skip, all 16 UI tests, type checking, lint and RPC compatibility. The two native afterPack checks passed without skips. These results do not establish a live external-provider request or completed third-party login.

The `0.2.0-rc.5` acceptance kept Pi at `0.99.1`. Production Chrome used a copied native profile and a disposable project with the actual DeepSeek V4.1 Flash provider: Pi wrote and read `hello.txt`, streamed tool activity and completed its reply. CUA verified provider/model grouping, panel bindings, file preview, an assistant fork, intermediate assistant navigation and return to the final reply, light/dark presentation and 700×560/500×560 history layouts. Switching between explicit and bundled runtimes preserved the file preview and produced no stale connection warning. Pristine macOS arm64 packaged startup verified independent offline runtime installation, native typing and panel shortcuts, project browsing before a chat, CSV preview, selecting TextEdit and reusing it, restart/project restoration and appearance saving without an external runtime file. `pnpm test` passed 53 tests with one explicit packaged-worker skip; all 27 UI tests, type checking, lint, RPC compatibility and four actual-Resources afterPack checks passed. `pnpm package:desktop --mac dmg --arm64` produced the unsigned, unnotarized DMG. Windows/Linux execution and completed OAuth remain unverified.

For `0.2.0-rc.6`, timing-only instrumented native builds measured executable launch to the real main window's `ready-to-show` event. Three warm samples changed from 1711/1378/1632 ms to 355/335/350 ms: median 1632 → 350 ms. Fresh-home first-window samples changed from 13365 → 1882 ms with the same 582 MiB payload; first-use tool readiness still awaits background installation. A native test held a shell on an unreleased file barrier and verified keyboard input, panel shortcuts and text preview before readiness, then opened actual Pi after release. No environment cache or model request was involved. Focused startup/Host/provider/Office/shell checks and native packaging passed; two independent startup-test processes passed concurrently, and the unmodified Host failed the new startup regression as expected. These are macOS arm64 first-window measurements, excluding external model/network latency and Windows/Linux timing.

Before claiming an upgrade complete, run the affected flow checks with disposable workspaces and copied native sessions. Record the source and target Pi versions, exact commands run, platform results, and any unavailable runtime, credentials, or checks. Updating `version` or `testedVersion` alone does not complete an upgrade.

Windows x64 acceptance used a local `0.1.1` build with Pi `0.99.1`. `pnpm package:desktop:win` produced an unsigned NSIS installer and passed all six actual-Resources checks. `pnpm test:runtime`, `pnpm test:compat`, `pnpm typecheck`, all 692 UI tests and nine focused runtime/recovery tests passed. The unpacked executable started with isolated empty GUI/Pi homes; native Chinese input and sidebar shortcuts worked. Its Electron Host passed real PTY input/output, resize and joined close, then drove official Pi file write/read and PowerShell calls against a scripted loopback provider. The full `pnpm test` run failed context-settlement verification and was interrupted while package-operation and terminal-host checks remained pending; it is not a passing full-suite result. These checks do not establish installation through the NSIS wizard, signed distribution, or external-provider authentication.

The Windows `0.1.0` release build includes these same runtime and packaging fixes. `pnpm package:desktop:win --config.directories.output=release/v0.1.0 --publish never` passed all six actual-Resources checks and produced an unsigned x64 NSIS installer with product version `0.1.0`. The unpacked application started with isolated empty GUI/Pi homes and accepted native Chinese keyboard input. Its Windows source commit is identified separately in the release notes; the original `v0.1.0` tag remains unchanged.

<a id="implementation"></a>
## Implementation

The shared client sends HTTP commands and follows complete bridge snapshots through Server-Sent Events. The Host starts one official Pi RPC process per opened conversation. A separate independent Node worker dynamically imports only the selected official package’s public SDK export for provider inventory and authentication. The worker file and Pi production dependencies are real files outside Electron ASAR; Electron and React consume secret-free bridge records without importing Pi SDK classes. The bridge owns framing, responses, process teardown, and version adaptation.

The retained React primitives, docking components, observable store, brand types, code-language mapping, and path utilities contain no Harness execution. Electron supplies isolated native directory/application pickers and external-link controls; file opening uses the shared Host. The built `pi-session-controls.mjs` is a real resource outside ASAR and uses only Pi's public extension API for native tree navigation and arbitrary-entry forks. The [application source](../../apps/pi-dsh/) owns the composed GUI, Host, runtime installer, and platform packaging.

Drag either sidebar boundary to resize it; history has a 264px minimum and the workspace panel has a 240px minimum. Widths persist in GUI preferences, survive panel collapse, and fit smaller windows without replacing the saved sizes. Project groups expand and collapse with a 300 ms height and opacity transition. The sidebar and file browser shortcuts and toggles use a 200 ms width and opacity transition, with the conversation following the available width; on narrow windows, the file browser slides over the conversation. Closing the file browser preserves its current preview, filter, and scroll position. Dragging follows the pointer without a transition; arrow keys resize a focused separator, and Escape cancels a drag. Hidden panels are inactive for mouse and keyboard input; the system’s reduced-motion preference disables these transitions.

On native macOS, collapsing the sidebar removes its rail and keeps navigation controls beside the traffic lights; fullscreen removes the traffic-light clearance. Conversation and preview own explicit grid columns when navigation is hidden; narrow previews use the entire frame as their overlay position. Native Windows reserves a separate 40px caption above navigation, conversation, and file previews, with matching overlay insets; fullscreen clears that caption. The [frame tests](../../apps/pi-dsh/tests/window-frame.test.ts) check the source placement/clearance rules and macOS drag recollection; DOM tests do not establish native layout. Ordinary Web keeps its compact sidebar rail.

POSIX Desktop reads the user's interactive login-shell environment once per launch in the background. After a complete dump, cancellation, or failure, it closes the probe's stdout, stops only the probe's process group, and waits for its direct shell to exit. It does not change shell configuration files or persist the environment. The [login-shell tests](../../apps/pi-dsh/tests/login-shell-environment.test.ts) check natural reader-process exit and termination of a probe-owned background listener that retains stdout.

<a id="dev-note"></a>
## Dev Note

None.
