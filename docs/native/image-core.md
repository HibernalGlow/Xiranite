# Split native image APIs

Czkawka is compiled as a Node-API module. ArcThumb used to sit beside it as a second, unrelated core:

- `native/czkawka-core`: pure Rust duplicate-file scanning API.
- `native/czkawka-node`: thin asynchronous N-API adapter for Czkawka.

The TypeScript loaders follow the same boundary:

- `@xiranite/czkawka-native` loads `xiranite-czkawka.<platform>-<arch>.node`.

All development bindings and native DLL dependencies are written to `native/artifacts/<platform>-<arch>`. Package directories contain only TypeScript APIs, scripts, and tests. Wails builds embed the checked assets from `native/prebuilt/<platform>-<arch>`, and the loader shares the same environment override, development artifact, and embedded cache resolution contract through `@xiranite/native-loader`.

XLchemy is intentionally outside this Node-API workspace. It loads the system-installed `C:\Windows\System32\slimg_cffi.dll` through Bun FFI and runs independent single-threaded conversions in a bounded Worker pool. `SLIMG_CFFI_PATH` overrides the DLL path. This restores the lower-memory backend used before the slimg Node-API integration while retaining host memory protection and streaming scheduling.

`native/czkawka-core` uses the published `czkawka_core` 10.0.0 crate with `default-features = false` and enables `libavif`. Keep the upstream algorithms as a versioned crates.io dependency; vendor them only if Xiranite must carry an unreleased core patch.

## Build

```powershell
bun run --cwd packages/czkawka-native build:native
bun run --cwd packages/czkawka-native build
```

Generated `.node` binaries under `native/artifacts` and Cargo targets are ignored. `czkawka_core` is a locked crates.io dependency.

## API boundary

- Czkawka: `getCzkawkaInfo()` and `scanDuplicateFiles(options)`.
- Czkawka recycle bin: `getTrashCapabilities()`, `trashPath()`, `listTrashItems()` and
  `restoreTrashItem()` (`packages/czkawka-native/src/index.ts:107-110`).

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
> 全仓 `arcthumb` 的引用面（排除 `target/`、`vendor/`、锁文件）在拆岛前是：四个包目录自身、
> `native/Cargo.toml:2` 的 members、根 `package.json:191`、`docs/xiranite-target-node-manifest.json`
> 的 arcthumb 记录（`note` 那句「stay as NeoView's thumbnail host service」与 `keptReferences` 三条）、
> `docs/cross-platform-release.md:47`、`AGENTS.md`、`docs/adr/{0064,0069}`、`docs/migration/node-native-shape.{md,json}`，
> 以及仓库根那份日期化的发布笔记 `修改跨平台发布配置_2026-09-24_02-04.md`（用户自己的记录，不动）。
> `crates/xiranite-node-runtime/Cargo.toml` 里那句「base64 已在图里（native/arcthumb-core）」已按
> HEAD 的 `Cargo.lock` 改成实测事实：0.22 由 tauri-codegen/wry/usvg/image_hasher 等 9 个包提供，
> 而 `native/` 本来就是独立 workspace，从来没有进过根图。

>
> **死岛已在 2026-10-06 拆完**（`6973d4c4`，46 个路径，+19 / −6768）：`native/arcthumb-core/`（23）、
> `native/arcthumb-node/`（3）、`packages/arcthumb-native/`（7）、`packages/image-native/`（6）
> 共 39 个跟踪文件删除（磁盘上原是 41，多出的两份是未跟踪的 `.turbo/turbo-build.log`），
> 连同 `native/Cargo.toml:2` 的 members 两名、根 `package.json` 那条 workspace 依赖、
> 两份锁、清单的 arcthumb 记录（`note` 改事实、三条 `keptReferences` 删除、neoview 的
> 「image-native 是唯一存活 importer」证据行去掉）、本文件的 ArcThumb 半壁。
> `@xiranite/image-native` 是纯兼容门面，实测零 import 者，而它是 `@xiranite/arcthumb-native`
> 唯一的 importer——门面和它包的那条依赖一起走。
> 预置产物与资产表在更早一笔 `3911afca`（1.47 MB 的 win32 zip + manifest 那条资产记录 +
> `build-native-assets.ts` 的 bindings 行与 `infoMethod` 里只被表驱动臂照到的 `getArcThumbInfo` +
> `smoke-embedded.mjs` 的 spec）。
>
> 留两条实测给下一个动共享锁的人：
> - `native/Cargo.lock` 的差集是 **−358 / +8**（两个 stanza 之外还带走只被 ArcThumb 用的 `encoding`
>   家族与 `bit-set`/`bit-vec`；+8 是 `indexmap` 双版本收敛后的引用重编号），只能由 `cargo metadata`
>   重新生成，手删 stanza 会留下悬空引用。
> - `bun.lock` 的差集是 **−26 / 0**（两个 workspace 块、根那条 dependency、pkg map 两行）。
>   直接跑 `bun install --lockfile-only` 会把**别的泳道在飞的 `package.json` 改动**一起写进锁
>   （实测多出 `@lumino/*` 那 18 行与一条 host-capabilities 解析行），所以这条锁是把 `HEAD:bun.lock`
>   按同一份差集摘出来的——摘完与生产者输出逐行比过，只差那条别人的 host-capabilities 行。
>   提交前用 `bun install --frozen-lockfile --dry-run`（rc=0，不改盘）证「声明与锁成对」，
>   提交后把备份原样归还，他泳道在飞的 diff 逐行回到改前（按 sha256 比过）。
>   `docs/migration/node-native-shape.{md,json}` 不用重跑生产者：那两份 ast-grep 产物里 `thumbnail`
>   已写着 **0**，也没有门禁读它（消费者扫描 rc=1，同类产物名的阳性对照 rc=0）。
>
> 复核命令：`cargo metadata --locked`（根与 `native/` 各一次）+ `bun run audit:target-node-manifest`
> + `rg -l arcthumb` 排除 `docs/`、`AGENTS.md` 与仓库根那份用户笔记后为 0（阳性对照：删除前同一条
> 扫描命中 39 个包内文件与根 `package.json`）。


The environment override is `XIRANITE_CZKAWKA_NATIVE_PATH`. `XIRANITE_NATIVE_ARTIFACT_ROOT` overrides the shared development artifact root, and `XIRANITE_NATIVE_ASSET_ROOT` points packaged runtimes to the embedded manifest.

Future C ABI crates should stay independent: `czkawka-ffi` depends on `czkawka-core`, and nothing reaches across into another core.

## Upstream licenses

- Czkawka core 10.0.0: MIT (published crate metadata and upstream repository).
