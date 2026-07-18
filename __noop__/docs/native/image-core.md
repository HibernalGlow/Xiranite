# Split native image APIs

ArcThumb and Czkawka are compiled as independent Node-API modules. They do not share a Rust core crate or a dynamic library:

- `native/arcthumb-core`: pure Rust archive/ebook cover extraction and thumbnail generation.
- `native/arcthumb-node`: thin asynchronous N-API adapter for ArcThumb.
- `native/czkawka-core`: pure Rust duplicate-file scanning API.
- `native/czkawka-node`: thin asynchronous N-API adapter for Czkawka.

The TypeScript loaders follow the same boundary:

- `@xiranite/arcthumb-native` loads `xiranite-arcthumb.<platform>-<arch>.node`.
- `@xiranite/czkawka-native` loads `xiranite-czkawka.<platform>-<arch>.node`.
- `@xiranite/image-native` is a compatibility facade that re-exports both packages. New code should import the specific package it uses.

The published `czkawka_core` 10.0.0 source is vendored under `native/vendor/czkawka_core` because that crate contains the actual Czkawka algorithms. An Xiranite dependency with `default-features = false` compiles only the duplicate finder. The remaining upstream source stays vendored for later expansion.

The ArcThumb 0.10.1 source is reduced to archive/ebook detection, cover selection, bounded image decode, and resize logic. WIC remains enabled only in the Windows ArcThumb Node build for AVIF/JXL decoding. Explorer COM handlers, registry integration, overlays, logging, and the Slint UI are not included.

## Build

```powershell
bun run --cwd packages/arcthumb-native build:native
bun run --cwd packages/czkawka-native build:native
bun run --cwd packages/arcthumb-native build
bun run --cwd packages/czkawka-native build
bun run --cwd packages/image-native build
```

For compatibility, `bun run --cwd packages/image-native build:native` builds both native modules. Generated `.node` binaries and Cargo targets are ignored; all Rust source required to rebuild them is tracked.

## API boundary

- ArcThumb: `getArcThumbInfo()` and `createArchiveThumbnail(options)`.
- Czkawka: `getCzkawkaInfo()` and `scanDuplicateFiles(options)`.
- Compatibility facade: deprecated `getCoreInfo()` and `loadNativeBinding()` plus all direct exports.

The independent environment overrides are `XIRANITE_ARCTHUMB_NATIVE_PATH` and `XIRANITE_CZKAWKA_NATIVE_PATH`.

Future C ABI crates should remain independent as well: `arcthumb-ffi` can depend on `arcthumb-core`, while `czkawka-ffi` can depend on `czkawka-core`.

## Upstream licenses

- Czkawka core 10.0.0: MIT (`native/vendor/czkawka_core/LICENSE_MIT`).
- ArcThumb 0.10.1: MIT OR Apache-2.0 (`native/arcthumb-core/ARCTHUMB-LICENSE-*`).
