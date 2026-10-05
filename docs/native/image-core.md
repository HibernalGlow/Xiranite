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

> **上面那半段在 2026-10-06 已经不成立了**，按实测重写：ArcThumb 一侧的消费者**全部为 0**。
> 逐条复核过（`[ -e ]` 实测，四条声称的消费者都在工作区里不存在）：`packages/nodes/neoview/`、
> `src/nodes/neoview/`、`packages/nodes/czkawka/src/platform.ts` 都已随节点出局而删除。
> 同一条扫描的阳性对照是 `@xiranite/czkawka-native`：`packages/file-operations/src/platform.ts:11`
> 仍然引它，所以 czkawka 那一侧活着，ArcThumb 这一侧没有——两者不对称，别一起留。
> 全仓 `arcthumb` 的引用面（排除 `target/`、`vendor/`、锁文件）在本笔之后是：四个包目录自身、
> `native/Cargo.toml:2` 的 members、根 `package.json:191`、`docs/xiranite-target-node-manifest.json`
> 的 arcthumb 记录（`note` 那句「stay as NeoView's thumbnail host service」与 `keptReferences` 三条）、
> `docs/cross-platform-release.md:47`、`AGENTS.md`、`docs/adr/{0064,0069}`、`docs/migration/node-native-shape.{md,json}`，
> 以及仓库根那份日期化的发布笔记 `修改跨平台发布配置_2026-09-24_02-04.md`（用户自己的记录，不动）。
> `crates/xiranite-node-runtime/Cargo.toml` 里那句「base64 已在图里（native/arcthumb-core）」已按
> HEAD 的 `Cargo.lock` 改成实测事实：0.22 由 tauri-codegen/wry/usvg/image_hasher 等 9 个包提供，
> 而 `native/` 本来就是独立 workspace，从来没有进过根图。

>
> **待删的死岛（41 个跟踪文件）**：`native/arcthumb-core/`（23）、`native/arcthumb-node/`（3）、
> `packages/arcthumb-native/`（8）、`packages/image-native/`（7）。`@xiranite/image-native` 是纯兼容门面，
> 实测没有任何 import 者（`rg 'image-native'` 只命中它自己的三个文件），而它是 `@xiranite/arcthumb-native`
> 唯一的 importer——所以门面和它包的那条依赖一起走。
> 已先落一笔的是预置产物与资产表（`3911afca`，1.47 MB 的 `native/prebuilt/win32-x64/arcthumb.win32-x64.zip`
> + `manifest.json` 那条资产记录 + `build-native-assets.ts` 的 bindings 行与 `infoMethod` 里只被表驱动臂
> 照到的 `getArcThumbInfo` + `smoke-embedded.mjs` 的 spec）。
>
> **剩下这一批为什么还没走**：它必须和三个正被别人泳道持有的文件同批——`package.json:191`
> 声明 `"@xiranite/arcthumb-native": "workspace:*"`（包删了而声明还在，`bun install` 对所有人都红），
> 以及两份锁。`but commit` 按整文件收，提它们就把他泳道在飞的 4 处（`audit:danger-gate`、
> `@lumino/commands`、删 `@use-gesture/react`、删 `react-hotkeys-hook`）算进本泳道，AGENTS.md 禁止。
>
> **批次已在仓库外的副本里跑通并量过**（2026-10-06，探针先证明自己能原样复现现状：
> `bun install --lockfile-only` 产出的锁与在飞的那份逐字节相同；native 侧 `cargo metadata` 产出的锁与
> `HEAD:native/Cargo.lock` 零差异），删除后的产物只有这些行：
> - `packages/*-native` 两目录删除 + `native/Cargo.toml:2` 的 members 去掉两名 + 两 crate 目录删除；
> - `docs/xiranite-target-node-manifest.json` 的 arcthumb 记录：`note` 改成事实（消费者已随 NeoView 归零、
>   岛已删），`keptReferences` 三条清空或改为「无存活引用」——这条不改，下一个读单一真源的人还会当它留着；
> - `docs/cross-platform-release.md:47` 的 napi 绑定清单去掉 arcthumb；
> - `bun.lock` **−28 行**（两个 workspace 块、根那条 dependency、pkg map 两行），
>   复跑 `bun install --frozen-lockfile` rc=0；
> - `native/Cargo.lock` **−358 / +8**（`xiranite-arcthumb-core`/`-node` 两个 stanza 之外，
>   还带走只被 ArcThumb 用的 `encoding` 家族、`bit-set`/`bit-vec` 等；+8 是 `indexmap` 双版本收敛后的
>   引用重编号）——**这份锁只能由 `cargo metadata` 重新生成，不许手删 stanza**；
> - 同步改掉本文件上面那段作废的「两个 core 都留」结论与 `packages/arcthumb-native` 的构建/覆盖说明行。
>
> 解锁条件（任一）：那条泳道把 `package.json`/`bun.lock`/`native/Cargo.lock` 落地；或用户同意把这三份
> 文件打包进本批。届时按上面六步一次做完，验证命令 = `bun install --frozen-lockfile` +
> `cargo metadata --locked`（根与 `native/` 各一次）+ `rg -l arcthumb` 排除 `docs/`、`AGENTS.md` 与
> 仓库根那份用户笔记后为 0。

The independent environment overrides are `XIRANITE_ARCTHUMB_NATIVE_PATH` and `XIRANITE_CZKAWKA_NATIVE_PATH`. `XIRANITE_NATIVE_ARTIFACT_ROOT` overrides the shared development artifact root, and `XIRANITE_NATIVE_ASSET_ROOT` points packaged runtimes to the embedded manifest.

Future C ABI crates should remain independent as well: `arcthumb-ffi` can depend on `arcthumb-core`, while `czkawka-ffi` can depend on `czkawka-core`.

## Upstream licenses

- Czkawka core 10.0.0: MIT (published crate metadata and upstream repository).
- ArcThumb 0.10.1: MIT OR Apache-2.0 (`native/arcthumb-core/ARCTHUMB-LICENSE-*`).
