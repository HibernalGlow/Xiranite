# Split native image APIs

ArcThumb and Czkawka are compiled as independent Node-API modules. They do not share a Rust core crate:

- `native/arcthumb-core`: pure Rust archive/ebook cover extraction and thumbnail generation.
- `native/arcthumb-node`: thin asynchronous N-API adapter for ArcThumb.
- `native/czkawka-core`: pure Rust duplicate-file scanning API.
- `native/czkawka-node`: thin asynchronous N-API adapter for Czkawka.

The TypeScript loaders follow the same boundary:

- `@xiranite/arcthumb-native` loads `xiranite-arcthumb.<platform>-<arch>.node`.
- `@xiranite/czkawka-native` loads `xiranite-czkawka.<platform>-<arch>.node`.
- `@xiranite/image-native` is a compatibility facade that re-exports both packages. New code should import the specific package it uses.

All development bindings and native DLL dependencies are written to `native/artifacts/<platform>-<arch>`. Package directories contain only TypeScript APIs, scripts, and tests. Wails builds embed the checked assets from `native/prebuilt/<platform>-<arch>`, and both loaders share the same environment override, development artifact, and embedded cache resolution contract through `@xiranite/native-loader`.

XLchemy is intentionally outside this Node-API workspace. It loads the system-installed `C:\Windows\System32\slimg_cffi.dll` through Bun FFI and runs independent single-threaded conversions in a bounded Worker pool. `SLIMG_CFFI_PATH` overrides the DLL path. This restores the lower-memory backend used before the slimg Node-API integration while retaining host memory protection and streaming scheduling.

`native/czkawka-core` uses the published `czkawka_core` 10.0.0 crate with `default-features = false` and enables `libavif`. Keep the upstream algorithms as a versioned crates.io dependency; vendor them only if Xiranite must carry an unreleased core patch.

The ArcThumb 0.10.1 source is reduced to archive/ebook detection, cover selection, bounded image decode, and resize logic. WIC remains enabled only in the Windows ArcThumb Node build for AVIF/JXL decoding. Explorer COM handlers, registry integration, overlays, logging, and the Slint UI are not included.

## Build

```powershell
bun run --cwd packages/arcthumb-native build:native
bun run --cwd packages/czkawka-native build:native
bun run --cwd packages/arcthumb-native build
bun run --cwd packages/czkawka-native build
bun run --cwd packages/image-native build
```

For compatibility, `bun run --cwd packages/image-native build:native` builds ArcThumb and Czkawka. Generated `.node` binaries under `native/artifacts` and Cargo targets are ignored. `czkawka_core` is a locked crates.io dependency; ArcThumb remains local because it has no published core crate.

## API boundary

- ArcThumb: `getArcThumbInfo()` and `createArchiveThumbnail(options)`.
- Czkawka: `getCzkawkaInfo()` and `scanDuplicateFiles(options)`.
- Czkawka recycle bin: `getTrashCapabilities()`, `trashPath()`, `listTrashItems()` and
  `restoreTrashItem()` (`packages/czkawka-native/src/index.ts:107-110`).
- ArcThumb thumbnails: `getCachedSystemThumbnail()`, `createWicImageThumbnail()` and the `*Encoded`
  variants (`packages/arcthumb-core`/`packages/arcthumb-native/src/index.ts:101-109`).
- Compatibility facade: deprecated `getCoreInfo()` and `loadNativeBinding()` plus all direct exports.

## Who consumes these cores, and what the rewrite must keep

Per ADR-0064 the `arcthumb` and `czkawka` **nodes** leave the product, but both native cores stay, because
live code outside those nodes depends on them:

- `@xiranite/arcthumb-native` powers NeoView's thumbnail path:
  `packages/nodes/neoview/package.json:54`,
  `packages/nodes/neoview/src/platform/windows/WindowsSystemThumbnailProvider.ts:94`,
  `packages/nodes/neoview/src/platform/images/WindowsWicImageTransformer.ts`, and the
  `nativeProbe` in `src/nodes/neoview/entry.ts:17`.
- `@xiranite/czkawka-native` is the recycle-bin service behind
  `packages/file-operations/src/platform.ts:3-11`, which every deletion path uses (cleanf, bandia,
  smartzip, enginev, `packages/repository`, `packages/backend`, `packages/api`).

Measured asymmetry worth stating: only the trash API has consumers outside the czkawka node.
`scanDuplicateFiles` is called from `packages/nodes/czkawka/src/platform.ts` plus that package's own
smoke and benchmark scripts and the deprecated `@xiranite/image-native` facade — so in the Rust rewrite,
`xiranite-core` must carry trash/restore/list, while duplicate scanning is not a capability to preserve.

The independent environment overrides are `XIRANITE_ARCTHUMB_NATIVE_PATH` and `XIRANITE_CZKAWKA_NATIVE_PATH`. `XIRANITE_NATIVE_ARTIFACT_ROOT` overrides the shared development artifact root, and `XIRANITE_NATIVE_ASSET_ROOT` points packaged runtimes to the embedded manifest.

Future C ABI crates should remain independent as well: `arcthumb-ffi` can depend on `arcthumb-core`, while `czkawka-ffi` can depend on `czkawka-core`.

## Upstream licenses

- Czkawka core 10.0.0: MIT (published crate metadata and upstream repository).
- ArcThumb 0.10.1: MIT OR Apache-2.0 (`native/arcthumb-core/ARCTHUMB-LICENSE-*`).
