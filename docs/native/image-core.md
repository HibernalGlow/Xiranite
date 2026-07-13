# Image native core

The native image integration is intentionally split into two layers:

- `native/core`: pure Rust business logic. It does not depend on Node, Bun, N-API, Tauri, Wails, or a C ABI.
- `native/node`: a thin N-API adapter that converts JavaScript values and runs blocking core work on the N-API worker pool.

The published `czkawka_core` 10.0.0 source is vendored under `native/vendor/czkawka_core` because that crate contains the actual Czkawka algorithms. The vendored manifest adds an Xiranite build split: a dependency with `default-features = false` compiles only the duplicate finder, while the `full` default feature retains all upstream tools and optional heavy dependencies. Source for every upstream tool remains vendored for later API expansion.

The ArcThumb 0.10.1 source was reduced to its archive/ebook detection, cover selection, bounded image decode, and resize pipeline. Its WIC AVIF/JXL backend is enabled for Windows Node builds. Explorer COM handlers, registry integration, overlays, logging, and the Slint UI are not included.

## Build

```powershell
bun --cwd packages/image-native run build:native
bun --cwd packages/image-native run build
```

The first command builds `native/node` and copies the platform-specific dynamic library to the package as a `.node` file. Generated binaries and Cargo targets are ignored; all Rust source needed to rebuild them is tracked.

## API boundary

- `getCoreInfo()` reports embedded upstream versions and supported archive families.
- `createArchiveThumbnail(options)` returns encoded bytes plus source metadata.
- `scanDuplicateFiles(options)` exposes the first Czkawka core operation without importing the Tauri command/state layer.

An optional future `native/ffi` crate can depend on `native/core` and export a C ABI `cdylib`. It should own all returned allocations and provide matching free functions. It must not move Node-specific types or runtime callbacks into the core crate.

## Upstream licenses

- Czkawka core 10.0.0: MIT (`native/vendor/czkawka_core/LICENSE_MIT`).
- ArcThumb 0.10.1: MIT OR Apache-2.0 (`native/core/ARCTHUMB-LICENSE-*`).
