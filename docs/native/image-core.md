# Split native image APIs

ArcThumb, Czkawka, and slimg are compiled as independent Node-API modules. They do not share a Rust core crate:

- `native/arcthumb-core`: pure Rust archive/ebook cover extraction and thumbnail generation.
- `native/arcthumb-node`: thin asynchronous N-API adapter for ArcThumb.
- `native/czkawka-core`: pure Rust duplicate-file scanning API.
- `native/czkawka-node`: thin asynchronous N-API adapter for Czkawka.
- `native/slimg-node`: bounded multi-file N-API adapter over the published `slimg-core` crate.

The TypeScript loaders follow the same boundary:

- `@xiranite/arcthumb-native` loads `xiranite-arcthumb.<platform>-<arch>.node`.
- `@xiranite/czkawka-native` loads `xiranite-czkawka.<platform>-<arch>.node`.
- `@xiranite/slimg-native` loads `xiranite-slimg.<platform>-<arch>.node`.
- `@xiranite/image-native` is a compatibility facade that re-exports both packages. New code should import the specific package it uses.

All development bindings and native DLL dependencies are written to `native/artifacts/<platform>-<arch>`. Package directories contain only TypeScript APIs, scripts, and tests. Wails builds embed the checked assets from `native/prebuilt/<platform>-<arch>`, and all three loaders share the same environment override, development artifact, and embedded cache resolution contract through `@xiranite/native-loader`.

`native/czkawka-core` uses the published `czkawka_core` 10.0.0 crate with `default-features = false` and enables `libavif`. Keep the upstream algorithms as a versioned crates.io dependency; vendor them only if Xiranite must carry an unreleased core patch.

The ArcThumb 0.10.1 source is reduced to archive/ebook detection, cover selection, bounded image decode, and resize logic. WIC remains enabled only in the Windows ArcThumb Node build for AVIF/JXL decoding. Explorer COM handlers, registry integration, overlays, logging, and the Slint UI are not included.

## Build

```powershell
bun run --cwd packages/arcthumb-native build:native
bun run --cwd packages/czkawka-native build:native
bun run --cwd packages/slimg-native build:native
bun run --cwd packages/arcthumb-native build
bun run --cwd packages/czkawka-native build
bun run --cwd packages/slimg-native build
bun run --cwd packages/image-native build
```

For compatibility, `bun run --cwd packages/image-native build:native` builds ArcThumb and Czkawka. Generated `.node` binaries under `native/artifacts` and Cargo targets are ignored. `slimg-core` and `czkawka_core` are locked crates.io dependencies; ArcThumb remains local because it has no published core crate.

## API boundary

- ArcThumb: `getArcThumbInfo()` and `createArchiveThumbnail(options)`.
- Czkawka: `getCzkawkaInfo()` and `scanDuplicateFiles(options)`.
- slimg: `getSlimgInfo()` and `convertBatch(options)`.
- Compatibility facade: deprecated `getCoreInfo()` and `loadNativeBinding()` plus all direct exports.

The independent environment overrides are `XIRANITE_ARCTHUMB_NATIVE_PATH`, `XIRANITE_CZKAWKA_NATIVE_PATH`, and `XIRANITE_SLIMG_NATIVE_PATH`. `XIRANITE_NATIVE_ARTIFACT_ROOT` overrides the shared development artifact root, and `XIRANITE_NATIVE_ASSET_ROOT` points packaged runtimes to the embedded manifest.

Future C ABI crates should remain independent as well: `arcthumb-ffi` can depend on `arcthumb-core`, while `czkawka-ffi` can depend on `czkawka-core`.

## Upstream licenses

- Czkawka core 10.0.0: MIT (published crate metadata and upstream repository).
- ArcThumb 0.10.1: MIT OR Apache-2.0 (`native/arcthumb-core/ARCTHUMB-LICENSE-*`).
