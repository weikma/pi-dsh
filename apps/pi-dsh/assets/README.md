# Pi brand assets

English | [中文](README.zh.md)

The shared [pi-mark.svg](pi-mark.svg) is the official three-color pixel logo downloaded from the [Pi Press Kit](https://pi.dev/press-kit) at [logo.svg](https://pi.dev/logo.svg) on 2026-09-30. The downloaded bytes have SHA-256 `abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b`; `logo-auto.svg` contains the same artwork. The local copy changes only the viewBox to crop transparent outer padding for compact GUI use.

The sidebar, welcome screen and browser favicon use this SVG. Native application PNGs and Windows launcher/tray ICOs are generated from it with `pnpm icons:generate`; application icons retain a light rounded tile, while the tray mark remains transparent. macOS uses the same generated application image for the running Dock icon. No Pi runtime import is involved.

The official Press Kit identifies its assets as MIT. [LICENSE.pi.txt](LICENSE.pi.txt) retains the official website's MIT notice from [its fixed license source](https://github.com/earendil-works/pi-website/blob/2f5e410b97474d0a34ec2500aa1aa58d6c3f992c/LICENSE). The colored SVG is recorded by its current official URL and content hash; it is not attributed to that archived website revision.
