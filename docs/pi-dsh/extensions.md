---
description: "Manage native Pi packages, the default community collection, and Desktop compatibility."
---

# Pi extensions and skills

English | [中文](extensions.zh.md)

## Summary

Open **Extensions** in the sidebar, or **Settings → Extensions**, to discover and manage Pi packages. Pi owns installation, settings, execution and upgrades. Desktop presents the same package resources in Electron and local Web.

## Contents

- [Extension and skill marketplaces](#marketplace)
- [Default collection](#defaults)
- [Install and manage](#manage)
- [Reload and recovery](#recovery)
- [Compatibility and architecture](#compatibility)
- [Verification](#verification)

<a id="marketplace"></a>
## Extension and skill marketplaces

The sidebar footer offers **Extensions** and **Settings**. Open **Settings → Skills** for the skill workspace; the **+** beside Projects adds a project. Extensions retains featured collections alongside **Marketplace** and **Installed**; Skills opens its marketplace by default. Marketplace reads types, authors and monthly downloads from the [official Pi package gallery](https://pi.dev/packages), with submitted search, sorting and pagination. Installed resources remain manageable when the gallery is unavailable.

Package details read the current npm manifest and show scope, exact version, license, declared Pi requirement and resource paths. Gallery tags may be incomplete; without an explicit manifest, Pi discovers conventional directories after installation. Installation pins the version shown in details. Pi installs and removes whole packages, including mixed extensions, skills, prompts and themes; individual resources use native enable/disable filters. Skill names follow the SKILL.md name field. Package files remain read-only; local skills can still be created and edited.

Native `/skill:name` expansion appears as collapsible context beside the visible request. Discovered chat titles use the request or skill command; original messages and copied text remain intact, and explicitly named chats retain their names.

<a id="defaults"></a>
## Default collection

The [catalogue](../../apps/pi-dsh/bridge/extension-catalog.ts) records exact package versions reviewed on October 3, 2026. Selection uses the [official Pi package directory](https://pi.dev/packages), maintainer documentation and actual RPC checks, not download count alone. **Install defaults** installs missing members in the chosen user or project scope; it preserves existing versions and resource filters. Opening the page does not install anything. Community packages are downloaded by Pi, separately from the offline Desktop runtime.

The default collection keeps an enabled `pi-web-search` package instead of adding another search default. This is a recommendation, not an incompatibility rule: explicit installation and resource switches use Pi's native behavior. Package names alone cannot determine registered tools. `pi-web-access` supports native `toolNames.webSearch` (for example, `web_access_search`) or `tools.webSearch.enabled: false` in its `web-search.json`; Desktop preserves these settings and does not rewrite them. Both packages can therefore coexist. See the [package configuration](https://github.com/nicobailon/pi-web-access#configuration).

| Package | Version | Desktop behavior |
|---|---|---|
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | 0.74.0 | Native child agents return results through tool output; terminal dashboards remain in Pi. |
| [pi-web-access](https://github.com/nicobailon/pi-web-access) | 0.35.0 | Search and fetch tools render in the conversation; external services follow the package configuration. |
| [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) | 2.12.0 | Its RPC fallback uses native selection/input dialogs. |
| [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) | 2.12.0 | Task tool results and `/todos` remain visible; its custom terminal overlay is unavailable. |

The catalogue also links Plannotator, pi-mcp-adapter, pi-lens, pi-interactive-shell, billion-context and Langfuse. These are optional: Pi already supplies MCP, terminal components need the TUI, and formatting, alternate compaction or trace uploads change important behavior. Catalogue presence does not establish compatibility of every feature or version.

<a id="manage"></a>
## Install and manage

Choose a scope, then select a featured package or **Add extension**. Sources accept `npm:name@version`, credential-free HTTPS Git repositories and absolute local paths. Project installation requires Pi project trust. Extensions run with Pi’s process access; package managers may execute installation scripts. Installation uses the selected native package manager and needs its usual network access and credentials.

**Installed → Manage** shows the version, source and discovered resources. Individual switches persist Pi’s native package filters, preserving other resource types and patterns. **Update** follows native rules within the selected scope: exact versions and Git refs stay pinned. To select another version, add its explicit source. **Remove** asks for confirmation and invokes Pi’s uninstall; local source directories remain intact. Failed operations retain the form and report an error.

Changes apply to new chats or **Reload current chat** after active execution, queued input and dialogs finish. Package changes require current tasks, queued input and dialogs to finish first; starting or reloading Pi is blocked during the operation. New community packages use the same source and resource controls without requiring a Desktop-specific registration. Unsupported management SDKs retain **Open Pi terminal** or **Copy Pi launch command**.

<a id="recovery"></a>
## Reload and recovery

**Reload current chat** and `/reload` use Pi's public extension command-context `reload()` in the current process. They preserve session identity and history, and require execution, queued input and dialogs to finish first. Pi 0.99.1/0.99.2 retain extensions during resource reload: the first registered duplicate tool wins, while unique tools from later extensions remain available. Desktop follows this native order rather than inventing installation-time priority. Provider authentication/catalog refresh still uses a fresh process.

Cold startup applies Pi's fatal extension-diagnostic check. Its failure offers **Continue in recovery mode**, an explicit per-process `--no-extensions` launch. Automatic discovery and built-in extensions are off; explicit `-e` selections, including Desktop's controls, remain native Pi inputs. Core coding tools work, but an extension-owned provider may still prevent a model request. No extension settings or credentials are rewritten, no draft is sent automatically, and Pi resumes the same session file. Recovery is temporary; it is not saved to CLI configuration or carried into a fresh application launch.

After fixing configuration, **Restore normal extension loading** reopens the same native session. If this attempt fails, Desktop restores the previously chosen recovery launch and displays the error. RPC extension-handler errors remain visible without stopping a healthy process. Pi's RPC does not expose the full resource-loader diagnostic list after reload; inspect native Pi diagnostics for that detail. Terminal `process.exit()`, broken explicit extensions and arbitrary extension side effects cannot be isolated inside Pi's shared extension process.

<a id="compatibility"></a>
## Compatibility and architecture

React consumes bridge-owned package records and generic native tools, commands, dialogs, notifications and text widgets. It never imports extension JavaScript, Pi SDK classes or terminal renderers. Unknown tools retain safe generic rendering. Pi owns command discovery and invocation, so a new extension needs no GUI command adapter for its standard RPC behavior.

The independent configuration worker reads manifests and calls public `SettingsManager`, `DefaultPackageManager` and `ProjectTrustStore`. Discovery never imports extensions or installs missing packages. Mutations are serialized by the Host. Package jobs run in a separate selected-Node process with a dedicated result pipe, so npm/Git output cannot corrupt authentication or conversation JSONL. Closing the Host cancels and joins package process trees before waiting for management requests. Worker files stay outside ASAR.

[marketplace.ts](../../apps/pi-dsh/marketplace.ts) reads metadata only from the public Pi gallery page and npm manifests, without credentials or package execution. Pages have a five-minute memory cache, bounded response sizes, same-origin redirects and request deadlines; Host shutdown aborts and joins requests. A changed public page format exposes an error and official-gallery link without blocking conversations. Listing or a declared version range does not establish compatibility of every package with the selected Pi.

Pi 0.99.1 RPC supports `select`, `confirm`, `input`, `editor`, notifications and text status/widget output. `ctx.ui.custom()` returns `undefined`; arbitrary TUI components and custom tool renderers cannot become web UI automatically. Packages with browser interfaces may open their own local page; other terminal-only workflows use native Pi. Desktop does not invent a shared configuration schema for arbitrary extension-owned files. See [Pi RPC UI documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md).

<a id="verification"></a>
## Verification

The [configuration test](../../apps/pi-dsh/tests/agent-configuration.test.ts) exercises native install/discovery/filter/update/removal and preservation. The [package-process test](../../apps/pi-dsh/tests/package-operation.test.ts) checks noisy package-manager output and cancellation of a descendant that ignores SIGTERM. [Packaged-worker checks](../../apps/pi-dsh/tests/packaged-provider.test.ts) require the actual Resources worker.

With the exact default versions installed in a separate directory, set `PI_DSH_TEST_EXTENSION_ROOT` to its `node_modules` and run `node --import tsx --test apps/pi-dsh/tests/community-extensions.test.ts`. This check uses actual Pi and the published packages with a scripted local provider; it verifies todo, the RPC questionnaire, a real foreground child and rejection of private web targets without provider credentials. Without that directory it explicitly skips. macOS browser acceptance additionally fetched a public page through the actual web extension. This does not establish every community feature, TUI equivalence, third-party login or Windows/Linux execution.

`node --import tsx --test apps/pi-dsh/tests/marketplace.test.ts apps/pi-dsh/tests/agent-configuration.test.ts apps/pi-dsh/tests/records.test.ts` checks gallery parsing, mixed-resource manifests, caching, request cancellation, native skill filters and message projection. macOS browser acceptance installed `pi-tandem@0.6.4` through the GUI in an isolated profile, inspected and toggled its seven skills, then invoked `/skill:writing` through actual Pi 0.99.1 with a local scripted provider and real file/shell tools. Title projection preserved the native JSONL content. This does not establish every extension feature of that package or compatibility with other Pi releases.

## Dev Note

With `PI_DSH_TEST_SEARCH_EXTENSION` pointing to `pi-web-search@1.5.0` and the extension root above containing `pi-web-access@0.35.0`, run `node --import tsx --test apps/pi-dsh/tests/extension-parity.test.ts`. `PI_DSH_TEST_PI_CLI` optionally selects an explicit official CLI entry. On macOS, Pi 0.99.1/0.99.2 rejected duplicate `web_search` at cold startup, but completed a conversation after native reload with the first search tool and the second package's `fetch_content`. Distinct configured tool names also passed cold CLI/RPC conversation checks. These results do not establish full 0.99.2 SDK compatibility.

Run `node --import tsx --test apps/pi-dsh/tests/resource-recovery.test.ts` for native duplicate-tool execution, reload dialog/command exclusion, history preservation, typed Host failures, explicit recovery, real file writes and failed-restoration fallback. Native afterPack runs it against the compiled Resources extension.
