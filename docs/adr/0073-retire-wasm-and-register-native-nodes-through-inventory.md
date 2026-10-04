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
   3. the five `plugins/*` crates that already reach Rust move to native crates in the workspace, and
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

## Unverified, deliberately not asserted

- Windows numbers for every measurement above (the release gate is Windows; re-run the same three
  shapes there before quoting these ratios to anyone else).
- Whether any retained node needs something that only a sandboxed boundary could have provided
  (untrusted third-party code). None does today; that is an assumption about the product, not a fact
  about the code.
- The behaviour seam (`Node::run`). It is intentionally not invented here; it comes out of the
  `DissolvefRuntime` trait during step 2.
