# Extism / WASM retirement checklist

Target decision: `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md:3` (Status: accepted) — node cores are
plain Rust crates **statically linked into the host** (`:65-66`); registration moves to
`inventory` (`crates/xiranite-node-registry/Cargo.toml:13`, rationale `:11-12`; ADR-0073:67-73); Extism + wasm is retired.
Evidence below was read from the working tree on 2026-10-04. Two crates are **other lanes**:
`crates/xiranite-node-runtime` and `crates/xiranite-node-registry` — this file describes them, never edits them.
No command that rewrites `Cargo.lock` was run; anything needing one is in section E.

## A. KEEP — product semantics that survive the move

- `crates/xiranite-plugin-api/src/operation_status.rs:17` `OperationPhase` (+ `:100` `ADR_0066_PLUGIN_VISIBLE_PHASES`): the
  HTTP/Operation protocol keeps these six phases. Consumers `crates/xiranite-core/src/operation/{mod,manager,dto}.rs`.
- `crates/xiranite-plugin-api/src/checkpoint.rs:19` `CheckpointOutcome`, `:86` `CheckpointDecision`, `:137` `CheckpointContradiction`:
  cooperative pause/cancel is product behaviour, not an ABI. Its real implementation is
  `crates/xiranite-core/src/operation/control.rs` + the wait loop `crates/xiranite-node-runtime/src/capabilities.rs:67`.
- `crates/xiranite-plugin-api/src/run_events.rs:22/:61/:112/:123/:132/:188` (event kind, `ProgressPercent`, progress/log events,
  `EventIndex`): consumed by `crates/xiranite-core/src/operation/{state,retention,dto}.rs`. Keep.
- `crates/xiranite-plugin-api/src/run_options.rs:23` `EventRetentionCeiling`, `:117` `ResourceClass`, `:161` `ResourcePriority`,
  `:215` `ResourceAdmissionRequest`, `:295` `PluginRunOptions`: scheduler + retention policy survive. (`:95`
  `ManifestResourceLimits` is manifest-shaped — see B.)
- `crates/xiranite-plugin-api/src/node_definition.rs` (754 lines) + `node_definition/{help,validate,tests}.rs` +
  `definition_eval.rs:20/:24`: the one vocabulary all three faces read. Heaviest consumer set in the repo
  (`crates/xiranite-cli-runtime/src/{plan,term,wire}.rs`, `crates/xiranite-tui-runtime/src/{lib,surface}.rs`,
  `crates/xiranite-tui-runtime/src/tui/{terms,layout,help,form,editor}.rs`). Keep; only the "plugin export" wording changes (C).
- `crates/xiranite-plugin-api/src/identifiers.rs:22` `define_identifier!` → `PluginId`/`OperationId`: keep.
- `crates/xiranite-plugin-api/src/payload.rs:29` `OpaquePayload`: keep **only** where it mirrors the HTTP DTO
  (`crates/xiranite-core/src/operation/dto.rs`, `retention.rs`, `enumeration.rs`). It is not the native call interface
  (AGENTS.md bans it as a universal interface).
- Errors-as-data, not traps: `crates/xiranite-extism-adapter/src/capabilities.rs:15` `CapabilityRefusal` + `:48`
  `accepted_document`. The `{code,message,details}` shape and the "one locked path must not abort the operation" rule survive;
  they stop being a JSON envelope and become `Result<T, NodeError>`. Reparent, do not drop.
- `HostCalls` error vocabulary: `crates/xiranite-plugin-api/src/host_calls.rs:67` `HostCallErrorCode`, `:141` `HostCallError`,
  `:185` `is_hard_stop`, `:36` `FileAccessMode`. The **trait** `:214` shrinks to its operation-control methods (`:220` `checkpoint`,
  `:224` `emit`; a clock call it never had must be added); its `file_*` methods `:237-265` are already retired by ADR-0071.
- Node business logic: `crates/nodes/dissolvef/src/{contract,criteria,document,execute,history,paths,plan,run,similarity}.rs`,
  the host seam trait `crates/nodes/dissolvef/src/host.rs:57` `DissolvefHost`, and `in_memory_host.rs`. This is the pattern the
  native design keeps: trait seam + real host impl instead of an import shim.
- Host services: `crates/xiranite-core/src/filesystem.rs` (`FileCapability`, `:137`), `crates/xiranite-core/src/enumeration.rs`
  (ADR-0072 host-side listing), `crates/xiranite-core/src/operation/*`. Only their **naming** is wasm-derived (C).

## B. DELETE — wasm/ABI-only, nothing must be reparented

### B1. `crates/xiranite-extism-adapter/` (whole crate)
Public surface: `src/lib.rs:13` `CapabilityAnswer/CapabilityHost/CapabilityRefusal/accepted_document`, `src/lib.rs:14`
`AdapterError/CompiledNode/PluginSetup`. Wasm-only mechanics: `src/compiled.rs:22` `CAPABILITY_NAMESPACE`
(`extism::EXTISM_USER_MODULE`), `:25` `PluginSetup{wasm,entry_point,host_functions,memory_max_pages}`, `:81` `compile`,
`:102-108` `Manifest`+`memory.max_pages`+`with_wasi(false)`, `:126-139` `run`/`function_exists` zero-arg convention,
`:148` `serve_capability`, `:198` `write_block`, `:213` `answers_with_code`.
Consumers (exhaustive): `crates/xiranite-node-runtime/Cargo.toml:14`, `src/capabilities.rs:42`, `src/registry.rs:17`,
`tests/event_stream.rs:17`, `tests/node_run.rs:84` and `:136`. **`crates/xiranite-api/Cargo.toml:10-12` and
`crates/xiranite-desktop/Cargo.toml:26-30` do not depend on it** — they reach it only through `xiranite-node-runtime`.
Cargo.toml lines to drop: root `Cargo.toml:17` member.

### B2. `crates/xiranite-plugin-api/` ABI-only modules
- `host_function_names.rs` entire file: `:19` namespace, `:22-42` the nine names, `:46` `HOST_FUNCTION_NAMES`,
  `:59` count, `:75-85` `HOST_FUNCTION_SYMBOLS` (dots→underscores exists only for wasm `#[link_name]`, see
  `crates/xiranite-extism-adapter/src/compiled.rs:84`), `:89/:96` symbol lookups, `:131-135` the "closed at nine" const assert.
- `abi_code.rs` entire file (`:13` reserved code, `:20` `AbiCode`, `:30` `UnknownAbiCode`): its stated reason is "a tag a shim can
  write without a serialization dependency" (`lib.rs:27-29`). The `impl AbiCode` blocks go with it:
  `checkpoint.rs:53`, `operation_status.rs:73`, `host_calls.rs:48` and `:108`, `run_options.rs:140` and `:192`, `run_events.rs:42`.
- `protocol_version.rs` entire file (`:16-23` `PLUGIN_ABI_VERSION*`, `:29` `DOCUMENTED_HOST_CONTRACT_VERSION`, `:86-109` const asserts):
  a version handshake with a self-describing manifest is meaningless once a stale node is a compile error. Sole consumer is the
  manifest load gate `crates/xiranite-node-runtime/src/manifest.rs:17` + `:102`.
- `invocation.rs` entire file (`:28` `PluginInvocationRequest`, `:56` `PluginRunResult`, `:101` `PluginInvocationResponse`,
  `:203` `CompletionContradiction`): zero consumers outside `plugin-api` itself (`lib.rs:66-68`); the launcher never used it and built a
  JSON document by hand (`crates/xiranite-node-runtime/src/launcher.rs:124`).
- `run_options.rs:95` `ManifestResourceLimits` (`memory_limit_bytes`, `wall_clock_timeout_ms`): manifest fields, no consumers.
- `tokens.rs:21/:65/:70/:75` (`RESERVED_INVALID_TOKEN_VALUE`, `PathToken`, `FileHandleToken`, `ResourceLeaseToken`): tokens were the
  currency for "large payloads never cross the boundary". The surviving concept (per-operation granted roots, read/write role)
  is already re-expressed in `crates/xiranite-node-registry/src/lib.rs:35` `RootAccess` / `:48` `RootRequirement`.
- `crates/xiranite-plugin-api/Cargo.toml:10-11` deliberately empty `[dependencies]`: that constraint existed only to keep plugin link
  size small; it can go once the crate is host-side.

### B3. Staging, build and gates
- `scripts/build-node-wasm.ts` entire file (`:27-31` nodesRoot/stageRoot/`cargoProfile = "wasm"`/`wasmTarget`,
  `:63-90` cargo + artifact discovery, `:94-112` manifest+wasm copy) and `package.json:99` `build:node-wasm`.
- Root `Cargo.toml:36-44` `[profile.wasm]` (+ its `:32-35` rationale comment) and the `exclude` entries `Cargo.toml:26-31`
  (`plugins/logx|nameu|snf|timeu|transq`).
- `scripts/audit-plugin-manifests.ts` entire file (`:20-30` canonical nine, `:38-55` retired fs list, `:58-78` rename map,
  `:139-145` "declare host_functions / must include checkpoint", `:169-176` definition-in-plugin-dir check, `:185`
  `pluginsRoot = plugins/`) + `package.json:81` + `scripts/audit-plugin-manifests.test.ts:113-201` (every call is a
  `pluginsRoot` fixture).
- All 9 `plugins/*/` crates as plugin packages: 9 own `Cargo.lock` files, `[workspace]` at
  `plugins/classq/Cargo.toml:13`, `plugins/linedup/Cargo.toml:15`, `plugins/samea/Cargo.toml:16`, `plugins/snf/Cargo.toml:14`,
  `plugins/soundw/Cargo.toml:13`, `plugins/logx/Cargo.toml:11`, `plugins/timeu/Cargo.toml:14`; wasm sizing
  `[profile.release]` at `plugins/classq/Cargo.toml:31-33`, `plugins/linedup/Cargo.toml:53-55`, `plugins/samea/Cargo.toml:57-59`,
  `plugins/snf/Cargo.toml:42-44`, `plugins/soundw/Cargo.toml:38-40`, `plugins/transq/Cargo.toml:38-40`; `wasm` features at
  `plugins/linedup/Cargo.toml:29`, `plugins/snf/Cargo.toml:26`, `plugins/soundw/Cargo.toml:26`,
  `plugins/timeu/Cargo.toml:29`, `plugins/nameu/Cargo.toml:18`. Guest boundary modules: `plugins/classq/src/{wasm_plugin.rs,plugin_entry.rs}`,
  `plugins/linedup/src/{extism_host.rs,plugin_entry.rs}`, `plugins/samea/src/{extism_boundary.rs,plugin_entry.rs,plugin.rs}`,
  `plugins/soundw/src/{extism_boundary.rs,host_functions.rs,plugin_entry.rs,plugin.rs}`,
  `plugins/timeu/src/{extism_boundary.rs,plugin_entry.rs,plugin.rs}`, `plugins/snf/src/{plugin.rs,host_surface.rs}`,
  `plugins/logx/src/plugin.rs`, `plugins/nameu/src/plugin.rs`, `plugins/transq/src/plugin.rs`.
- `crates/nodes/dissolvef/src/host.rs:355-841` `#[cfg(target_arch = "wasm32")] pub mod extism` (`:372`
  `#[link(wasm_import_module = "extism:host/env")]`, `:388` user-module imports, `:590-591`
  `#[unsafe(no_mangle)] pub extern "C" fn dissolvef_run() -> i32`) + `crates/nodes/dissolvef/Cargo.toml:12`
  `crate-type = ["cdylib", "rlib"]` → `rlib` only.
- Manifest concept: `crates/nodes/dissolvef/manifest.toml:6-25` and the 9 `plugins/*/manifest.toml` (`plugins/timeu/manifest.toml:5-33`,
  `plugins/linedup/manifest.toml:12-56`, `artifacts/plugins/dissolvef/manifest.toml:6-25`). Meaningless fields:
  `[backend] runtime = "extism"`, `entry` (the `.wasm` file), `entry_point` (the export), `runtime_version`,
  `memory_max_pages`, `host_functions`. `allowed_paths`/`allowed_hosts` survive as **host grant config**, not per-node manifest.
- `artifacts/plugins/` staging output (`artifacts/plugins/dissolvef/{manifest.toml,dissolvef.wasm}`; gitignored at `.gitignore:22`)
  and the env var that names it: `crates/xiranite-desktop/src/launcher.rs:10-12` `XIRANITE_PLUGIN_DIR` + `:50` default +
  `:57` message pointing at `bun run build:node-wasm`. Keep `XIRANITE_ALLOWED_DIRS` (`:13`) and `XIRANITE_DATA_DIR` (`:16`).
- `crates/xiranite-core/src/file_stream.rs` entire file (`:1` "the handle-based byte stream behind `xiranite.fs.open/.read/.close`
  (ADR-0070)", `:36` chunk ceiling, `:55/:64` handle table, `:85/:132/:188`) + `crates/xiranite-core/tests/file_stream_capability.rs`:
  its sole consumer is `crates/xiranite-node-runtime/src/capabilities.rs:37`/`:91`. Native node code uses `std::fs` positionally;
  the base64 chunk path has no remaining reason.
- In `xiranite-node-runtime` (lane-owned, listed so the lane can drop it): `src/registry.rs:32/:44/:50`
  `NodeDescriptor::read/wasm_path/wasm`, `:70-77` `RegistryError::WasmMissing`, `:96`+`:165-190` compiled cache,
  `src/manifest.rs:23` `BACKEND_RUNTIME` + `:46-72` `BackendManifest`, `src/capabilities.rs:49-63` `SERVED_CAPABILITIES`,
  `:74-83` `HOST_FS_*` consts, `:324-438` fs handlers, `:489-511` the settled-name const assert.
- `docs/xiranite-target-node-manifest.json` `wasmFeasibility` field (51 occurrences, e.g. `:34`, `:50`) — replaced, not deleted blind:
  see C.

## C. REWRITE — keep the concept, change its home/name

1. `crates/xiranite-plugin-api` identity: `Cargo.toml:8` "Plugin ABI vocabulary shared by Xiranite's Extism WASM plugins",
   `src/lib.rs:1-29` layering doc ("Xiranite Plugin API -> Extism Adapter -> plugin.wasm", "must stay WIT-expressible").
   Split into what A kept (operation/event/definition vocabulary) and drop the boundary-shape rules; the crate name and the
   `wasm32`-driven zero-dependency rule (`Cargo.toml:10-11`) both go.
2. `identifiers.rs:73` `PluginEntryPoint` + `:106` `EntryPointNameRejected` and every "entry point" mention
   (`crates/xiranite-node-runtime/src/manifest.rs:54-56`, `crates/nodes/dissolvef/src/lib.rs:4-5`): rename to the node's
   registered run function; the zero-arg/`i32`-exit convention (`crates/xiranite-extism-adapter/src/compiled.rs:29-35`) is deleted, not renamed.
3. Plugin-export fields: `node_definition.rs:363` `Rule::Custom { export_name }`, `:426` `DangerGate::PluginExport`,
   `:631` `danger_prompt_export`, `:633` `preview_export`, `:635` `result_export`, `:676/:712` `MissingExportName`,
   `definition_eval.rs:32` `DangerDecision::FromPlugin { export_name }`; TS mirror
   `packages/node-definitions/src/contract.ts:28` `"pluginExport"`, `:525-531` `defaultExport`, `:558-559`, `:572-584`;
   backlog reporting `scripts/audit-node-definitions.ts:25-28`. Keep string dispatch (definitions stay data), rename
   "plugin export" → "node function" resolved through the inventory registry.
4. `crates/xiranite-node-runtime` becomes the in-process bridge: `NodeRuntime::new`/`launch`
   (`src/launcher.rs:38`, `:67`, `:109` `compiled.run`) keep their shape; the `CapabilityHost` impl
   (`src/capabilities.rs:114`) becomes a concrete host struct the node crate is handed. Name collision to resolve by the lane:
   `NodeRegistry`/`NodeDescriptor`/`RegistryError` exist twice today (`src/registry.rs:94/:23/:57` vs
   `crates/xiranite-node-registry/src/lib.rs:207/:121/:185`).
5. `crates/xiranite-desktop/src/launcher.rs:47-52` `stage_from_environment` → `NodeRegistry::builtin()`
   (`crates/xiranite-node-registry/src/lib.rs:217`); `StagedRuntime` (`:27`) and `staging_summary` (`:88`) lose the "staged" framing
   (`crates/xiranite-desktop/src/main.rs:41-53`, `crates/xiranite-desktop/src/bin/dev_host.rs:44` follow).
6. Definition location: `plugins/<id>/definition.json` → `crates/nodes/<id>/definition.json` or `node-definitions/`; repoint
   `scripts/audit-node-definitions.ts:10/:82/:89/:124` and `scripts/audit-node-help-text.ts:66/:339-341/:402`
   (36 drafts already live in `node-definitions/`).
7. Feasibility verdict: `packages/tauri-migrate/src/node-feasibility.ts:20` tier union, `:143` order, `:212-219` scoring,
   `:333-337` labels + `package.json:104` + `artifacts/node-wasm-feasibility.json` (44 nodes: 41 `wasm-with-host-io`,
   2 `rust-host`, 1 `blocked-native`) → re-aim at "which host service does this native crate need"; the AST-as-source-of-truth rule
   (ADR-0067) stays. Then `scripts/audit-target-node-manifest.ts:17/:23/:41/:76/:113/:120/:129-130/:139` and
   `docs/xiranite-target-node-manifest.json` change together (gate + data), `package.json:80` stays as a gate.
8. Host-service naming: `crates/xiranite-core/src/filesystem.rs:1-6/:137/:200-333` and `src/file_stream.rs` doc lines that call it the
   `xiranite.fs.*` capability service; `crates/xiranite-core/src/lib.rs:5-37` ("Extism manifest memory limit", "the Extism adapter does
   not have to reshape this crate"); `crates/xiranite-core/src/operation/dto.rs:230` `PathToken` reference.
9. Root `Cargo.toml:1-13` header comment (justifies the workspace by "复用 tokio/axum/extism/tauri") and `:32-35`;
   `.gitignore:13-14` ("/target … host and the wasm32 caches").
10. `crates/xiranite-api/src/lib.rs:24-28` "the seam the Extism host implements", `:75` `without_plugin_runtime`, `:106-110`
    `NoPluginRuntime`: the seam is right, the wording and the `plugins/<id>` fallback message are not.
11. Docs that now contradict the decision — each needs an amendment or a superseded-by-ADR-0073 banner:
    - `AGENTS.md:5` "插件执行只用 Extism"; `:6` whole bullet (Plugin API → Extism Adapter → `plugin.wasm`, the nine capability names,
      `process.run` allowlist justification "实测 Extism 的 WASI 里 `std::process::Command` 返回 `Unsupported`",
      `with_fuel_limit`/`cancel_handle`/`wasmtime::ResourceLimiter` as the pause/cancel implementation,
      "入口返回值约定被引擎强制：非零即失败"); `:7` "节点的唯一业务实现是 WASM" + `crate-type=["cdylib"]` +
      `cargo build --target wasm32-wasip1` + "wasm32-unknown-unknown 的产物…不算合格产物"; `:8` "装 wasm、能力宿主";
      `:11` "`<id>.wasm` 作为 resources 打进去" + "WASI 预打开目录"; `:14` "进程内 → `xiranite-node-runtime` → Extism → `<id>.wasm`";
      `:18` whole bullet ("插件只写 Rust… 入口是零参数导出、返回 i32"); `:20` "每个保留节点的 WASM 可行性"; `:22` "某节点可 WASM 化".
    - `docs/adr/0063-…:5` title "…and Extism", `:57` "5. Extism is the only plugin execution substrate", `:76`
      "`crates/xiranite-plugins` (Extism host), `plugins/<id>/{manifest.json,plugin.wasm}`", `:94` "Axum -> Operation -> Extism -> WASM",
      `:143` "No Rust crate is created before the AST dependency audit reports… whether it can be a WASM plugin".
    - `docs/adr/0068-…:3` "Status: accepted", `:5-7` amendment note, `:37-40` three-layer figure, `:43-45` WIT-expressible ban list,
      `:97` `pluginApiVersion`/`runtimeVersion`.
    - `docs/adr/0069-…:1` title "one WASM implementation per node", `:58-59` decision sentence, `:63-65` face table rows
      ("Rust → WASM（唯一业务实现）", "clap + Extism + 自己的 wasm", "ratatui + Extism + 同一个 wasm"), `:69` `trename.wasm`,
      `:78` `Extism`, `:87` `lib.rs → trename.wasm`, `:118` "装 wasm → 跑 operation", `:126` "load `trename.wasm`",
      `:230` "wasm accesses it through `xiranite.fs.*` handles", `:291` `xiranite-extism-adapter/` in the tree.
    - `docs/adr/0070-…:7-10` already partly superseded; `:122` "base64 inside `chunk.bytes` is an Extism-adapter encoding detail",
      `:168` the `.wasm` comparison.
    - `docs/adr/0071-…:3` "Status: accepted", `:29` + `:133` the `with_wasi(false)`→`true` decision, `:35`/`:46-47` wasip1 probes,
      `:159` "Build target moves `wasm32-unknown-unknown` → `wasm32-wasip1` in `scripts/build-node-wasm.ts:31`".
    - `docs/adr/0072-…:3` "Status: accepted", `:30` wasip1 guests, and `:131-134` **"Node cores as native `cdylib` instead of wasm…
      Not close."** — the rejected alternative becomes the decision, so this ADR must be re-scoped, not just annotated.
    - `docs/plugin-architecture.md:1` title, `:16-17`/`:33-36` architecture figure, `:43` "`[backend] runtime` 是判别字段",
      `:100-113` "后端（wasm）侧已完成到什么程度", `:105` "**20 个定版能力名**" (already wrong: `host_function_names.rs:131-135`
      asserts nine), `:154-229` §2.1 manifest spec incl. `:195` `entry = "backend/plugin.wasm"`, `:197` `runtime_version`,
      `:201` `host_functions`, `:224-229` evidence commands.
    - `docs/tui-rust-widget-strategy.md:6` (cites ADR-0068 as binding), `:147` ("diff 结果由 `<id>.wasm` 产出"),
      `:187` ("进程内 → `xiranite-node-runtime` → Extism → `<id>.wasm"`);
      `docs/xiranite-target-node-manifest.json:7` policy text ("…gets no Extism plugin", "Retained nodes carry a wasmFeasibility verdict").

### TS/GUI surface: clean
No `src/` or product-`packages/` code assumes a wasm plugin or an Extism capability name: the only hits are
`packages/tauri-migrate/src/node-feasibility.ts:137` and `packages/tauri-migrate/README.md:60` (the analyzer's own wording), plus two
incidental comments (`src/nodes/shared/useLocalFileDrop.tsx:70`, `useLocalFileDrop.test.tsx:54`). `xiranite.fs*`, `process.run` and
`pluginApiVersion` have zero hits under `src/`/`packages/`. No change required beyond item C.6/C.7.

## D. ORDERING

1. ADR-0073 is on disk (`docs/adr/0073-…:3` "Status: accepted", order-of-work `:86-95`, per-ADR amendment list `:145-151`) and is the
   citation source for every delete below. It cites `docs/migration/node-native-shape.json` (`:16`), which now exists
   (82,941 B, 41 nodes: file-IO tier split 7/7/8/16/3, 13 nodes naming 23 external programs that reduce to 9 irreducible ones, one
   network node, 9 OS-native services, one blocker) together with its readable sibling `node-native-shape.md`. Do not delete anything
   before ADR-0073's `:151` rule (superseded banner, never delete an ADR) is applied to 0063/0068/0069/0070/0071/0072 — that banner is
   on all six as of 2026-10-04.
2. DONE for the registry itself (2026-10-04, commit `359e75ad`): `crates/xiranite-node-registry` is a workspace member
   (root `Cargo.toml:21`) and `crates/nodes/dissolvef/src/builtin.rs` is the first self-registering native node — `HostBridge`
   adapts the shared `NodeHost` to the node's own `DissolvefHost`, one `static DESCRIPTOR` feeds both `register_node!` and
   `BuiltInNode::descriptor`, and a test asserts `NodeRegistry::builtin()` inside that test binary sees `"dissolvef"`.
   The business modules did not change: the Extism envelope, the block allocation and the `xiranite.fs.*` symbol names die at the
   bridge, not in the planner.
   STILL BLOCKING every delete below: nothing implements `NodeHost` on the host side yet (that belongs to
   `crates/xiranite-node-runtime`, which is lane-held and `MM`), so `crates/xiranite-extism-adapter/src/compiled.rs:126` has no
   replacement. `crates/nodes/dissolvef/manifest.toml`'s identity/version facts still need their home (C.3), and
   `crates/nodes/dissolvef/src/host.rs:356-841` (the wasm shim) is now dead weight that step 1 removes.
3. Before deleting the adapter crate: in the runtime lane, replace the two trait uses
   (`crates/xiranite-node-runtime/src/capabilities.rs:42`, `src/registry.rs:17`) with the native seam and rewrite
   `tests/event_stream.rs:17` + `tests/node_run.rs:84/:136`. The adapter has no other consumer (B1).
4. Before deleting `plugins/*/` and `crates/nodes/dissolvef/src/host.rs:355-841`: port each retained node core into
   `crates/nodes/<id>/` as a workspace member and self-register it (`register_node!`,
   `crates/xiranite-node-registry/src/lib.rs:297`). A node whose crate is not a member simply disappears from the host with no build
   error, because registration is link-time — this is the silent-loss trap. Watch the count: ADR-0073:90 says "the five `plugins/*`
   crates that already reach Rust", but `plugins/` holds **nine** crate directories, each with its own `Cargo.lock` (B3).
   DONE for the trap itself (commit `ba14b51e`): `scripts/audit-node-registry.ts` (`bun run audit:node-registry`) compares three sets
   read from disk — root workspace membership (globs and path-dependency reachability included, so a node linked only as a dependency is
   not falsely flagged), self-registration (`register_node!` or `inventory::submit!`, with comment lines stripped so a doc example
   cannot read as a submission), and the manifest's `retain-rewrite` decision set; empty scan and empty decision set both fail, per the
   positive-control rule in `scripts/audit-plugin-manifests.ts:186`. The gate opened by catching the real pre-port state
   (`crates/nodes/dissolvef: is a workspace member but never calls register_node!`) and reads
   `OK node registry: 41 retained node(s), 1 crate dir(s) … 1 self-registering, 40 port(s) pending` after it. Unstarted ports are WARN,
   not FAIL: a gate red for 40 ports nobody has started gets switched off rather than fixed. `--strict` is the finish line for that debt.
5. Before moving definition JSON (`plugins/<id>/definition.json` → C.6): repoint
   `scripts/audit-node-definitions.ts:89/:124` and `scripts/audit-node-help-text.ts:341/:402` in the same change, otherwise the gates
   read a missing directory and the help-text gate reports "no definitions" (`:413`).
6. Before deleting `crates/xiranite-plugin-api`'s ABI modules (B2): reparent every A bullet into the host-side crate and remove the
   `impl AbiCode` blocks listed in B2 together, since they sit in five sibling modules and are used by
   `crates/xiranite-core/src/operation/*`.
7. Before deleting `protocol_version.rs` (`PLUGIN_ABI_VERSION_MAJOR`): drop the manifest load gate in
   `crates/xiranite-node-runtime/src/manifest.rs:17/:102` (lane-owned) — otherwise `manifest.rs` stops compiling.
8. Before deleting `crates/xiranite-core/src/file_stream.rs` + its test: the runtime lane must drop the fs handlers
   (`src/capabilities.rs:74-83/:324-438`) and `SERVED_CAPABILITIES` first. `xiranite-core` is not lane-restricted, but nothing may be
   removed there while `capabilities.rs:37/:91` still imports it.
9. Before deleting `scripts/build-node-wasm.ts`/`[profile.wasm]`/`XIRANITE_PLUGIN_DIR`: rewrite
   `crates/xiranite-desktop/src/launcher.rs:47-57` to the inventory registry, and rewrite
   `crates/xiranite-node-runtime/tests/node_run.rs:263/:350` which assert a staged `.wasm` exists on disk. Keep
   `crates/nodes/dissolvef/manifest.toml` until its identity/version facts have a home (C.3).
10. Only then: root `Cargo.toml` member/`exclude`/`[profile.wasm]` edits + `cargo` metadata/lock refresh (needs a build, and
    `Cargo.lock` is `MM` in `git status` right now — coordinate with the lane holding it), then `bun run audit:plugin-manifests`
    removal from `package.json:81` plus its test file.
11. Last: the doc amendments in C.11 and the AGENTS.md rewrite. Deleting an ADR is not allowed; add superseded banners so
    `docs/adr/0072:131` cannot be read as a live rejection of the new design.
12. When the host shape settles (after steps 3/5, i.e. once there is a binary that links every retained node crate): close the other
    half of ADR-0073's洞 #2 by making the gate read the *live* registry instead of source text — a probe that depends on all
    `crates/nodes/*` members and prints `NodeRegistry::builtin()`'s ids, diffed against the `retain-rewrite` set.
    `scripts/audit-node-registry.ts` today compares three sets read from disk (membership, self-registration text, decisions), which
    catches the silent-loss case but still believes the source rather than the linker. It cannot do better until there is something with
    the host's dependency graph to build: the collected set is a property of *which* binary is linked, so a lib-only probe would report a
    different set than the product does.

## E. UNVERIFIED (needs a build or a run; not executed here)

1. RESOLVED in part (2026-10-04): `inventory` 0.3.24 is in `Cargo.lock:2171` and the lock is 604 packages. Whether `extism` and its
   tree actually leave is still open: `extism` 1.30.0 (`Cargo.lock:1204`) plus 14 `wasmtime*` entries, `wasi-common`, `wiggle`,
   `cbindgen` and `ureq` are all still in the lock, because no crate has been deleted yet. Re-measure after step 1; do not report a
   package-count win before it exists.
2. `crates/xiranite-node-runtime` probably does not compile in the current tree: `src/capabilities.rs:49-63` serves 10
   `xiranite.fs.*` names while `src/capabilities.rs:489-511` const-asserts every served name is in
   `host_function_names.rs:46-56` (nine, no fs). The lane is mid-edit (`git status` shows `MM src/manifest.rs`, `MM src/registry.rs`),
   so treat this as in-flight, not a finding about the native design. Needs build.
3. MSRV: every crate pins `rust-version = "1.96"` (e.g. `crates/xiranite-extism-adapter/Cargo.toml:5`), local toolchain is rustc
   1.98.1, and `inventory` is stated at MSRV 1.68 (`crates/xiranite-node-registry/Cargo.toml:11-12`, not verified locally).
   Observed now instead of expected: `inventory` 0.3.24 builds and its link-time table is collected under the workspace's own
   `rust-version = "1.96"` on rustc 1.98.1, so no MSRV change is needed.
4. `wasm32-unknown-unknown` and `wasm32-wasip1` are both installed here (read-only `rustup target list --installed`), so dropping them is a local toolchain action, not a repo change; whether any CI job still installs them was not checked.
5. CLOSED (2026-10-04): the coverage gap is what `scripts/audit-node-registry.ts` fills (D.4). Whether
   `bun run audit:plugin-manifests` still passes was not re-run here and stays open until that gate is retired (D.10).
6. CLOSED: `crates/nodes/dissolvef` builds and tests both ways now — `cargo test -j 1 -p dissolvef --all-targets` gives
   `106 passed` natively (with `crate-type = ["cdylib", "rlib"]` still in `Cargo.toml:12`), and
   `cargo build -j 1 -p dissolvef --target wasm32-wasip1` still links the cdylib, so adding the registry dependency did not break the
   wasm artifact build that the runtime lane still references. The cdylib half goes away with step 1, not before it.
8. New finding, not inherited: `cargo clippy -j 1 -p dissolvef --all-targets --no-deps -- -D warnings` — the task-scoped command
   AGENTS.md prescribes — was red at HEAD with two `unnecessary_sort_by` hits (`crates/nodes/dissolvef/src/plan.rs:174` and `:218`,
   identical lines in `git show HEAD:…`). That crate had only ever been clippy'd for a wasm target, so "green" had never been measured
   on the native path. Fixed in commit `koz` (`sort_by_key(Reverse(path_depth(..))`); every later node port inherits the same command,
   so treat a first-time-red clippy on an untouched crate as a finding to fix and record, not as a reason to loosen the gate.
9. `NodeDescriptor::node_version` became `&'static str` (commit `359e75ad`) rather than `u32`: the manifests this replaces carried
   semver (`crates/nodes/dissolvef/manifest.toml:3` `version = "0.1.0"`, `:4` `backend_api = "1.0"`), and one integer can only either
   lie (`0.1.0` is not "version 0") or drop the patch. `api_version` stays `u32` because the host compares majors, not strings.
10. Commit hygiene this lane hit and should not re-invent: `Cargo.lock` is `MM` (the runtime lane's dependency change is already
    staged, my `dissolvef → xiranite-node-registry` line is not). Committing the file wholesale would commit their staged content too,
    so the lock line stays uncommitted and the branch is knowingly `--locked`-inconsistent for one line. Whoever resolves the
    node-runtime lane must land the lock with it; nobody should "fix" this by dropping their own staged dependency change.
7. `examples/plugins/dissolvef-full/src/{entry.tsx,preview.tsx}` still name Extism/wasm; `examples/plugins/dissolvef-full`
   (`bun.lock`/`index.html`/`package.json`) reads staged-deleted in `git status` while `dissolvef-product`/`frontend-only` remain.
   Which of the three survives is another lane's call and was not evaluated here.
