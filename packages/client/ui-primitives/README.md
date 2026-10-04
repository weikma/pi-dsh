---
description: "Reusable React controls and transcript renderers for Pi Desktop and local Web."
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-primitives

English | [中文](README.zh.md)

## Summary

Build controls and render agent output with the retained React primitives: buttons, inputs, menus, modals, icons, Markdown, code, terminal output, and file cards. Callers supply localized labels and the application's `--dsw-*` design tokens. This private source library contains no agent execution or Cordis registration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import named components from the package's [source entry](src/index.ts). Pi Desktop's Vite build bundles the TypeScript, React, and CSS modules directly; the library has no separate executable, plugin-install command, or generated `lib/` entry. Keep labels and accessible names in the consuming application's typed locale dictionary.

`MarkdownText` renders closed inline formulas during streaming. Display formulas and `math` fences render their current body whenever KaTeX can parse it; parse errors stay hidden until the message finishes. Ordinary code remains literal. Existing `$…$`, `$$…$$`, `\(…\)` and `\[…\]` notation keeps its settled meaning.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The controls own local browser interaction and rendering. Feature state and callbacks come from the caller. Markdown navigation is delegated through `MarkdownDelegateProvider`; tool cards render supplied content without executing tools. Component props and behavioral requirements are documented beside their exports.

The streaming parser keeps open display formulas in its mutable tail, including their blank lines. Stable source keys and memoized formula components preserve rendered math across later text updates. [Streaming math tests](tests/markdown-streaming-math.client.spec.tsx) cover delimiter completion, malformed TeX, incremental boundaries and render reuse; `pnpm test:ui` includes these checks and the Markdown DOM fixtures.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi Desktop setup](../../../docs/pi-desktop/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Consumers need a browser bundler that handles CSS modules and the application's design-token styles.
- The library supplies presentation only; the bridge and Host own Pi commands, process lifecycle, and file access.

<a id="dev-note"></a>
### Dev Note

None.
