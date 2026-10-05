# The loopback backend host is its own crate; the Tauri crate is only a window

- Status: **accepted** — decided by the user 2026-10-05, answering "真·零 Tauri 的服务器二进制… 动手拆".
- Date: 2026-10-05
- Related: `docs/adr/0063-…-extism.md` (Rust + Tauri 2 + Axum), `docs/adr/0065-…` (loopback + per-instance bearer token),
  `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md` §6 (host lifecycle = spawn-and-read-channel;
  its §6 file paths are relocated by this ADR), `docs/adr/0069-…` (four faces, shared runtime)

## Why this was a question at all

Asked plainly: *can the frontend run by itself while the backend runs in a server-ish mode, given that the core is
QuickJS + Rust and should not need Tauri?* Answer: yes, and the answer was already true before this ADR —
`xiranite-dev-host` is a headless host that binds the real backend with no window. What was **not** true is that a
headless host could be *built* cheaply. The binary lived in `crates/xiranite-desktop`, whose `build.rs` runs
`tauri_build::build()` and whose `lib.rs` carried `#[tauri::command]`. A Cargo build script runs per **package**, not
per target, so asking for `--bin xiranite-dev-host` still compiled `tauri`, `tauri-build`, `tauri-runtime-wry` and the
frontend-asset codegen that reads `build.frontendDist`. Feature-gating cannot fix that: the dependency is reachable
through the library the binary links, and the build script is unconditional either way.

So the boundary was wrong in exactly the way ADR-0069 warns about — a shared capability parked inside one App crate.

## Decision

1. **`crates/xiranite-loopback-host` owns the backend-as-a-host**: the bind/ephemeral-port/token/instance-id/router/
   graceful-shutdown path (`start_backend`, `HostChannel`, `BackendStart`, `BackendHandle`), the CORS grant, the
   environment-driven node staging (`stage_from_environment`), the bearer token generator, the channel document
   (`channel_document` / `write_channel_file` / `remove_channel_file`), the `BootstrapPayload` wire shape, and the
   `xiranite-dev-host` binary. It depends on `xiranite-api`, `xiranite-core`, `xiranite-builtin-host`, `axum`, `tokio`,
   `serde`, `serde_json`, `getrandom` — **and nothing windowing**.
2. **`crates/xiranite-desktop` keeps only what is true because there is a window**: the `xiranite_bootstrap` command,
   its name, the `BootstrapState` wrapper, Tauri assembly, `tauri.conf.json`, `capabilities/`, `frontend/`.
3. **The name is deliberately not `xiranite-host`** — `crates/xiranite-native-host` already exists (the browser-extension
   native messaging host), and a substring-colliding name makes `rg xiranite-host` lie about which crate it hit.
4. **The runtime topology does not change, and this ADR must not be read as changing it.** This is a *crate* boundary,
   not a *process* boundary. The desktop binary still calls `start_backend` in its own process on one OS thread with its
   own Tokio runtime and hands the channel to its WebView through managed state; no child process is spawned, no port
   travels through an environment variable, and there is still exactly one host process per GUI. The deleted layer was
   "Bun/Go holds a backend subprocess"; that stays deleted.
5. **`xiranite-dev-host` stays debug-only and loopback-only.** It prints the bearer token on stdout on purpose, so a
   release build exits before it binds, and the `*` CORS grant is justified only by "loopback + per-process token that
   only this host's client is handed". Anyone who wants to expose this host beyond one machine must re-open that
   question in a new ADR rather than reuse this one.

## Measured on this machine, 2026-10-05 (arm64 macOS, rustc 1.98.1, one Cargo job, sccache)

| claim | evidence |
|---|---|
| the headless crate links no windowing stack | `cargo tree -p xiranite-loopback-host -e normal \| rg -i "tauri\|wry"` → **no match**. The same gauge against `xiranite-desktop` returns **13 matches**, so the gauge is not blind (positive control) |
| graph actually shrinks | unique packages: **434** (host) vs **551** (desktop); tree lines 1142 vs 1665 |
| the 8 apparent `objc2` hits in the host graph are not Tauri | they are `xiranite-core`'s macOS native path (recycle-bin/trash), printed by a deliberately wider pattern |
| both crates build | `cargo build -p xiranite-loopback-host` rc=0; `cargo build -p xiranite-desktop` rc=0 after the split |
| the ADR-0065 evidence chain survived the move | `cargo test -p xiranite-loopback-host` rc=0 → **11** lib + **4** bin + **6** integration, including `the_built_in_quickjs_node_runs_a_dissolvef_operation_over_the_real_socket`; `cargo test -p xiranite-desktop` rc=0 → 2 + 2 (the two WebView-asset assertions, which moved *to* the shell that owns `tauri.conf.json` and `frontend/index.html`) |
| lint | `cargo clippy -p … --all-targets --no-deps -j 1 -- -D warnings` rc=0 for both crates |
| server mode still works end to end | spawned `xiranite-dev-host --ttl-seconds 14 --channel-file …`: staged `nodes [dissolvef, kisaki]`, wrote the channel document, `/health` 200 without a token, `/node-operations` **200** with `x-xiranite-token` and **401** without, then at TTL: process exited `stopped cleanly`, channel file removed, port refused |

## A dead path this move exposed (fixed here, not left behind)

The previous `dev_host.rs` read `--channel-file` out of the raw argv in one function while a second function rejected
every argument that was not `--ttl-seconds`, so **the flag could never be passed** — only `XIRANITE_CHANNEL_FILE` ever
worked. Two independent readers of one argument list is the bug; the parser is now single-owner and covers
`--channel-file <path>` and `--channel-file=<path>`, with four unit tests that pin both orders against `--ttl-seconds`,
refuse a value-less flag, and refuse unknown spellings (so a typo cannot silently serve a port nobody can find).
Worth stating explicitly: the reason this looked like "a stale binary" during the earlier probe was this defect in the
source, not a build cache.

## Consequences

- Two hosts now stage nodes through one function and publish one channel document; a face that parses a different key
  from one host than from the other is no longer possible without a compile error.
- `xiranite-desktop`'s dependency list is short (`xiranite-loopback-host`, `tauri`, `tauri-runtime-wry`), which makes the
  window's cost visible instead of shared with the backend's.
- Anything that ran `cargo build -p xiranite-desktop --bin xiranite-dev-host` must now say `-p xiranite-loopback-host`.
  The **binary path `target/debug/xiranite-dev-host` is unchanged** (one workspace, one `target/`), so a session that
  spawns the binary by path — including one that was running during this change — keeps working.
- A future per-node distributable (ADR-0069 §Standalone route A) gets a headless host for free: it is a shell choice,
  not a capability of the desktop crate.
- Not done here, and not implied: no remote/server mode, no fixed port, no non-loopback bind, no second `OperationManager`.
