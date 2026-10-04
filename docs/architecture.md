# Pi-DSH architecture

Electron and Web share React, Host and bridge. Pi runs independently.

## Runtime ownership

Public SDK discovery reads preferences/resources without executing extensions. [Package management](pi-desktop/extensions.md) uses separate native jobs. Markdown/MCP edits preserve revisions, symlinks and unrelated fields.

`apps/pi-desktop/main.ts` owns native windows, menus, directory selection and background operation. Its sandboxed preload exposes specific native actions. `server.ts` serves the GUI and HTTP/SSE endpoints; the local Web entry uses this Host directly. `client/` contains the shared presentation and typed locale dictionaries.

`bridge/` starts one official Pi RPC process per open session, correlates responses, projects native messages/tools into GUI snapshots, and joins shutdown. Pi owns execution, model context, resources, compaction and sessions. Provider management uses an independent Node worker that loads only the selected official Pi package’s public ModelRuntime SDK; Pi’s authentication storage owns login/logout writes. The bridge does not implement an Agent loop or synthesize DSH events.

`runtime/` prepares official Node/Pi/pnpm and locked Python/Office/search resources outside ASAR. First use installs the payload offline into immutable `runtimes/pi-<version>-<target>-<manifest-hash>` directories. Desktop opens its GUI while installation and shell environment reading proceed; Pi/Office routes wait for readiness. External selection takes priority, supporting compatible Pi upgrades without rebuilding Electron. Tested versions and checks live in `bridge/version.json` and [the setup guide](pi-desktop/README.md).

The separately loaded `runtime/pi-auxiliary.ts` uses Pi's public extension APIs to register `load_workspace_dependencies` and discover Office skills. It returns executable and library paths as native Pi tool output; it does not inject Host prompts or alter Pi's loop, authentication or sessions. The GUI imports bridge-owned view models and no Pi SDK classes.

The owned `runtime/pi-session-controls.ts` extension uses public command-context `navigateTree` and `fork` to navigate or branch at user and assistant entries. Pi performs native session writes. The bridge checks idle state and advertised capability and refreshes full entries plus the current leaf. Compiled extension resources remain outside ASAR; they load into the selected official Pi without modifying it.

Runtime selection never implicitly falls back to PATH `pi`. Explicit external configuration remains independent of Desktop updates; `mode: bundled` resolves the current distribution's default. GUI appearance changes do not write runtime selection. Runtime and credential isolation are distinct: Pi's default agent directory remains shared unless explicitly overridden.

Before project selection, the GUI reads native provider/model metadata using the same resolved Pi agent directory: `~/.pi/agent` by default, overridden by `PI_CODING_AGENT_DIR` or explicit runtime `agentDir`. Login prompts travel as transient bridge interactions; entered keys never enter GUI preferences or transcripts. Custom endpoint editing preserves other `models.json` fields. Provider SDK code and its worker stay outside ASAR and GUI dependencies. Unsupported public exports, runtime wrappers, and extension-provider management retain native CLI setup.

`office-preview.ts` uses the bundled Python to read XLSX/CSV/TSV sheets and DOCX/PPTX content for the Files panel. Spreadsheet previews preserve values and formulas without calculating them; document HTML is sanitized and displayed in a sandboxed frame. These read-only previews do not render printed pages. Conversation mathematics uses the retained Markdown/KaTeX pipeline.

The Host validates previews, downloads and application targets against registered project roots, rejecting escaping symlinks. `directory-picker.ts` browses and creates folders before registration. `local-applications.ts` discovers installed applications and joins pending launchers at shutdown. Both carriers open canonical paths without a shell; `file-actions.ts` remembers the selected editor. Electron supplies native dialogs and shell actions through Host hooks. Renderer requests select known application IDs, never executables. Native IPC accepts only trusted main-frame actions.

`terminals.ts` owns project PTYs, bounded screens and joined process-tree cleanup; disconnected clients expire after 20 seconds. `browser-guests.ts` isolates sandboxed webviews from Node, native IPC and the GUI origin. Project tabs retain their bodies; Web uses sandboxed iframes.

## Retained libraries and historical data

Six source libraries retain React primitives, stores, docking, brands, language mapping and workspace paths. DSH/Cordis runtime packages are removed.

Committed DSH session fixtures and persistence records remain in their original locations as historical evidence, excluded from active programs. Pi resumes only its native session files; it does not migrate DSH sessions. See [the upgrade guide](upgrade-guide/v0.2.0-rc.2/pi-desktop/guide.md).

## Upgrade validation

A compatible Pi update changes the external runtime without rebuilding Electron. Public RPC or authentication SDK changes may require bridge adaptation or native setup fallback. Verify the selected executable and public export, startup, correlation, streaming, tools, cancellation, session recovery, supported login interactions and affected GUI entry. See [testing](testing.md).
