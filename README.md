# Hardware Monitor

A new MyWallpaper add-on, built from the official Canvas scaffold. It displays real local Windows measurements in five layouts inspired by the supplied hardware-monitor reference. It does not depend on, import or reuse System Monitor.

## Presentation

- **Minimal bars** (default): four icons, values, progress bars and concise measurements.
- **Rings**: four vector gauges.
- **Live history**: the most recent 16 actual samples, with missing samples left empty.
- **CPU overview**: a prominent CPU gauge and three compact metric rows.
- **Compact strip**: a shallow panel for tight compositions.

CPU, GPU, memory and disk visibility, metric colours, text/background colours, opacity, corner radius and blur use the normal MyWallpaper settings. Layout and appearance belong to each layer; refresh rate and drive belong to the device. The panel fills its host layer up to 800 × 300 px (110 px high in compact mode). Below 410 px wide, rings use up to two columns when the layer is taller than 150 px; bars and history use up to two columns only when the layer is at least 320 px high. The host keeps ownership of placement, resizing, rotation and locking.

## What the values mean

- CPU: busy time from Windows counter deltas; the first sample waits for a baseline. Clock speed is the Windows-reported frequency, not a fabricated sensor measurement.
- GPU: the busiest aggregated engine of one hardware adapter, identified by its Windows LUID. On multi-GPU systems the adapter with the most dedicated memory is chosen. The detail shows dedicated VRAM capacity, not temperature.
- RAM: used and total physical memory.
- Disk: used and total capacity accessible to the current user. Empty drive setting selects the Windows system drive; a local drive letter such as `D:` selects another drive. It measures capacity, not disk activity, and does not assume the drive is an SSD.

Capacities use GiB/TiB. Unsupported GPU counters or unavailable drives show an em dash; failed or stale collection has an explicit status. CPU/GPU temperatures and power are intentionally absent: these require hardware-specific sensor support beyond the native Windows APIs used here. Illustrative values are restricted to MyWallpaper thumbnail mode and are labelled there.

## Runtime

Windows x86-64, MyWallpaper Desktop and its normal native companion consent are required for live measurements. The website can display catalogue thumbnails but cannot access Windows metrics. The companion uses the public `process-v2` protocol (version 5) and emits a versioned measurement payload. It reads counters and capacity only: no network requests, administrator privileges, installed driver, filesystem traversal or external telemetry service.

The frontend exports a synchronous `mount(context)` with disposal. One native sampler feeds all views, DOM nodes are reused, histories remain bounded, and only measurements trigger chart updates. Sampling can be set to 1, 2 or 5 seconds; 2 seconds is the default. Animations are short CSS transitions and respect reduced motion. The display passes pointer events through by default. Lifecycle subscriptions, timers and native connections are released when the host disposes the layer.

## Develop

Install Node 22.18+, pnpm, rustup and Visual Studio C++ build tools. The native build installs the pinned Rust 1.92.0 toolchain when absent, including on a fresh publication runner, and targets Windows x86-64 MSVC. Vite uses its native configuration loader, avoiding a redundant config bundling step. The dependency layout is hoisted so both Windows and WSL can read the same checkout without Linux-only package symlinks. Run `pnpm install` at the project root, then `mywallpaper dev`. This uses `mywallpaper.config.json` for both builds. Pair the session in MyWallpaper Desktop and accept native consent there; the CLI does not bypass those steps.

For a standalone visual preview after building the native companion, run `pnpm preview` and open <http://localhost:5196/preview.html>. It uses the real Windows binary and a loopback-only development endpoint. The preview runs a temporary executable copy and removes it on exit, so Windows does not lock the CLI's build output during rebuilds. The layout selector and “All layouts” control are preview tools, excluded from the production entry. `thumbnail.html` renders the actual production thumbnail lifecycle without starting the native sampler. WSL can run this Windows companion through normal interoperability; the preview sets execute permission on its temporary copy.

## Validate and publish

`pnpm build` checks TypeScript and builds the Canvas ESM/CSS bundle. `pnpm test` verifies its entry and stylesheet loading. `pnpm smoke:native` exercises the real Windows executable, payload validation, sampling-rate changes and clean shutdown. Native unit checks run with `cargo test --locked --target x86_64-pc-windows-msvc` in `native/companion`.

Use the canonical creator CLI/MCP for project checks, registration and tagged publication. The central platform rebuilds and validates the package; local preview success is not publication. Create the GitHub repository, push the reviewed commit/tag, register it and submit publication only after user approval. Retiring the former System Monitor is a separate approved catalogue operation; no old project or tag is silently overwritten.

## Source boundaries

`src/main.ts` is the sole production web entry. `src/model.ts`, `settings.ts`, `view.ts` and `icons.ts` hold the measurement contract, settings and rendering. `native/companion` owns Windows collection and wire framing. Generated bindings come from the official SDK. Build helpers are ordinary project tooling. Preview/thumbnail hosts and lifecycle checks are development-only; no Impeccable files or runtime dependency are required.
