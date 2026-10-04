---
description: "Tab, split-pane, and floating-panel layout components with reversible operations."
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-dockkit

English | [中文](README.zh.md)

## Summary

Build tabbed, split, and floating layouts with `DockController` and the React docking components. The embedding GUI provides localized labels, tab content, and interaction callbacks. The private source library treats tab kinds as opaque values and owns no agent or session execution.

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

Use the [source entry](src/index.ts) and the [embedding interfaces](src/contract/adapter.ts). The application bundles TypeScript and the kit's CSS module directly. A controller belongs to one docking surface; consumers subscribe to its snapshots and release their subscriptions with that surface. This library has no standalone executable or plugin activation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The planner turns settled gestures into layout operations, and the sequencer supports undo and redo. React components render the resulting tree. The kit does not interpret the content of a tab; the embedding application's renderer does.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi DSH setup](../../../docs/pi-dsh/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Consumers must provide every visible and accessible label and a browser bundler supporting CSS modules.
- Layout history changes GUI arrangement; it does not fork, undo, or resume a Pi conversation.

<a id="dev-note"></a>
### Dev Note

None.
