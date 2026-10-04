# Bundled auxiliary resources

`prepare-auxiliary.mjs` prepares the Python and Office portion of a target's runtime directory. `prepareAuxiliary({ target, output, cache })` returns the `auxiliary` field for the main `pi-desktop-runtime-v1` manifest; all manifest paths are relative to `output`. Node, official Pi, pnpm and executable search tools are prepared by the main bundle owner.

`auxiliary-lock.json` pins Python 3.12.14 from python-build-standalone release 20260901 and the complete numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml and XlsxWriter dependency set. Target-specific wheels cover macOS arm64/x64, Windows x64 and Linux arm64/x64. Downloads must match the recorded SHA-256 bytes; Python wheels retain their distribution metadata and auxiliary scripts without generating command wrappers.

The prepared directory contains `python/`, `office/skills/`, `office/scripts/check_office.py` and `pi/desktop-runtime.ts`. The last file is a public Pi extension, loaded from the official CLI's package directory so its public imports resolve against that runtime. It registers `load_workspace_dependencies` and discovers three Office skills through `resources_discover`. Tool results contain absolute interpreter, pnpm, library and checker paths. Pi records the tool output in its own transcript; the extension does not modify its execution loop, authentication or session files.

`smokeAuxiliary(runtimeRoot, auxiliaryManifest)` runs the native Python version, distribution-version checks, `pip check`, imports, Office document creation/reopening and the structural checker. Cross-target preparation does not execute another platform's interpreter. Native results, signing and installer validation must be recorded separately.

`pnpm runtime:prepare` assembles the native target; `pnpm test:runtime` checks its executables and libraries. `pnpm test` discovers `.desktop-build/runtime/<native-target>` for the real public-extension flow, with `PI_DESKTOP_TEST_RUNTIME` as an explicit override. Only an absent default payload skips that flow; an invalid explicit payload fails. The macOS arm64 flow has executed the returned Node/pnpm/Python paths, created and reopened an XLSX file, discovered the Office skills, and checked Pi's own JSONL tool record.

The Office checker verifies OOXML ZIP/XML structure and selected content. The Python libraries and checker do not render documents or recalculate spreadsheet formulas. Rendering and the Desktop viewer are separate features; these skills use only explicitly available rendering operations.
