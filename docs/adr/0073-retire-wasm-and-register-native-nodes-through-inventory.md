# Retire wasm and Extism: node cores are native crates registered through `inventory`

- Status: accepted
- Date: 2026-10-04
- Amendment note: this **reverses the execution layer of ADR-0063 and supersedes ADR-0071's runtime
  choice**, and it voids ADR-0070/ADR-0072's premises (a wasm guest's file handles and its
  enumeration cost) while keeping their measurements as the reason. It **keeps ADR-0069's four-face
  shape** (one business implementation; CLI, TUI, GUI are separate faces; GUI stays one Tauri app) and
  **keeps ADR-0068's Plugin API as a stable contract** — what goes away is its WIT-migratability
  clause, because that clause existed to serve a wasm boundary that is no longer being built. The
  vocabulary in `host_function_names.rs` is retired as a *boundary shape*; the permissions it encoded
  survive as policy (`NodeRequirements`).
- Related: `docs/adr/0063-…-extism.md`, `docs/adr/0068-…-extism-as-adapter.md`,
  `docs/adr/0069-…-clap-ratatui-react.md`, `docs/adr/0071-serve-node-file-io-through-wasi-preopens.md`,
  `docs/adr/0072-keep-recursive-directory-enumeration-on-the-host.md`,
  `docs/migration/extism-retirement-checklist.md`, `docs/migration/node-native-shape.json`,
  `docs/migration/dissolvef-native-port.md`

## Why, with the numbers that decided it

Measured on this machine on 2026-10-04 (macOS/arm64 APFS, `extism` 1.30.0,
`cargo build --target wasm32-wasip1`), all with interleaved repeats because single-shot timings on
this box lied:

- **A guest's directory walk is slow and superlinear.** `std::fs::read_dir` inside a wasip1 guest:
  22,000 entries over 2,000 directories = 421 ms (name+type only) and 691 ms (per-entry metadata),
  against 44 ms / 81 ms for the identical Rust source compiled natively. One directory holding
  16,000 entries = **2,291 ms vs 10 ms** (229x), and the per-entry cost grows with directory size:
  4,000 / 8,000 / 16,000 in one directory measured 221 / 693 / 2,291 ms — exponent ~1.7. Cause read
  from source: `wasi-common-43.0.2/src/sync/dir.rs:168-225` reopens the directory, calls
  `full_metadata()` for every entry, then `.enumerate().skip(cursor)` — resuming a listing replays and
  re-stats the prefix. 21 nodes carry their own `walk`/`listDir` helper (24 helpers, 262 lines).
- **A guest cannot spawn.** Measured: `std::process::Command` returns `Unsupported` inside Extism's
  WASI, which is why `xiranite.process.run` exists at all. `plugins/{soundw,samea,nameu,classq,transq}`
  already declare that capability while `xiranite-node-runtime`'s `SERVED_CAPABILITIES` does not
  include it — so those five nodes reach a `not_implemented` the moment they shell out. 30 retained
  nodes invoke an external binary (`ffmpeg`, `sox`, `7z`, `powershell.exe`, `pbpaste`).
- **A guest cannot reach the network.** `wasi-common-43.0.2/src/ctx.rs:21-33` has no address space at
  all, so Extism's WASI cannot serve `comfygure`'s WebSocket or `clipm`'s MCP-over-stdio.
- **A guest has no Windows path semantics.** Measured in the same guest: `is_separator('\\') = false`,
  `Path::new("C:\\windows\\system32").is_absolute() = false`, `"E:\\Users\\a"` parses as one
  component. Windows is the release gate, so every rename/move node would keep needing host-side
  path analysis — i.e. the boundary keeps leaking.
- **Per-node ABI tax.** `crates/nodes/dissolvef` is 5,675 lines, of which `host.rs` (841) +
  `in_memory_host.rs` (347) + `lib.rs` (59) are the shim and its double: roughly 1.2k lines per node,
  41 nodes still to go.

## What is given up, stated plainly

- **Preemption.** wasmtime's `fuel` (instruction budget), `epoch interruption` (timeout) and
  `ResourceLimiter` (linear-memory ceiling) are what ADR-0071 §3 measured at 962 µs and 505 ms, and
  what ADR-0066's cancellation backstop relies on. Native code has none of these.
  Honest status: **none of the three is currently wired up in this repo either** — `rg` over `crates/`
  for `with_fuel_limit`, `cancel_handle`, `PluginCancellationHandle` finds nothing, so today's cancel
  is already only the cooperative `checkpoint` poll (`capabilities.rs:280`). This ADR therefore does
  not lose a live guarantee; it does lose the ability to gain one cheaply later.
- **Fault isolation.** A panicking or hung node now takes the host process with it, which is the same
  trust level the TypeScript/Go backend had, and the reason third-party distribution is out of scope
  below.
- **WIT-migratability** (ADR-0068 clause 2) becomes moot rather than violated: there is no wasm
  boundary left to express.

## Decision

1. **A node is a Rust crate in the root workspace, linked into the host.** `crates/nodes/<id>/`
   stays the location; `[lib] crate-type = ["cdylib"]` and the wasm target go away.
2. **Registration is `inventory`.** `crates/xiranite-node-registry` (landed with this ADR) collects
   `NodeDescriptor { id, node_version, api_version, requirements }`; a node calls
   `register_node!` at its own definition site; `NodeRegistry::builtin()` returns a sorted lookup and
   **refuses a duplicate id** rather than letting link order decide. Tests in that crate prove both
   the collection path and the refusal, with the duplicate registration as the positive control.
   Chosen over third-party frameworks on measured grounds: `inventory` 0.3.24, 136M downloads,
   MSRV 1.68, README lists Windows and WebAssembly; `dtolnay/inventory` has 1,358 stars.
3. **`NodeRequirements` is policy, not ability.** Granted root *roles* (resolved per operation by the
   host), a `&'static` allowlist of external programs with a per-program confirmation flag, network
   hosts, an `enumerates_recursively` marker, and a byte/concurrency budget. The old capability
   vocabulary's permissions survive into these fields; its calling convention dies with it. This is
   also where `DangerGate` lives — on the registration, not on argv inspection.
4. **`xiranite.process.run` is never built.** Native nodes call `std::process::Command` against a
   program the registry says they may run. Same for network: `std`/`tokio` directly, gated by
   `NetworkAccess`.
5. **ADR-0071's retirement of `xiranite.fs.*` stands, and ADR-0072 becomes moot for new work.**
   Enumeration is no longer a host service a guest asks for; the node walks with `std::fs`, which the
   measurements above show is 4-5 µs/entry and linear. ADR-0072's duplication finding (24 helpers)
   still stands and is now fixed by one shared host-side walker used by all faces, not by an ABI.
6. **Order of work** (each step keeps the workspace buildable):
   1. registry crate (done here);
   2. `dissolvef` becomes the native pattern, guided by
      `docs/migration/dissolvef-native-port.md`;
   3. the **nine** `plugins/*` crates (`classq linedup logx nameu samea snf soundw timeu transq`) move to native
      crates in the workspace, and
      the TS node packages retire per ADR-0069's existing rule (only after the port runs and
      `docs/<node>-tui-visual-review.md` layout is reproduced);
   4. `xiranite-extism-adapter`, the wasm build script and the wasm-shaped gates are deleted once no
      consumer remains — see `docs/migration/extism-retirement-checklist.md` for the per-file
      delete/rewrite/keep list and the ordering constraints;
   5. `docs/plugin-architecture.md`, AGENTS.md and ADR-0063/0068/0069/0071 get amended in the same
      pass, per AGENTS.md's own rule that old and new architecture must not coexist in that file.
7. **Third-party plugin delivery is explicitly out of scope.** If it ever comes back, it needs
   `libloading` (0.9.0, 2025-11-05, 550M downloads) plus a C ABI and a hard rustc/target/API version
   handshake, and only then the OS-level containment and memory ceiling (the correct suspend →
   `AssignProcessToJobObject` → resume sequence already exists in
   `local_backend_containment_windows.go:24-38,49,52-70,72-84`, but it sets only
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, no memory limit). Do not build that now.
8. **Rejected as migration targets, with evidence.** Wasmer + WASIX (no `fuel`/`epoch`/limiter
   equivalents found in `wasmer-7.5.0`; `terminate()` carries an upstream "this is wrong, threads
   might still be running" FIXME; pins `wasmer = "=7.5.0"` behind ~75 dependency sections; no fs-change
   notification so `findz` stays blocked either way; preview1-only per its own README). Bevy (its
   `bevy_dynamic_plugin` says "unsound and will be removed in 0.15" and warns Rust has no stable ABI;
   `bevy_app` drags 13 direct deps and a frame-schedule model). Tauri plugins (`crates/tauri/src/
   plugin.rs` has zero `dlopen`/`libloading`, and is GUI-runtime-only, which ADR-0069's four-face rule
   forbids as the node system). Plugify (host is a C++20/CMake library; would re-add a second
   toolchain to a rewrite whose point is removing one). `fidius` (2 stars) and `polyplug` (1 star,
   unpublished-quality downloads, 3 months stale) are not supply-chain-acceptable here.

## Consequences

- `bun run audit:plugin-manifests`, `scripts/build-node-wasm.ts`, `bun run audit:node-feasibility`
  and the `wasmFeasibility` field of `docs/xiranite-target-node-manifest.json` lose their subject and
  must be rewritten or deleted in step 4 above, not left green-but-meaningless.
- `xiranite.build.toml`'s node list and `packages/*/src/*.generated.ts` registries become
  redundant with the crate graph; the decision half (retained / hold / removed, per ADR-0064) stays in
  `docs/xiranite-target-node-manifest.json`, because "which nodes should exist" is not something a
  linker can answer.
- Node memory accounting stops being enforceable by the engine, so `max_live_bytes` becomes an
  explicit, reviewable number per node instead of a manifest field nothing read.
- `docs/adr/0070` (handle family) and `docs/adr/0071` (WASI preopens) are superseded; `docs/adr/0072`
  keeps its measurements and loses its prescription.

## 逐条作废清单

### 对本仓 Rust 代码的影响（`crates/`）

| 现状 | 处置 | 落点 |
| --- | --- | --- |
| `crates/xiranite-extism-adapter/`（整 crate：`compiled.rs` 的 0 参导出探测、`capabilities.rs` 的 `CapabilityHost`） | 删 | 第 3 步：先改掉 `xiranite-node-runtime` 的 `capabilities.rs:42` 与 `registry.rs:17` 两处 trait 使用，它没有别的消费者 |
| `xiranite-plugin-api`：`abi_code.rs`、`host_calls.rs` 的 `HostCalls`、`host_function_names.rs`（9 条名 + `HOST_FUNCTION_SYMBOLS` 点→下划线表）、`file_stream`/handle 相关 | 删 | 与 `impl AbiCode` 各块同批；`abi_code.rs` 被六个兄弟模块与 `core/src/operation/*` 引用，必须一起搬 |
| `xiranite-plugin-api`：`abi_code.rs` 的**错误码语义**、`checkpoint.rs::CheckpointOutcome`、`run_events.rs`、`node_definition.rs`、`definition_eval.rs`、`identifiers.rs`（去掉 `PluginEntryPoint`）、`protocol_version.rs`（去掉 `PLUGIN_ABI_VERSION_MAJOR`） | 留（换名/换家） | 产品语义与定义语言与 wasm 无关；`identifiers.rs:73/:106` 的 "entry point" 改叫节点的 run 函数 |
| `node_definition.rs:363 Rule::Custom { export_name }`、`:426 DangerGate::PluginExport`、`:631/:633/:635` 三个 `*_export`、`:676/:712 MissingExportName`、`definition_eval.rs:32 FromPlugin { export_name }`，以及 TS 镜像 `packages/node-definitions/src/contract.ts:28/:525-531/:558-559/:572-584` | 重写 | 定义仍是数据、仍按字符串分派，但 "plugin export" 改成 "node function"，由 inventory 注册表解析 |
| `xiranite-node-runtime`：`PluginManifest`（`entryPoint`、`allowedPaths` 的 Extism 语义、`manifest.rs:17/:102` 的 abi major 门禁）、`registry.rs`（`<root>/<id>/{manifest,wasm}` staged 布局）、`capabilities.rs:37/:91` 与 `core/src/file_stream.rs` 的 base64 分块读 | 删/重写 | 名字冲突记在这里：`NodeRegistry`/`NodeDescriptor`/`RegistryError` 今天有两份（`node-runtime/src/registry.rs:94/:23/:57` 与 `xiranite-node-registry/src/lib.rs`）。**本 ADR 的命名是真源**，wasm 侧那份随第 3–4 步消失，不许长期并存 |
| `xiranite-desktop/src/launcher.rs:47-52` 的 `stage_from_environment`/`XIRANITE_PLUGIN_DIR` | 重写 | 换成 `NodeRegistry::builtin()`；`StagedRuntime`/`staging_summary` 的"staged"说法一起去掉 |
| `xiranite-core/src/filesystem.rs:1-6`、`file_stream.rs` 文档里"这是 `xiranite.fs.*` 能力服务"的措辞 | 重写措辞 | 实现本身是宿主服务，继续用 |

### 对 ADR 的处置

- **ADR-0063**：`插件执行只用 Extism` 作废；其余（Rust+Tokio+Axum 后端、React 19 产品层、Tauri 2 取代 Wails/Go、Bun 不进成品）不变。
- **ADR-0068**：分层 `Xiranite Plugin API → Extism Adapter → plugin.wasm` 作废，改为"Plugin API 是进程内 trait 契约"；**WIT 可表达条款作废**（不再有跨 wasm 边界的类型）；"零参数导出 / 非零即失败 / block API 读写"整套入口约定作废；`pluginVersion`/`pluginApiVersion` 保留在 `NodeDescriptor`，**`runtimeVersion` 作废**；"取消与配额靠引擎原语、不许引入进程边界"一条作废，并按本 ADR "What is given up" 记录代价；"不提前实现 Component Model、不引入 WIT 工具链"随之失去对象。
- **ADR-0069**：`Node Core = 一份 Rust → cdylib → wasm32-wasip1`、"`wasm32-unknown-unknown` 不算合格产物"作废，改为 `rlib` 原生 crate；**四面结构、CLI=clap+cliclack、TUI=ratatui、GUI 统一不打散、禁止在 face 里重写业务逻辑** 全部保留。
- **ADR-0070**：`FileHandle` 分块家族与 `MAX_CHUNK_BYTES` 作废（其"体积上限要实测"的理由由 `NodeRequirements.max_live_bytes` 接替）。
- **ADR-0071**：整份作废——`with_wasi(true)`、`allowed_paths` + `ro:` 授权、9 条能力词表、"位置读写是允许且推荐的"。它测到的事实（位置 IO 可行、spawn 返回 `Unsupported`、fuel 962 µs / cancel 505 ms / `ResourceLimiter`）作为本 ADR 的"为什么"保留。
- **ADR-0072**：处方作废（"递归枚举必须由宿主服务提供给 guest"），测量保留；它发现的**24 份重复 walk** 仍要收敛成一份共享宿主遍历工具，但那是原生代码复用，不再是跨边界能力。
- 作废的 ADR **不删除**，只加 superseded 头，否则 `docs/adr/0072:131` 那类句子会被读成对新设计的否决。

### 对脚本与门禁的处置（含分级重写）

| 条目 | 处置 | 替换物 |
| --- | --- | --- |
| `scripts/build-node-wasm.ts`、`package.json:97` `build:node-wasm`、根 `Cargo.toml` 的 `[profile.wasm]`、`plugins/*` 的 `exclude` 名单 | 删 | 节点随根 workspace 正常 build |
| `scripts/audit-plugin-manifests.ts`、`package.json:81` `audit:plugin-manifests` | 删 | **新增 `audit:node-registry`**：把 `NodeRegistry::builtin()` 的 id 集与 `docs/xiranite-target-node-manifest.json` 的 `retain-rewrite` 集做差集。必须有这条，因为链接期注册的失败模式是**静默少一个节点**（crate 不是成员就不注册，且构建不红） |
| `packages/tauri-migrate/src/node-feasibility.ts`：`:20` 分级联合、`:143` 顺序、`:212-219` 打分、`:333-337` 标签，产物 `artifacts/node-wasm-feasibility.json` | 重写分级 | 新分级按"原生 crate 需要哪种宿主服务"：`pure-logic` / `file-io` / `recursive-enumeration` / `external-process` / `network` / `os-native` / `no-host-free-answer`（`findz` 的 fs 变更通知仍是这一类）。扫描证据不变地由 `docs/migration/node-native-shape.json` 提供 |
| `docs/xiranite-target-node-manifest.json` 的 `wasmFeasibility` 字段与 `scripts/audit-target-node-manifest.ts:17/:23/:41/:76/:113/:120/:129-130/:139` | 字段改名 + 门禁同批改 | `hostRequirements: string[]`；决策真源（retain/hold/removed/standalone）不动，ADR-0064 的依据继续有效 |
| `crates/xiranite-node-runtime/tests/node_run.rs:263/:350`（断言磁盘上有 staged `.wasm`）、`tests/event_stream.rs:17` | 重写 | 断言改为进程内注册表 + 原生 run |
| ADR-0067「语法树是迁移事实源」 | 保留 | 断言对象从"可 WASM 化"换成"需要哪种宿主服务"，扫描仍用 ast-grep，不许裸 grep |

## 退役时不要继承的三个洞（本轮实测确认，全部属于将被删除的 wasm 栈）

1. **构建目标与定版文档相反。** `scripts/build-node-wasm.ts:31` 写的是 `wasm32-unknown-unknown`，而 AGENTS.md 与
   ADR-0071 规定 `wasm32-wasip1`、并明说前者"看不到预打开目录，不算合格产物"。所以今天的产物按自家标准就不合格。
   退役后这条消失，但**教训要带走**：门禁必须检查实际构建参数，不能只检查文档里的定版。
2. **能力门禁扫不到被审的对象。** `scripts/audit-plugin-manifests.ts:185` 只扫 `plugins/`，而 workspace 里唯一的节点
   `crates/nodes/dissolvef/manifest.toml:14-17` 声明的是 `xiranite.fs.stat/list/ensure_dir` —— ADR-0071 已退役的名字。
   它不是通过检查而是通过**目录不重叠**免检。（该门禁有一条"空扫描即失败"的阳性对照，值得保留到新门禁里。）
   这条直接决定 `audit:node-registry` 的设计：它必须比对**注册表实际输出的 id 集**，而不是扫某个目录。
3. **十个测试从不运行。** `crates/nodes/dissolvef/src/criteria.rs` 有 19 个 `fn` 却只有 1 个 `#[test]`；
   `criteria.rs:196/210/230/260/269/300` 与 `document.rs:405/412/430/475` 这十个函数名在全 crate 只出现一次（只有定义，
   没有调用者），包括 `serialized_names_are_the_core_ts_wire_names` 这种线上名字针。它们一直是绿的，因为根本没跑。
   原生移植第 1 步之前必须先让这批断言真的跑起来，否则"移植后仍绿"没有意义。

附带一条文档债：`docs/plugin-architecture.md:105` 还写"20 个能力名"，代码里已经是 9 个 —— 随第 4 步一起改。

## Unverified, deliberately not asserted

- Windows numbers for every measurement above (the release gate is Windows; re-run the same three
  shapes there before quoting these ratios to anyone else).
- Whether any retained node needs something that only a sandboxed boundary could have provided
  (untrusted third-party code). None does today; that is an assumption about the product, not a fact
  about the code.
- The behaviour seam (`Node::run`). It is intentionally not invented here; it comes out of the
  `DissolvefRuntime` trait during step 2.
