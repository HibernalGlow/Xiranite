# Keep recursive directory enumeration on the host and limit ADR-0071 to content I/O

- Status: accepted
- Date: 2026-10-04
- Amendment note: this **narrows ADR-0071 Decision 3**. ADR-0071 is correct that `std::fs` against WASI
  preopens beats any hand-written `xiranite.fs.*` family for *content* access — open, `seek`, positional
  read/write, and listing a single directory. It is wrong for **walking a tree**, which is the hot path of
  roughly a quarter of the retained nodes. ADR-0071 stands unmodified on everything it measured; this ADR
  only draws the line where its rule stops paying.
- Related: `docs/adr/0063-…-extism.md`, `docs/adr/0066-…-plugin-pause.md`,
  `docs/adr/0069-…-clap-ratatui-react.md`, `docs/adr/0071-serve-node-file-io-through-wasi-preopens.md`

## Context

ADR-0071 hands plugins `std::fs` and retires the `xiranite.fs.*` names. Read literally, that tells the next
ported node to replace its directory walk with `std::fs::read_dir` inside the guest. Measured below, that is a
3.6×–35× regression that gets worse with directory size, and it is not caused by our ABI — we already deleted
the ABI. It is caused by the WASI preview1 shim.

The old TypeScript did not have this problem because it asked for the cheap thing: `cleanf` walks with
`readdir(path, { withFileTypes: true })` (`packages/nodes/cleanf/src/platform.ts:101-104`) — file types come
from the dirent, **zero `stat` per entry**. `dissolvef`'s port kept that intent explicitly:
`crates/nodes/dissolvef/src/host.rs:64` documents `list_dir` as "`platform.ts:80-88`: `readdir` with file
types" and reaches it through one host call per directory (`host.rs:392,474-478`). So today's shape is already
"host walks, guest decides". The risk is a mechanical refactor deleting that seam together with the retired
capability names.

## Measurement

Guests built with `cargo build --release --target wasm32-wasip1`, run in-process through `extism` 1.30.0 with
`with_wasi(true)` and `allowed_paths` preopens, on macOS/arm64/APFS. Baseline is the **same Rust source**
compiled for the host target. Every row is the median of three interleaved runs.

| shape | guest `read_dir` (name+type) | guest `read_dir` (per-entry metadata) | host walk → listing | guest reads+parses listing | ratio |
| --- | --- | --- | --- | --- | --- |
| 22,000 entries over 2,000 dirs | 421 ms | 691 ms | 110–125 ms with size; 65–80 ms without | 6.9 ms (313 ns/entry) | **3.6×–5.9×** |
| 16,000 entries in **one** dir | **2,291 ms** | 2,380 ms | 62 ms | 4.4 ms (277 ns/entry) | **~35×** |
| 4,000 / 8,000 / 16,000 in one dir | 221 / 693 / 2,291 ms | — | — | — | exponent ≈ **1.7** |

Per-entry cost in the guest is 19 µs in the wide tree and 143 µs in the flat directory — the same code, the
same filesystem. It grows with directory size because of the shim:

- `wasi-common-43.0.2/src/sync/dir.rs:168-225`: every `fd_readdir(cookie)` **reopens the directory**, calls
  `entry.full_metadata()` for **every entry**, and then `.enumerate().skip(cursor)` — so resuming a listing
  replays and re-stats the whole prefix. A native walk reads `d_type` and never stats.

Method note worth keeping so nobody re-litigates a number: single-shot timings on this machine ranged
**44 / 81 / 256 / 583 ms** for the *same* host-side walk of the same tree (cold dentry cache plus Spotlight
indexing freshly written files). The first reading of that spread says "stat costs 7×"; interleaved medians say
it costs nothing measurable, and that a 242 KB `fs::write` of the listing is inside the noise.

Extrapolated, not measured: one directory of 50,000 entries ≈ **15.9 s** in the guest (N^1.7) versus
≈ 190 ms host walk + ~14 ms parse ≈ **205 ms**, i.e. ~78×, and the host term stays linear.

## Why this is not "put file I/O back on the host"

The boundary is shape, not nostalgia:

- **Content access stays in the guest.** ADR-0071 §2 measured open/`seek`/`read_exact`/`write_all` working,
  which is exactly what `smartzip` (ZIP tail), `coveru` (decompressed entry) and `trename`'s dictionary need,
  and no host capability serves them well.
- **Single-directory listing stays in the guest.** At 19 µs/entry, a 500-entry directory is ~10 ms. Routing
  that through a service would be the over-engineering AGENTS.md warns about.
- **Only recursive enumeration moves.** Named from the current tree: `migratef kavvka bitv smartzip lorat
  repacku encodb trename cleanf linku` walk recursively, plus `dissolvef`'s planning phase. Everything else
  has a plain `listDir`.

Duplication measured in the plugin surface today: **21 nodes, 24 hand-written `walk`/`listDir` helpers, 262
lines** (largest: `cleanf` 25, `linku` 21, `kavvka` 17), nearly all 9–15-line copies. Consolidating is a net
deletion, not a new per-node chore.

## Decision

1. **Recursive enumeration is a host service, and it lives in `xiranite-node-runtime` — not in `xiranite-api`.**
   In-process is the whole point: CLI (`x<id>`), TUI and GUI each link it, and a per-node Tauri bundle ships it
   with its own host. If the walk existed only as an HTTP route, `x<id>` would require a running main app and
   ADR-0069's independent-face promise would be false.
2. **Delivery is data, not a capability name.** The host walks the granted roots and hands the listing to the
   guest as the operation's input document or through an `OperationHandle` stream; the guest reads it with
   `std::fs` (the 0.28–0.31 µs/entry path above). The vocabulary ADR-0071 settled at 9 names **stays at 9**.
3. **The listing is a versioned contract.** `xiranite-listing/1`, one entry per line
   `name<TAB>type<TAB>size?`, size emitted **only when the node declares it needs it**. This is part of the
   single vocabulary the three faces read, so `audit:node-definitions` must cover it: a CLI and a GUI that see
   different trees would produce different plans.
4. **The host walk must emit progress and honour pause/cancel.** This is a new requirement, not an existing
   one: ADR-0066's pause waits *inside a host call*, and during pre-walk the guest is not running yet, so
   `POST /operations/:id/pause|cancel` currently has nothing to act on. The walker must check the operation
   phase between directories and emit the same events the guest would have.
5. **Keep the cheap listing shape; size is opt-in.** The host's existing `list()` already does the right thing:
   it reads `entry.file_type()` and never stats (`crates/xiranite-core/src/filesystem.rs:237-251`; `DirEntryInfo`
   carries only `name/path/is_file/is_directory` at `:90-99`, while `size_bytes` belongs to the **stat** shape
   `PathInfo` at `:113`). The enumeration service must preserve that shape — `name<TAB>type`, size emitted only
   when the node declares it. Measured worth on the flat-16k directory: **62 ms → 17 ms**.
6. **`dissolvef`'s `list_dir` seam is retargeted, not deleted.** When ADR-0071's order removes the `fs.*`
   imports (`host.rs:392,474-478`), that trait method re-points at the enumeration service. Its `in_memory_host`
   test double keeps the same shape so plan parity stays testable without a filesystem.
7. **Scope of work, stated so it is not mistaken for a per-node tax:** one-time ≈ 600–900 lines
   (host walker with grant checks + progress + cancel + listing encoder 400–600; shared guest-side reader/parser
   in `xiranite-plugin-api` 150–250; definition field plus gate 30–60). Per node: **delete 9–25 lines, add 0**,
   plus 1–3 declaration lines in the node definition it must write anyway.
8. **`findz` is the precedent, not a casualty.** `native/findz-go/scanner.go` + `database.go` +
   `scanner_benchmark_test.go` already keep walking and indexing on the host side. It stays `blocked-native`
   for the unrelated reason ADR-0071 §4 records (`@parcel/watcher`, and no fs-change notification in WASI or
   WASIX).
9. **Do this while the faces are still unbuilt.** Verified today: no node crate has a `[[bin]] x<id>` yet
   (only `xiranite-desktop` declares bins), and neither `xiranite-cli-runtime` nor `xiranite-tui-runtime` is in
   the workspace members list. The cost of fixing the enumeration shape after 20 ports is 20 refactors.

## Consequences

- Nodes that walk get a fast, linear enumeration; nodes that don't, never learn this ADR existed.
- The plugin ABI keeps 9 names; `audit:plugin-manifests` is unaffected by this ADR.
- A tree's listing is now an input document, so an operation's request grows with directory size (242 KB for
  22,000 entries ≈ 11 bytes/entry). Whatever ceiling applies to input documents needs to be stated in the same
  change that lands this, not discovered later.
- `docs/plugin-architecture.md` and the TUI rule ("目录遍历属于宿主侧能力") already describe host-side
  enumeration for the UI; this ADR extends the same rule to node cores, so those two texts should cite each
  other rather than read as separate policies.
- Untested, and not to be written as fact: the Windows numbers (Windows is the release gate — re-run these
  three shapes there before quoting this table at users), how many entries Rust's `std::fs::read_dir` requests
  per `fd_readdir` call (changes the constant, not the exponent), and the 50,000-entry extrapolation.

## Rejected alternatives

- **Guest-side recursive `std::fs::read_dir`, i.e. reading ADR-0071 literally.** Rejected by the table above:
  3.6×–35× measured, ~78× extrapolated, and superlinear, so the worst real directories are the worst hit.
- **Node cores as native `cdylib` instead of wasm.** The enumeration already runs native code on the host, so a
  cdylib buys only the listing's write+parse — ~7 ms per 22,000 entries — while costing the sandbox plus the
  fuel / epoch / `ResourceLimiter` guarantees ADR-0071 §3 measured, ADR-0069's single-implementation rule, and
  WIT-expressible boundary types. Not close.
- **A tenth capability name (`xiranite.enumerate.list`) pulled by the guest.** A pull shape is needed by
  interactive tree views, which are faces calling the same in-process service — not by the guest. Making it a
  capability would re-open the per-call ABI this round removed and would still be slower than one listing.
- **Putting all file I/O back on the host.** Contradicts ADR-0071 §2's positional-access measurements.
- **Per-node bespoke enumeration hooks.** That is the status quo (24 helpers), and it is what this ADR removes.
