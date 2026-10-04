# Pi-DSH

English | [中文](README.zh.md)

A desktop and local Web workspace for the [Pi Coding Agent](https://github.com/earendil-works/pi), built with the UI components of DeepSeek Harness. Bring Pi's extensibility, native sessions and coding tools to a graphical interface—or use the same workspace in your local browser.

![Pi-DSH workspace with a local demo provider](docs/assets/pi-dsh-workspace.png)

## Shared Desktop and Web features

Both interfaces use the same Pi integration and provide these core features:

- **Pi's plugin ecosystem.** Browse the [Pi package gallery](https://pi.dev/packages), install packages from npm, Git or local paths, and manage extensions, skills and prompt templates. Custom tools, slash commands and standard Pi dialogs work through the native runtime. [Compatibility details](docs/pi-desktop/extensions.md).
- **Branch and resume conversations.** Explore Pi's session tree, continue from an earlier user or assistant message, fork a new chat, and reopen native Pi history.
- **Stay in control during a task.** Steer the current run, queue follow-up messages, stop execution, and compact context through Pi's own controls.
- **Choose your model and thinking level.** Configure providers, use Pi-supported API-key or OAuth login, and carry your last model and thinking level into new chats.
- **A practical coding workspace.** Project-grouped history, model-generated chat titles, streaming Markdown and math, file and diff previews, Git controls, terminals, and spreadsheet/document previews.
- **Local files and applications.** Choose a project folder, open files in an installed editor or the system default app, show them in the file manager, copy paths and download files. Open project folders in installed editors or terminals on the computer running Pi-DSH.

Desktop uses native folder and application pickers; Web provides folder browsing and creation plus a list of installed applications. Local application actions are hidden on SSH and headless hosts. The Browser panel uses isolated native tabs on Desktop and sandboxed embeds on Web; sites that block embedding can open externally.

Pi runs independently and stays unmodified. Compatible Pi upgrades do not require rebuilding Pi-DSH. Packages that depend on custom terminal interfaces still need the Pi terminal; they do not automatically become desktop widgets.

## Quick start

Requires Node **22.19+ in the 22.x series, or 24+**, and **pnpm 11.7.0**. From a checkout of `pi-dsh`:

```sh
pnpm install
pnpm pi:install 0.99.1
```

**Desktop:**

```sh
pnpm dev:desktop
```

**Local Web with live reload:**

```sh
pnpm dev:web
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). Keep the terminal running; press Ctrl+C to stop the server.

**Local Web from a build:**

```sh
pnpm build
pnpm start:web
```

Open [http://127.0.0.1:19388](http://127.0.0.1:19388). Run one Web mode at a time: both use Host port `19388` by default. An installed Desktop app also provides **File → Open in Browser** to use its running Host and selected runtime.

In either interface, open **Settings → Models and providers** to connect a model, choose a project, and send a message. Both use Pi's native configuration and session storage; GUI preferences and project lists are shared when the Hosts use the same `PI_DESKTOP_HOME`.

macOS, Windows and Linux packaging targets are included; current hands-on desktop validation is on macOS arm64. See [setup and upgrades](docs/pi-desktop/README.md) for packaging, runtime selection and platform limits.

## Contribute

See [contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), [testing](docs/testing.md) and [safety](SAFETY.md). Pi and its extensions run with your user permissions.

## License and credits

[MIT](LICENSE). Pi-DSH is an independent community project built on [Pi](https://github.com/earendil-works/pi) and components from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Upstream copyrights and [third-party notices](THIRD_PARTY_NOTICES.md) are preserved.

Questions, ideas and bug reports are welcome—please open an issue!
