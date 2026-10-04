---
description: "Browser-safe filename suffix mapping for syntax-highlighted GUI previews."
kind: "package-library"
---

# @deepseek-ai/dsh-util-code-language

English | [中文](README.zh.md)

## Summary

Select a syntax-highlighting language from a filename with `languageForPath`. `CODE_HIGHLIGHT_EXTENSIONS` exposes the curated suffix set. The private source library is stateless and leaves grammar loading and tokenization to its consumer.

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

Import the mappings from the [source entry](src/index.ts). The GUI bundles this TypeScript source directly and renders an unrecognized suffix as plain text. The library has no plugin configuration, native dependency, or executable.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

Language selection reads the final path segment and matches its suffix case-insensitively. POSIX and Windows separators are accepted. The same table supplies compatibility hint helpers without reading files or executing a highlighter.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi DSH setup](../../../docs/pi-dsh/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The table matches suffixes, without content inspection or general filename rules.
- Consumers must load the returned grammar; an unknown or unavailable grammar remains plain text.

<a id="dev-note"></a>
### Dev Note

None.
