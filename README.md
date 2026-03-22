# Digital Library

Offline desktop app for browsing a folder of PDFs and categories (subfolders). Built with Tauri 2: one codebase targets **Windows** (primary for testing), **macOS**, and **Linux**.

## Layout

- **Web UI:** `index.html`, `src/` (TypeScript + CSS), built with Vite into `dist/`.
- **Rust / Tauri:** `src-tauri/` — this is where **`Cargo.toml`**, `tauri.conf.json`, and `src/*.rs` live. `npm run tauri *` runs Cargo in that directory automatically.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- **Rust** — Tauri runs `cargo` under the hood. Install via [rustup](https://rustup.rs/) (recommended), then open a **new** terminal and confirm:

  ```bash
  cargo --version
  ```

  If that prints a version, `npm run tauri build` can find the toolchain. If you see `command not found` or Tauri reports `failed to run 'cargo metadata' … No such file or directory`, Rust is missing or not on your `PATH` (e.g. install rustup, or add `~/.cargo/bin` to `PATH` and restart the terminal).

- Platform extras from [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode CLT on macOS, MSVC on Windows, etc.).

## Development

```bash
npm install
npm run tauri dev
```

## Production builds

Build on the OS you are targeting (cross-compiling from one machine is possible but not covered here).

```bash
npm install
npm run tauri build
```

Artifacts appear under `src-tauri/target/release/bundle/`:

- **Windows:** `.msi`, `.exe` (NSIS), or similar depending on enabled targets
- **macOS:** `.dmg` / `.app`
- **Linux:** `.deb`, `.AppImage`, etc., per enabled bundle targets

`tauri.conf.json` sets `"bundle.targets": "all"` so each platform emits its native formats when you build there.

### What to send so people can “just click and open”

You have two realistic options:

| Goal | What you ship | What the user does |
|------|----------------|-------------------|
| **Full app** (opens PDFs/folders with Windows/macOS/Linux defaults) | The **installer or bundle** from `src-tauri/target/release/bundle/` after `npm run tauri build` on **that** OS | **Windows:** give them the `.msi` or NSIS `.exe` installer (one file they run once), or the generated setup as your release asset. **macOS:** share the `.dmg` or zip the `.app` from the bundle folder. **Linux:** share the `.AppImage` or `.deb`, depending on what was built. They double-click like any normal app — **no Node, no Cargo, no terminal.** |
| **Literally one file, no install** | [`standalone-library.html`](standalone-library.html) only | They save that single HTML file, open it in **Chrome or Edge** (File System Access API). They pick their library folder when prompted. PDFs open **in the browser**, not always in Adobe/system viewer; folders cannot open in Explorer/Finder from the browser. |

**You cannot** turn the Tauri app into one `.html` file — the desktop build is a **native binary** (plus optional installer). That is what non-technical users should use for “feels like a real app.”

**You** run `npm run tauri build` once per platform you support (e.g. build on Windows to produce the Windows installer, on Mac for `.dmg`/`.app`). End users never run `npm` or `cargo`.

## Settings and data

The chosen library folder path and recent searches are stored via the Tauri store plugin under the app data directory (platform-specific; not inside your book folder).

## Browser-only prototype

See `standalone-library.html`: open it in **Chrome** or **Edge** (File System Access API). It does not open files with external apps; PDFs open in the browser tab. Use the Tauri app for full “open with default application” behavior.

## Troubleshooting

| Symptom | Cause | What to do |
|--------|--------|------------|
| `failed to run 'cargo metadata' … No such file or directory` | `cargo` not installed or not on `PATH` | Install [rustup](https://rustup.rs/), run `cargo --version` in a new terminal, then retry `npm run tauri build`. |
| Build errors about missing Xcode / link.exe | Missing OS toolchain | Follow [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. |
