# DissolveF: wasm → native Rust port mapping

Evidence read on 2026-10-05 from `crates/nodes/dissolvef/src/` (13 files, **5,675 measured lines**),
`crates/xiranite-core/src/{filesystem,enumeration}.rs`, `crates/xiranite-core/src/operation/control.rs`,
`crates/xiranite-node-runtime/src/{launcher,registry,manifest,capabilities}.rs`,
`crates/xiranite-plugin-api/src/{host_calls,checkpoint,node_definition}.rs`,
`scripts/{build-node-wasm,audit-plugin-manifests}.ts`. Line counts are `wc -l`, not estimates. No build or
test was run here: the commands in §D are for the implementing session.

## A) FILE MAP

| File | Lines | Verdict | Reason |
| --- | --- | --- | --- |
| `lib.rs` | 59 | survives, doc-only edit | module list and re-exports are neutral; only the doc (lines 1–22) names wasm/Extism. |
| `contract.rs` | 582 | **pure, unchanged** | input vocabulary + JS-coercion parity; no `unsafe`, no `std::fs`, no `extern`. `DissolvefRunRequest`/`DissolvefRunScope` (204–236) stay as the typed call document. |
| `criteria.rs` | 367 | **pure, unchanged** | total functions over path text (ADR-0069 "faces share the rules"). |
| `document.rs` | 482 | **pure, unchanged** | output model; its `Serialize` shapes are the HTTP result document (ADR-0063), not the ABI. |
| `execute.rs` | 216 | pure, unchanged | write loop + journal; depends on the trait only (`host::DissolvefHost`, line 18). |
| `history.rs` | 411 | pure, unchanged | journal parse/dump/id; no clock of its own (uses `host.now`). |
| `paths.rs` | 308 | pure, unchanged | separator-neutral `path.win32` port; **do not** swap for `std::path` (§E-3). |
| `plan.rs` | 593 | pure + seam | planners call `stat`/`list_dir`/`checkpoint` only; `checkpoint()` helper at 522–537. |
| `run.rs` | 405 | pure + seam | nine-action dispatch over `&mut dyn DissolvefHost` (32–46). |
| `similarity.rs` | 278 | pure, unchanged | Levenshtein/token scoring, no host reference. |
| `host.rs` | 841 | **split three ways** | see below. |
| `in_memory_host.rs` | 347 | **keep (valuable)** | a filesystem double with real move/delete semantics; `impl DissolvefHost` at 153–288. |
| `node_tests.rs` | 786 | keep, retarget | 34 `#[test]`, none name Extism; ported `core.test.ts` cases + Windows/UNC/checkpoint coverage. |

`host.rs` internal split (this is the whole ABI surface):

- **1–146 seam, survives**: `DissolvefHostError` (31), `DissolvefHostResult` (51), `trait DissolvefHost` (57–101),
  `DissolvefCheckpointRequest` (105–110), `PHASE_*` (113–117), `progress_event`/`finished_event`/`report_progress` (122–145).
- **149–353 wire documents, disappear**: the 10 `*Request` structs, `*Reply`/`FsListEntry`, `HostReply<T>` (271),
  `HostErrorBody` (279), `decode_host_reply` (312), `decode_host_ack` (326), `run_event_to_value` (340). JSON-in-a-block
  was the transport; natively a method takes typed arguments.
- **356–681 `pub mod extism`, delete**: `#[cfg(target_arch = "wasm32")]` (356), `extism:host/env` imports (372–386),
  the ten `extism:host/user` imports (389–401), `ExtismDissolvefHost::call`/`call_json` (417–451),
  `impl DissolvefHost for ExtismDissolvefHost` (454–582), entry `#[unsafe(no_mangle)] pub extern "C" fn dissolvef_run() -> i32`
  (590–601), `read_input_bytes`/`read_block`/`write_bytes_at`/`respond`/`report_error` (610–680).
- **683–841 tests**: 5 tests; 2 pin request/envelope JSON (689, 742) → go with the wire structs; keep the
  `CheckpointOutcome` code test (774) and move envelope-decode coverage (784, 812) to whatever replaces the envelope.

## B) SEAM — the trait and the native target of every method

`crates/nodes/dissolvef/src/host.rs:57` `pub trait DissolvefHost` — 10 methods, all `&mut self`, all sync.
Verbatim signatures (file:line is the declaration):

| # | Signature (host.rs) | Native implementation calls |
| --- | --- | --- |
| 1 | `fn stat(&mut self, path: &str) -> DissolvefHostResult<DissolvefPathInfo>` — `:62` | `FileCapability::stat` (`crates/xiranite-core/src/filesystem.rs:201`, `symlink_metadata` under the grant). Keep the shim's lenient arm (`host.rs:469`: any `Failure` → `DissolvefPathInfo::missing`) so a refused folder still plans; propagate `Cancelled` only. Cost of keeping it: a path outside the grant reads as `Path does not exist: …` (`plan.rs:49`) instead of `permission_denied`, so an operator's mis-set root looks like a missing folder — say so in the host log line, do not change the node. |
| 2 | `fn list_dir(&mut self, path: &str) -> DissolvefHostResult<Vec<DissolvefDirEntry>>` — `:68` | `FileCapability::list` (`filesystem.rs:223`, one level, `std::fs::read_dir`) → map `DirEntryInfo` to `DissolvefDirEntry`, re-joining names with `paths::join_paths` as `host.rs:483` does. The recursive scan (`plan.rs:342–364`) may later use `enumeration::walk` (`crates/xiranite-core/src/enumeration.rs:248`), but only *after* parity is green: the walk exists to dodge a guest `read_dir` cost that disappears in-process. |
| 3 | `fn ensure_dir(&mut self, path: &str) -> DissolvefHostResult<()>` — `:71` | `FileCapability::ensure_dir` (`filesystem.rs:254`, `create_dir_all`). |
| 4 | `fn move_path(&mut self, source: &str, target: &str) -> DissolvefHostResult<()>` — `:75` | `FileCapability::move_path` (`filesystem.rs:263`): `create_dir_all(parent)` (276–279) + `std::fs::rename` (280) with the `copy_then_remove` fallback (476) and the move-into-self refusal (270). All three match the double at `in_memory_host.rs:185–225`. |
| 5 | `fn delete_path(&mut self, path: &str, recursive: bool) -> DissolvefHostResult<()>` — `:81` | `FileCapability::delete` (`filesystem.rs:289`): `remove_dir` when `!recursive`, which is the non-empty refusal the node's leftover check depends on (`in_memory_host.rs:241–247`). |
| 6 | `fn read_text(&mut self, path: &str) -> DissolvefHostResult<Option<String>>` — `:84` | `FileCapability::read_text` (`filesystem.rs:313`), `Ok(None)` for missing; keep `Err(Failure) → Ok(None)` (`host.rs:524`). `MAX_TEXT_BYTES` (30) is now a host policy, not a memory guard. |
| 7 | `fn write_text(&mut self, path: &str, content: &str) -> DissolvefHostResult<()>` — `:87` | `FileCapability::write_text` (`filesystem.rs:335`, creates the parent). |
| 8 | `fn now(&mut self) -> DissolvefHostResult<String>` — `:91` | `Clock::now_ms` (`crates/xiranite-core/src/support.rs:27`) formatted exactly as `capabilities.rs:316–320` (`to_rfc3339_opts(SecondsFormat::Millis, true)`), because `history::timestamp_tag` (`history.rs:84`) and the journal text depend on that spelling. Keep the return type `String`. |
| 9 | `fn emit(&mut self, event: &PluginRunEvent) -> DissolvefHostResult<()>` — `:94` | `OperationManager::push_event(operation_id, NodeRunEventRecord)` (`crates/xiranite-core/src/operation/manager.rs:218`) — same call `capabilities.rs:297` makes. Build `NodeRunEventRecord` from `PluginRunEvent` fields directly; delete `run_event_to_value` and its `progress`-as-`JsonNumber` juggling. `report_progress` (`host.rs:136`) keeps swallow-failure-but-propagate-cancel. |
| 10 | `fn checkpoint(&mut self, req: &DissolvefCheckpointRequest) -> DissolvefHostResult<CheckpointOutcome>` — `:97` | `OperationControl::checkpoint()` (`crates/xiranite-core/src/operation/control.rs:89`) or the sync read of the same state (`phase()` + `cancel_requested()`, control.rs:66–74). Map `Cancelled → Err(DissolvefHostError::Cancelled)`; `plan::checkpoint` (`plan.rs:522`) already applies `is_hard_stop()`. |

**checkpoint/emit/now become one object.** The node holds a `NodeHost` value built per run —
`{ operation_id: String, control: OperationControl, manager: OperationManager, files: FileCapability, clock: Arc<dyn Clock> }` —
exactly the parts `crates/xiranite-node-runtime/src/launcher.rs:100–106` assembles today for `OperationCapabilities`.
`DissolvefRunScope` (`contract.rs:229`) stays and keeps `operation_id`, because `launcher.rs:124–139` already builds
`runOptions{operationId, defaultHistoryPath, undoRecordIdSuffix}`; only the JSON round-trip disappears.
`crates/xiranite-plugin-api/src/host_calls.rs:214` `HostCalls` is **not** the target trait: it has 9 methods, no `stat`/
`list`/`ensure_dir`/`read_text`/`write_text`, and takes `PathToken`/`FileHandleToken` handles that ADR-0071 retired.
Recommendation: lift `DissolvefHost`'s verb set into one shared `NodeHost` trait in the registry crate and
`pub use` it in each node crate once a second node ports (rule of three); for *this* port keep the node's own trait,
so 3,642 pure lines never change.

**The 50 ms poll: it goes, but not by making the node async.** `crates/xiranite-node-runtime/src/capabilities.rs:67`
defines `CHECKPOINT_POLL_INTERVAL = 50ms` and `:280–282` spins `while phase == Paused && !cancel { thread::sleep(50ms) }`.
That loop existed only because a wasm host call cannot await (`capabilities.rs:21–27` says so); `OperationControl::checkpoint`
(control.rs:89–113) is already a real park on `oneshot` waiters released by resume/cancel.
- Native node code is an ordinary Rust call stack driven by `launcher.rs:74` `tokio::task::spawn_blocking`, so the trait
  can stay sync and the impl calls `control.checkpoint()` through `tokio::task::block_in_place` + `Handle::current().block_on(..)`.
  Same cooperative semantics, no polling, trait unchanged.
- Making the seam `async` instead means all 10 methods (and `report_progress`, and the double) become `async` and the node
  runs on an async task: that buys a cancellation mid-item the checkpoint cadence does not give, and is a much larger diff.
  Do it only if measured item granularity proves too coarse.
- If neither is done in step 1, the sleep loop is still legitimate **only** while the node runs on a blocking thread; on a
  worker thread it would steal a runtime slot. `enumeration.rs:47` (`PARK_POLL_INTERVAL`) + `PhaseGate::sleeping` (`:92`) is
  the same pattern in the host and is *not* in scope for this port.

## C) REGISTRATION SHAPE (inventory)

`crates/xiranite-node-registry/Cargo.toml` exists already (16 lines, `inventory = "0.3"`, ADR-0073 wording). Proposed item —
note `NodeDescriptor` is **taken** by the wasm-era type at `crates/xiranite-node-runtime/src/registry.rs:23`, so use a distinct name:

```rust
pub struct BuiltInNode {                     // registered with inventory::collect!(BuiltInNode)
    pub id: &'static str,                    // manifest.toml `id`, node-definitions/<id>.json `nodeId`
    pub name: &'static str,                  // manifest.toml `name`
    pub version: &'static str,               // manifest.toml `version` (ADR-0068 pluginVersion)
    pub node_api: u32,                       // was `backend_api`; the NodeHost trait version compiled against
    pub definition: fn() -> NodeDefinition,  // was node-definitions/<id>.json; fn keeps the static Sync
    pub run: fn(&Invocation, &mut dyn NodeHost) -> InvocationOutcome, // was entry_point + wasm call
    pub exports: &'static [(&'static str, ExportFn)], // was previewExport/resultExport/dangerPromptExport
}
```

Field-by-field disposition of `crates/nodes/dissolvef/manifest.toml` (and `manifest.rs:27–72`):

| Manifest field | Native | Why |
| --- | --- | --- |
| `id`, `name`, `version` | `BuiltInNode.id/name/version` | still reported to the plugin list and the `/operations` protocol. |
| `[backend] runtime = "extism"` | **gone** | no runtime to name. |
| `entry = "dissolvef.wasm"` | **gone** | no staged artifact; `artifacts/plugins/dissolvef/` becomes dead. |
| `entry_point = "dissolvef_run"` | **meaningless** → `run: fn(..)` | the symbol is now a link-time call. |
| `runtime_version = "1.30.0"` | **meaningless** | no Extism version; drop, do not fake it. |
| `backend_api = "1.0"` | demoted to `node_api: u32` + a test assert | host and node compile together, so ABI mismatch is a build error, not a load-time refusal. |
| `memory_max_pages = 256` | **not ABI any more** → host policy: retained-event ceiling (`EventRetentionCeiling`) + per-operation timeout | replaces nothing at the call site; see §E-4 for what is genuinely lost. |
| `allowed_paths = []` | **stays as policy**, not ABI | the grant list handed to `FileCapability::new(grants)` (`launcher.rs:100`), built per operation from the node definition's path fields — `plugins/nameu/manifest.toml` shows the shape (`{operation:pathsText}`, `ro:` prefix for read-only). A `plan`-only run gets read-only roots. |
| `allowed_hosts = []` | **gone** | Extism never gave sockets; nodes must not get network capability natively either. |
| `host_functions = [10 names]` | **becomes the trait** | the methods handed to the node *are* the capability list; `SERVED_CAPABILITIES` (`capabilities.rs:49–63`) and the `check_scope` gate (`:262`) go with it. Note the declared set is already ADR-0071-stale: seven `xiranite.fs.*` names that `audit-plugin-manifests.ts:38–52` lists as retired — invisible only because the gate scans `plugins/` (`:185`) and not `crates/nodes/`. |

`node_definition.rs:631–635` (`danger_prompt_export`, `preview_export`, `result_export`) name *plugin exports*; natively they
resolve through `BuiltInNode.exports` so the JSON in `node-definitions/dissolvef.json` needs no re-encoding.

## D) PORT STEPS (dependency order; commands to run, none run here)

Status as of 2026-10-04 (this section was written as a plan; steps 2/3 and part of 7 have run):

- **Step 2 DONE** (`crates/xiranite-node-registry`, commits `b8893625`/`7889c624`): `NodeHost` carries the ten methods,
  `NodeHostError`/`NodeHostResult`/`NodeRunError` stand in for the planned `Invocation`/`InvocationOutcome` (documents cross as
  `&str`/`String`, so the HTTP body shape stays while nothing names an ABI), and `NodeRegistry::builtin()` errors on duplicate ids
  rather than letting link order decide. `cargo test -p xiranite-node-registry -j 1 --all-targets` = 8 passed, including a registered
  duplicate pair that *must* be refused.
- **Step 3 DONE with a deliberate deviation** (`crates/nodes/dissolvef/src/builtin.rs`, commit `359e75ad`): instead of
  `pub use`-ing the shared trait into `host.rs`, the node keeps its own `DissolvefHost` and the bridge (`HostBridge`) adapts the
  shared seam to it. Reason: `pub use` would push the registry's type names onto the node's business modules and its 100 pinned tests,
  so a shared-seam change would ripple into every planner assertion; with a bridge the seam can still move while the pinned trait does
  not. Cost, stated: eleven field assignments and nothing else (`builtin.rs:75-78`/`:90-93`/`:133-135`; stat 4 / list_dir 4 /
  checkpoint 3), and the two error enums must be kept semantically aligned —
  the `Cancelled`/`Failure` distinction is asserted in `builtin::tests::the_bridge_keeps_refusal_and_cancellation_apart`.
  Also skipped from the plan: `static DISSOLVEF` + raw `inventory::submit!` — one `static DESCRIPTOR` feeds both `register_node!` and
  `BuiltInNode::descriptor`, so the policy and the runnable cannot disagree.
- **Step 7 PARTIAL**: the registry path dep is in (`crates/nodes/dissolvef/Cargo.toml:22`); `crate-type` stays
  `["cdylib", "rlib"]` on purpose, because `cargo build -p dissolvef --target wasm32-wasip1` still links (verified: 11.8s, finished) and
  the runtime lane still references the staged wasm artifact. Dropping the cdylib half belongs to step 1/8, not here.
- Steps 1, 4, 5, 6, 8, 9, 10: not run; 1/4/6/8 stay blocked on the lane holding `crates/xiranite-node-runtime` (`MM`) and
  `crates/xiranite-desktop/src/launcher.rs` (whole directory staged-deleted as of this writing — re-check `but status` before
  planning against either path).

1. Delete `host.rs:149–353` + `356–681` and the two envelope tests; keep 1–146 and the `CheckpointOutcome` code test.
   `RUSTC_WRAPPER=sccache cargo test -p dissolvef -j 1 --all-targets`
2. Create the shared seam + registry item in `crates/xiranite-node-registry`: `NodeHost` (the 10 methods),
   `DissolvefHostError`/`Result`, `Invocation`/`InvocationOutcome`, `BuiltInNode`, `inventory::collect!`, and a
   `builtin_nodes()` lookup that **errors on duplicate ids** (mirror `registry.rs:129–141`).
   `RUSTC_WRAPPER=sccache cargo test -p xiranite-node-registry -j 1`
3. In `dissolvef/src/host.rs`, `pub use` the shared trait/error so business modules and `in_memory_host.rs` are unchanged;
   register `static DISSOLVEF: BuiltInNode` + `inventory::submit!`, with `run` decoding `Invocation` into
   `DissolvefRunRequest` and returning `DissolvefResult` (parse cost is one per run, not per file).
   `RUSTC_WRAPPER=sccache cargo test -p dissolvef -j 1`
4. Native `NodeHost` impl in `xiranite-node-runtime` (§B's five fields): fs → `FileCapability`, emit → `manager.push_event`,
   now → `Clock` + the `capabilities.rs:316` formatter, checkpoint → `block_in_place`/`block_on(control.checkpoint())`.
   `RUSTC_WRAPPER=sccache cargo clippy -p xiranite-node-runtime --all-targets --no-deps -j 1 -- -D warnings`
5. Parity test over `tempfile` + the real impl, re-running the nine actions and asserting the same messages/counters as
   `node_tests.rs`; expect OS error text to differ from the double's Node-spelling (§E-6) and assert structure, not wording.
   `RUSTC_WRAPPER=sccache cargo test -p xiranite-node-runtime --test dissolvef_native_parity -j 1`
6. Repoint `launcher.rs`: `registry.compiled(&node_id)` (`:92`) → `xiranite_node_registry::lookup(&node_id)`; keep
   `invocation_document` (`:124`) and `finish_from_document` (`:142`) untouched so the HTTP protocol is byte-stable.
   `RUSTC_WRAPPER=sccache cargo test -p xiranite-node-runtime -j 1`
7. Cargo: `[lib] crate-type = ["cdylib","rlib"]` → `["rlib"]` (`crates/nodes/dissolvef/Cargo.toml:12`), add the
   registry path dep; drop this node from the `[profile.wasm]` path and from `wasm32-unknown-unknown` builds.
   `RUSTC_WRAPPER=sccache cargo build -p dissolvef -j 1`
8. Retire the manifest wiring: remove `crates/nodes/dissolvef/manifest.toml` (**currently `??` untracked while the index
   shows a staged delete plus an `AD manifest.json`** — re-check `but status` ownership first, another lane is in flight),
   and let `build-node-wasm.ts` skip nodes with no `[backend] entry` instead of throwing (`:101`).
   `bun run audit:plugin-manifests && bun run audit:target-node-manifest && bun run audit:node-definitions && bun run check:source-size`
9. Update `docs/xiranite-target-node-manifest.json` for dissolvef *by the gate's own rule*: the field is now
   `hostRequirements` (an array of tiers, renamed by ADR-0073) and it must come from the analyzer, never be typed by
   hand. Re-run `bun run audit:node-feasibility` and then `bun run audit:target-node-manifest -- --apply-host-requirements`;
   the old `--apply-feasibility artifacts/node-wasm-feasibility.json` form errors out instead of aliasing.
   `bun run audit:target-node-manifest`
10. Only after 1–9 pass on Windows: nothing in `packages/nodes/dissolvef/**` may be deleted yet (AGENTS rule — the TS faces
    retire after the Rust CLI/TUI/GUI paths run and `docs/dissolvef-tui-visual-review.md` layout is reproduced).

## E) RISKS (ordered by when they bite)

1. **ABI shim removal is the easy part; the wire documents are the trap.** 205 of `host.rs`'s lines are JSON request/reply
   shapes whose tests (`host.rs:689`, `:742`, `:784`, `:812`) are the only pinning of `camelCase` names such as `sourcePath`
   and `itemKind`. Those names *are* the GUI/HTTP contract (`document.rs:152–171`), so deleting the tests without re-pinning
   them on the typed structs loses the only gauge. Aggravating factor found here: **10 test functions already never run** —
   `criteria.rs:196/210/230/260/269/300` and `document.rs:405/412/430/475` lack `#[test]`, including the two that pin the
   result-document JSON. Fix them in step 1 or the port is asserted against unpinned wire text.
2. **Trait location and the dependency cycle.** The native host must be built by `xiranite-node-runtime` while the node
   implements its trait; if the trait lives in the node crate that is a cycle (`node-runtime → dissolvef → node-runtime`).
   Resolve by putting the seam in the registry crate (step 2) — this is the one decision every later node copies.
3. **Windows path semantics.** `FileCapability` already shields the node's path *text*: `stat` answers `path: raw`
   (`filesystem.rs:212`) and `list` re-joins names onto the caller's spelling (`:232–244`), so the canonicalized
   `\\?\D:\…` that `resolve`'s `canonicalize` produces (`:185`) never reaches a plan row or the journal — `paths.rs` stays
   separator-neutral by design (`:11–25`) and must not be "fixed" with `std::path`. Three things do change in-process:
   (a) a relative `input.path` now resolves against the **host process CWD** (`absolute_path`, `:440` calls
   `std::env::current_dir`) where a wasm guest had none — refuse relative roots or resolve them at the route;
   (b) `normalize_separators` (`:372`) collapses `\`→`/` before the syscall while `paths.rs` treats both as one class, so a
   mixed-separator path (`node_tests.rs:759`) still plans but its refusal text becomes host-worded (see §E-6);
   (c) `is_same_or_inside` (`paths.rs:156`) is case-sensitive whereas a Windows grant is matched case-insensitively
   (`is_case_insensitive_root`, `filesystem.rs:380`), so `covered` / `filter_blocked_groups` (`plan.rs:113`,
   `criteria.rs:79`) can emit two `delete_dir` rows for `D:\Lib\A` and `d:\lib\a` — invisible from a
   `wasm32-unknown-unknown` guest (`build-node-wasm.ts:31`). Add native tests for (a) and (c) in step 5.
4. **Lost guardrails.** `memory_max_pages` (manifest `:11`) plus Extism fuel/epoch/`ResourceLimiter` were the enforcement
   ADR-0066 relied on; in-process a runaway node can exhaust the host's memory or hang its blocking thread, and a panic can
   abort the API process. Keep: checkpoint cadence per item (`execute.rs:83`) and per directory (`plan.rs:355`), the retained
   event ceiling, a per-operation deadline, and `catch_unwind` at the registration boundary so one node's panic reports as
   `phase: error` instead of killing the host.
5. **Duplicate-id registration.** `inventory::iter` gives a list, not a map: two crates registering `dissolvef` silently
   shadows one. `NodeRegistry::load` already refuses double staging (`registry.rs:129–141`); the native lookup must do the
   same at startup, and one test must prove it (`cargo test -p xiranite-node-registry` with two `submit!` in a test fixture).
6. **The double stays, and its messages do not match the OS.** `in_memory_host.rs` is what makes the 786-line suite honest
   (it reproduces `stat → exists:false`, `ENOTEMPTY` on non-recursive rmdir, parent-creating moves). Its refusal text is
   Node-spelled (`:171`, `:244`), while `FileCapability` yields `FsCapabilityError::host("delete_failed", os error)`; plan-row
   `reason` strings will therefore differ between double and native. Do not "fix" the double to emit OS text; assert codes and
   structure in step 5 and keep one snapshot per host kind.
7. **Node-local scope leak.** `read_text`/`write_text` inherit `MAX_TEXT_BYTES` (4 MiB) as a *policy* ceiling from a
   boundary that no longer needs it; keep it explicitly (a 100-record journal is tiny, `execute.rs:25`) rather than silently
   lifting it, or a future node writes an unbounded journal dump through the same seam.
8. **Build/gate fallout.** `build-node-wasm.ts` throws for a manifest without `[backend] entry` (`:101`) and stages
   `<id>.wasm` (`:107`), so it must learn "no wasm artifact" before dissolvef's manifest disappears; `audit:plugin-manifests`
   requires the three version fields (`:85–89`) but scans only `plugins/` (`:185`), so dissolvef leaving is invisible to it
   while the *remaining* `plugins/*` entries keep needing `runtime_version`. `xiranite.build.toml` lists no dissolvef entry
   today (only `disabled = ["clipm","kisaki","lata"]`), so no flavor change is required.
9. **CLI-only native needs.** `packages/nodes/dissolvef/src/platform.ts:29–49` `readClipboardText` (powershell/pbpaste/
   `execFile`) is used only by `cli.ts:373`, never by `core.ts`'s `DissolvefRuntime` (`:97–111`), so it is not a port item
   for the core — but `x<id>` loses paste-path unless `xiranite-cli-runtime` (or the whitelisted `xiranite.process.run`
   policy) provides it later.
