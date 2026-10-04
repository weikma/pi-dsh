---
description: "Browser-safe lexical paths and display labels for project files."
kind: "package-library"
---

# @deepseek-ai/dsh-util-workspace-path

English | [中文](README.zh.md)

## Summary

Join relative paths, split directory and filename labels, abbreviate POSIX homes, and derive project titles with the [path helpers](src/index.ts). This private source library accepts POSIX and Windows path spelling without accessing a filesystem. Its string-address helpers do not grant file access.

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

Import helpers from the [source entry](src/index.ts); the GUI bundles the TypeScript source directly. Use `pathPartsOf` for compact path labels and `relativizeToCwd` for display. Keep filesystem resolution and access checks in the Host. There is no service registration or executable.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The helpers operate on strings and preserve the caller's separator conventions. [File-address utilities](src/file-address.ts) retain their literal address grammar, but install no URI handler and authorize no session. The Pi GUI's Host remains responsible for opening a file.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi Desktop setup](../../../docs/pi-desktop/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Path joins are lexical and do not resolve symlinks or canonicalize filesystem locations.
- Home abbreviation applies to POSIX spelling only.

<a id="dev-note"></a>
### Dev Note

None.
