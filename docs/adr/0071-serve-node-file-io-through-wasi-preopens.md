# Serve node file I/O through WASI preopens and keep `xiranite.*` capabilities to product semantics

- Status: accepted
- Date: 2026-10-04
- Amendment note: this **supersedes ADR-0070's file-handle family** — `xiranite.fs.open/read/write/close`,
  the `read_text`/`write_text` pair and `FileHandle` chunking will not be built, because the engine serves
  the same shape better. It keeps every measurement in ADR-0070 that justified size ceilings
  (`smartzip`'s 32 MiB tail, `coveru`'s decompressed entry) — those two nodes are exactly why positional
  access is now mandatory. It amends ADR-0068's "large data crosses as handles" for the *file* case and
  **keeps ADR-0068's WIT-expressibility clause**, which is the reason WASIX was rejected below.
- Amended by: `docs/adr/0072-keep-recursive-directory-enumeration-on-the-host.md` — **Decision 3 does not extend
  to recursive directory enumeration**, which is measured there as a 3.6×–35× regression inside the guest.
  Everything Decision 3 does cover (content access, `seek`, positional read/write, single-directory listing)
  stands exactly as written.
- Related: `docs/adr/0063-…-extism.md`, `docs/adr/0066-…-plugin-pause.md`,
  `docs/adr/0068-…-extism-as-adapter.md`, `docs/adr/0069-…-clap-ratatui-react.md`,
  `docs/adr/0070-serve-the-file-handle-byte-stream-and-name-the-text-document-pair.md`,
  `docs/adr/0072-keep-recursive-directory-enumeration-on-the-host.md`

## Context

AGENTS.md asks whether every retained node can run as a WASM plugin and, if so, whether Xiranite should keep
hand-writing the OS-shaped capabilities. The live audit over the current 44 node directories answers **41 as
`wasm-with-host-io`, 2 as `rust-host` (`owithu` needs `@xiranite/shell-integration`, `kisaki` needs
`@xiranite/czkawka-native`) and 1 as `blocked-native` (`findz` loads `@parcel/watcher`)** — re-run today because
the tree gained `kisaki` while this ADR was being written. That verdict only says "the plugin surface touches the
machine", not who should implement the machine access. Today
`xiranite-core/src/filesystem.rs` (492 lines) implements grant checks and file primitives by hand, and
`crates/xiranite-extism-adapter/src/compiled.rs:106` pins `.with_wasi(false)`.

Two candidate directions were on the table: keep Extism and stop hand-rolling OS access by turning its WASI
on, or replace the runtime with Wasmer + WASIX, which additionally offers process spawn, sockets and threads.
Everything below was measured on this machine on 2026-10-04, not read off a README. Probe crates lived outside
the repository (`Freya/.wprobe`, `Freya/.wz`, `Freya/.sdk`) and are deleted; the guest exports were built with
`cargo build --release --target wasm32-wasip1` and run through `extism` 1.30.0 in-process.

### 1. A guest without a system interface really has none

`wasm32-unknown-unknown` compiles `std::fs::read` and `std::process::Command::output()` — and both fail at
runtime: `ErrorKind::Unsupported` and an immediate `Err` respectively (instantiated the exported probe in
Node's `WebAssembly` to observe this). So "the plugin asks the host" is physics, not style. ADR-0066's rule
stands unchanged.

### 2. Extism's WASI serves the whole file family, with containment done by the engine

A `wasm32-wasip1` reactor exporting a zero-parameter `probe() -> i32`, run under
`PluginBuilder::with_wasi(true)` with `allowed_paths` = `{host/data: "/data", "ro:{host/ro}": "/ro"}`:

| capability name today | stable `std` call in the guest | measured |
| --- | --- | --- |
| `fs.stat` | `fs::metadata` | ok (len 20) |
| `fs.list` | `fs::read_dir` | ok |
| `fs.ensure_dir` | `fs::create_dir_all` | ok |
| `fs.copy` | `fs::copy` | ok (20 bytes) |
| `fs.move` | `fs::rename` | ok |
| `fs.delete` | `fs::remove_file` | ok |
| `fs.read_text` | `fs::read_to_string` | ok |
| **positional read** (the 32 MiB ZIP tail ADR-0070 needed) | `File::seek(End(-4))` + `read_exact` | ok, returned `"GHIJ"` |
| **positional write** (what a SQLite engine requires) | `seek(Start(2))` + `write_all` | ok, bytes read back with `ZZ` at offset 2 |

| gauge | expected | measured |
| --- | --- | --- |
| write into a `ro:` preopen | refused | `ErrorKind::Unsupported`, WASI errno 58 |
| `/data/../ro/in.txt` | refused | `ErrorKind::PermissionDenied`, errno 63 |
| `/etc/hosts` (no preopen) | refused | `ErrorKind::NotFound`, errno 44 |
| read of the granted file | allowed | ok — the positive control that the gauges are not all-fail |

Host-side confirmation was read back from the real filesystem, not from the plugin's own report.
`_start` of a full WASI *command* module is also reachable (`function_exists("_start") = true`, call ok), so
the zero-parameter constraint that already cost us one port (ADR-0068's entry convention) does not block
WASI-shaped guests in either direction.

`std::process::Command` in that same guest returned `Unsupported — operation not supported on this platform`.
**Extism's WASI gives files, not processes**, which is why the 31 nodes that shell out to ffmpeg/sox/7z still
need `xiranite.process.run` from us.

### 3. The cancellation guarantee is live here and absent over there

Same probe, a guest whose loop cannot be optimised away (the condition is an `AtomicBool` load; the first
attempt with a counter loop was erased by LLVM and "passed" in 57 µs — a false green worth recording so nobody
re-runs the invalid version):

- `with_fuel_limit(2_000_000)` → returned in **962 µs** with `"plugin ran out of fuel"`.
- no fuel, `cancel_handle()` armed at 500 ms → returned in **505 ms** with `"timeout"`.
- positive control `quick() -> 7` → `Err("Returned non-zero exit code: 7")`, confirming that a non-zero entry
  return *is* failure. The existing convention (`0` means "the result document is the answer",
  `crates/nodes/dissolvef/src/host.rs:586`) is therefore not just ours — it is enforced by the engine.

Those three mechanisms trace to wasmtime, wired up by Extism:
`current_plugin.rs:37` `impl wasmtime::ResourceLimiter for MemoryLimiter` (backs `memory.maxPages`),
`plugin_builder.rs:168` `with_fuel_limit` plus `catch_out_of_fuel!` around every host call,
`timer.rs:77,84,105` `engine.increment_epoch()`, `plugin.rs:36` `cancel()`.

For comparison, read from `wasmer-7.5.0` and `wasmer-wasix-0.705.0` sources downloaded today:
`ResourceLimiter`, `StoreLimits`, `MemoryLimiter`, `consume_fuel`, `out_of_fuel`, `epoch` are **all absent**;
`TrapCode::HostInterrupt` appears twice and only as a *comparison*, never produced. `terminate()` carries an
upstream `// FIXME: this is wrong, threads might still be running!` and merely sets thread status
(`os/task/process.rs:860-870`); signals are only inspected at syscall entry (`state/env.rs:678,698`) or inside
asyncify (`syscalls/mod.rs:310,379`). Verdict: **a pure compute loop cannot be stopped from the host**, so a
hard cancel requires killing an OS process — which makes the cancel boundary the process boundary, requires an
IPC round trip for every `checkpoint` (ADR-0066's pause waits inside the host call), and reintroduces the
subprocess layer AGENTS.md currently classifies as legacy to delete. Wasmer's own SDK is hitting this in the
open: `wasmer-sdk#542 kill() can terminate a worker inside the allocator and hang the whole process`,
`#539 timeoutMs fires late while the guest is sleeping` (both open, 2026-09).

### 4. WASIX is a preview1 fork, and its plugin framework does not exist

`wasmer-wasix`'s own README lists support for `wasi_unstable` and `wasi_snapshot_preview1` and says the special
`Latest` means preview1; its extensions live in `src/syscalls/wasix/*` under private `__wasix_*` names. That is
the opposite direction from ADR-0068's WIT clause, so adopting it would require overturning that clause, not
merely extending it. Two further checks: `inotify|ReadDirectoryChangesW|FSEvents|path_watch|fs_event` are absent
from the whole crate, so **`findz` stays `blocked-native` either way**; and the Rust `wasmer-sdk` crate
(7.5.0-rc.1) has no dependency on `wasmer` or `wasmer-wasix` at all — its sources are publish/deploy/search
only, while the Sandbox API everyone cites is the npm `@wasmer/sdk` 0.19.0. There is no third-party
"Wasmer + WASIX + plugin host" worth adopting: the closest one, `eryx-org/eryx` (77 stars, Wasmtime-based),
gets its cancellation and limits from the same wasmtime primitives we already have.

### 5. A `wasm32-wasip1` guest inherits POSIX path semantics, even when the host is Windows

Measured in the same guest: `std::path::is_separator('\\') = false`,
`Path::new("C:\\windows\\system32").is_absolute() = false`, and `"E:\\Users\\a"` parses as **one** component.
So WASI is the right place for file *operations* (the host maps each preopen to the real filesystem) and the
wrong place for host-shaped path *analysis*. Windows is the release gate, so any separator, drive-letter or
case-insensitivity reasoning must stay where it can see the host: in `xiranite-core`'s path-shape helpers
(`normalize_separators`, `is_case_insensitive_root`) and in the structured fields the definition layer hands the
plugin. `filesystem.rs` is not deleted by this ADR; it moves from "reimplementing fd semantics" to "owning host
path truth".

## Decision

1. **The engine stays Extism → wasmtime.** Fuel, epoch interruption and the `ResourceLimiter` memory ceiling are
   the load-bearing reasons, and they are measured above, not assumed.
2. **Turn WASI on for plugins.** `with_wasi(false)` at `compiled.rs:106` becomes per-plugin and default-on when
   the manifest grants filesystem access. Grants come from `allowed_paths` (`host → guest alias`, `ro:` for
   read-only), which finally makes the parsed-but-unconsumed `allowedPaths` in
   `crates/xiranite-node-runtime/src/manifest.rs:65` load-bearing.
3. **Retire the thirteen `xiranite.fs.*` names** — `open/read/write/close/read_text/write_text/stat/list/move/
   copy/delete/ensure_dir/set_times` — and do not build ADR-0070's handle family. Plugins use `std::fs`/`std::io`
   against preopens, including positional access. Bulk bytes stop crossing the plugin ABI as base64 in a JSON
   envelope entirely, rather than in 1 MiB pieces. **Recursive tree walking is out of scope for this item and
   stays a host service — ADR-0072 measures why.**
4. **Eight names stay, and one must still be built.** `operation.checkpoint/update/emit`,
   `scheduler.acquire/release`, `log`, `now`, `path_token.resolve` are product semantics — HTTP pause,
   cross-operation admission, structured logging, deterministic clock, display tokens — and no WASI proposal
   covers them (`wasmer-wasix`'s `Capabilities` has no fair-share concept either). `process.run` stays ours
   because the guest cannot spawn (§2).
5. **`xiranite.process.run` is an allowlist, not a shell.** Typed request
   `{ operationId, program, args, cwdToken, timeoutMs, maxOutputBytes }`; `program` resolves only against
   commands the host registered, and the `DangerGate` in `node_definition.rs` stays attached to the registered
   command rather than to argv inspection. This is the one place ADR-0063 principle 8 ("external binaries and
   codecs stay host services") gets implemented instead of argued.
6. **Guest code must not analyse host-shaped paths** (§5). Plugin-side path work is limited to WASI views;
   anything needing drive letters, UNC prefixes or case-insensitive comparison is answered by the host or by a
   field in the node definition.
7. **`trename`'s dictionary**: file-level and positional access are proven (§2), so the AGENTS.md instruction to
   read it through `xiranite.fs.*` handles is withdrawn. Whether a SQLite engine may live *inside* the guest is
   **not yet measured** — it needs a C cross-compile for `wasm32-wasip1`. Until that spike reports numbers, the
   dictionary is specified as a host service; nobody may write "SQLite runs in the plugin" into a contract.
8. **Build target moves** `wasm32-unknown-unknown` → `wasm32-wasip1` in `scripts/build-node-wasm.ts:31`;
   `[profile.wasm]` and the staged `artifacts/plugins/<id>/` layout stay.
9. **Order**: dissolvef first (its `host.rs` 841 lines and `in_memory_host.rs` 347 lines are the per-node ABI tax
   this ADR removes), then the remaining nodes, then delete the `fs.*` vocabulary from
   `host_function_names.rs` once no manifest asks for it.

## Consequences

- ADR-0070 was accepted and committed today (`119eaae0`) and its handle family is now dead before being built.
  That is the honest cost of deciding after measurement; its two ceiling measurements and its text/document
  distinction carry forward.
- The vocabulary in `host_function_names.rs` shrinks from 22 to 9 settled names, so
  `bun run audit:plugin-manifests` and every `plugins/*/manifest.toml` change together with the adapter, in one
  commit — a manifest naming a retired `fs.*` capability must fail the gate, not be tolerated.
- Ported plugins must be rebuilt for `wasm32-wasip1`; a `wasm32-unknown-unknown` artifact will not see preopens.
- `docs/plugin-architecture.md` §1.4 describes the handle family as the settled backend shape; it needs the same
  amendment.
- The WASI we adopt is preview1 (`wasi_snapshot_preview1`). That is *the same* ABI generation WASIX extends, so
  this decision does not sacrifice WIT-migratability that WASIX would have kept — what it declines is WASIX's
  private `__wasix_*` extensions, in exchange for keeping fuel/epoch/limiter.

## Rejected alternatives

- **Wasmer + WASIX as the plugin runtime.** Loses every preemption primitive measured in §3, converts the cancel
  boundary into a process boundary, needs 800–1500 lines of new worker/Job-Object plumbing plus IPC for
  `checkpoint`, contradicts ADR-0068's WIT clause (§4), does not unlock `findz`, and pins `wasmer = "=7.5.0"`
  behind 75 dependency sections. Its genuine advantages — `proc_spawn`, sockets, threads — are either the thing
  ADR-0063 principle 8 deliberately keeps host-side, or needed by exactly two nodes (`comfygure`, `clipm`), which
  is not a reason to rebuild the guarantee layer for all 41.
- **Wasmer SDK as the layer under the plugin API.** The Rust crate is a publish/deploy client, not a runtime (§4).
- **Eryx / Wasmtime-sandbox ecosystem as a dependency.** Wasmtime-based and 77 stars; it is evidence that the
  primitives matter, not a component to embed.
- **Keeping the hand-written `xiranite.fs.*` family.** Rejected by §2: the engine serves positional access our
  own sequential handle cannot express, does containment with tested errno semantics, and the family is ~1.2k
  lines of ABI tax per node.
