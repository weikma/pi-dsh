---
description: "Compile-time string and number brands for otherwise confusable GUI values."
kind: "package-library"
---

# @deepseek-ai/dsh-brand

English | [中文](README.zh.md)

## Summary

Give distinct string or number domains separate TypeScript types with `Branded`, `BrandedNumber`, `brandString`, and `brandNumber`. The helpers preserve the original primitive values. This private source library has no dependencies, shared registry, or runtime state.

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

Import the types and helpers from the [source entry](src/index.ts). The domain owner declares its brand and validates input before branding it. The application consumes the TypeScript source directly; there is no generated library artifact or executable.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

A module-private symbol gives each primitive an intersection type. TypeScript removes that symbol from the emitted program, and both constructors return their input unchanged. Comparison, logging, and JSON serialization keep ordinary primitive behavior.

</details>

<a id="further-exploration"></a>
## Further Exploration

[Pi Desktop setup](../../../docs/pi-desktop/README.md) describes the consuming application and runtime ownership.

<a id="model-experience"></a>
## Model Experience

The library contributes no tools, prompts, or session events to a model.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Brands provide compile-time distinctions; constructors do not validate strings or numeric ranges.
- Arithmetic returns ordinary numbers, so the domain owner must validate a result before branding it again.

<a id="dev-note"></a>
### Dev Note

None.
