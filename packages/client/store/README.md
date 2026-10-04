---
description: "React-free observable snapshots and immutable updates for GUI state."
kind: "package-library"
---

# @deepseek-ai/dsh-client-store

English | [中文](README.zh.md)

## Summary

Create observable GUI state with `createSnapshotStore` and declarative action sets with `defineStore`. Subscribers read cached snapshots and unsubscribe explicitly. The private source library uses Zustand and Immer without importing React, Cordis, Pi, or the removed Harness runtime.

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

The package [source entry](src/index.ts) exports the engine and its [typed interfaces](src/contract.ts). The application bundles those sources directly. Own each store instance with the corresponding GUI lifetime and release subscriptions when that lifetime ends. This library has no profile, plugin activation, or executable.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

Updates produce new immutable values; selectors and subscriber notification remain independent of React. Notification is synchronous by default, with optional animation-frame batching. Optional persistence writes whole JSON values to browser localStorage; unavailable storage disables persistence without preventing in-memory updates.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi DSH setup](../../../docs/pi-dsh/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Stored values must be JSON-serializable when browser persistence is enabled.
- GUI stores do not represent Pi credentials, native session storage, or authoritative model context.

<a id="dev-note"></a>
### Dev Note

None.
