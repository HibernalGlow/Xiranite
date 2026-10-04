---
status: accepted
superseded_by: "docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md"  # 整份作废：`FileHandle` 分块家族与 base64 穿 JSON 信封不再建；体积上限的理由由 `NodeRequirements.max_live_bytes` 接替。
---

# Serve the file-handle byte stream and give the text document its own capability pair

- Status: accepted, **superseded in part on 2026-10-04 by
  `docs/adr/0071-serve-node-file-io-through-wasi-preopens.md`** — the handle family specified here
  (`fs.open`/`fs.read`/`fs.write`/`fs.close`, `read_text`/`write_text`, `FileHandle` chunking) will not be built,
  because Extism's WASI serves the same file access with positional semantics that a sequential handle cannot
  express. The measurements in this ADR's Context (only `smartzip` and `coveru` need more than 4 MiB, and both
  need *positional* access) are what made ADR-0071 viable and are not retracted.
- Date: 2026-10-04
- Amendment note: this amends `docs/adr/0068-...md` in one respect. ADR-0068's file-system row lists
  `read`/`write`/`open`/`close` but never named a capability for the bounded *text document* the ported
  nodes actually need, so the host served a text read under `xiranite.fs.read` — a name whose own
  doc-comment says "reads one bounded chunk from an open handle". This ADR removes that drift instead
  of papering over it. It also settles one question ADR-0066 left open on purpose
  (`crates/xiranite-plugin-api/src/host_calls.rs:32`: "ADR-0066 names `xiranite.fs.open`, `.read` and
  `.write` but does not decide" the chunk shape).
- Related: `docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md`,
  `docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`,
  `docs/adr/0069-keep-node-cli-tui-gui-triad-with-clap-ratatui-react.md`

## Context

ADR-0068 decided that "large data crosses as handles" and that `FileHandle` is a host-assigned `u64`
read in caller-sized chunks. Nothing served it. `xiranite-node-runtime`'s host answered
`not_implemented` for `xiranite.fs.open` while `xiranite.fs.read` carried a whole text document, capped
at `MAX_TEXT_BYTES` (4 MiB) with the message "use a handle-based read" — advice that pointed at a
capability this repository had specified, version-stamped and never built.

Two measurements made in this tree on 2026-10-04:

- **The ceiling blocks retained nodes, and only them.** Among the 41 `retain-rewrite` nodes in
  `docs/xiranite-target-node-manifest.json`, exactly two need more than 4 MiB of file bytes in plugin
  memory: `smartzip` reads up to 32 MiB of a ZIP tail to detect the codepage
  (`packages/nodes/smartzip/src/platform.ts:270-273`) and `coveru` materialises a whole decompressed
  archive entry (`packages/nodes/coveru/src/platform.ts:56-68`). Every other read is `"utf8"` text, a
  self-capped 1 MiB head+tail probe (`packages/nodes/lorat/src/platform.ts:143-166`),
  a stream (`packages/nodes/logx/src/platform.ts:6-10`), or an external binary called with a *path*.
- **The plugin API trait already described the handle shape and was never implemented.** Nobody in this
  repository implements `HostCalls` (`crates/xiranite-plugin-api/src/host_calls.rs`), so the file-handle
  methods were a sketch, and one of them (`max_bytes: usize`) used a type ADR-0068 bans at the boundary.

The blast radius of the rename was measured rather than argued: with the text pair moved off
`fs.read`/`fs.write`, the staged `dissolvef.wasm` failed its write run with exactly the predicted
refusal (`xiranite.fs.write is a settled capability name but this host does not serve it yet`), which
is why the three ported manifests are part of this change.

## Decision

**`xiranite.fs.read` means handle chunks, as its own table entry says.** The request is
`{ operationId, handle, offset, maxBytes }` and the answer is `{ bytes }`, base64, where an empty
`bytes` is end of stream. `offset` has no default: "continue where the last read stopped" would put a
cursor in the host that the plugin cannot see, and ADR-0068 wants the *host-validated* offset, which
presupposes the caller naming it.

**The bounded text document gets its own pair:** `xiranite.fs.read_text` and
`xiranite.fs.write_text`, requests `{ operationId, path }` / `{ operationId, path, text }`, answers
`{ text }` (with `"text": null` meaning "no file", the `platform.ts:80-86` shape the nodes read) and
`null`. `MAX_TEXT_BYTES` stays where it is, because the ceiling's reason is unchanged: undo histories
and record files are documents, and a document that large is a bug report, not a stream.

**`xiranite.fs.write` stays settled and unserved.** ADR-0068 puts a streamed write behind the host's
file-operation journal so the run stays undoable; `xiranite-core` has no such journal yet, so
`fs.open` with `mode: "write"` refuses with `not_implemented`. Handing out an unjournalable write
handle would be the ADR's own forbidden move — an Extism-shaped shortcut that a later journal has to
retrofit.

**One chunk is 1 MiB (`MAX_CHUNK_BYTES`), and the caller picks a size under it.** 1 MiB is deliberately
below the smallest plugin instance in this repository (`plugins/transq/manifest.toml` runs with
`memoryMaxPages: 64` = 4 MiB of linear memory), so a chunk plus its envelope cannot crowd out the
plugin's own working set. A zero-length request is refused (`empty_chunk`) rather than answered empty,
because empty is the EOF answer and a plugin must not be able to confuse the two.

**The chunk rides the JSON envelope; there is no raw-byte answer channel.** This is the one place this
ADR *declines* to optimise. A raw block cannot carry `{ ok: false, error: … }`, and ADR-0068 makes a
capability failure data rather than a trap ("one locked directory must fail one item, not the whole
run"), so a raw-byte signature would either trap mid-stream or invent a second error path outside the
envelope. Base64 costs a third in size on a 1 MiB payload; the alternative — an Extism-internal framed
block whose ownership crosses the boundary — is exactly the mechanism class ADR-0068 bans from the API
layer, and would not survive a WIT adapter.

**A handle is the authorization decision made once.** `fs.open` resolves the path through the same
grant list every other `xiranite.fs.*` call uses (`FileCapability::resolve`, nearest-existing-ancestor
canonicalisation) and keeps *that* file open; a chunk read cannot smuggle in an ungranted path and
cannot race the path out from under the grant between two reads of one file.

**The table is per operation, matching ADR-0068's lifecycle split.** One `FileReadStream` lives in the
one `CapabilityHost` instance for a run, so a plugin that never calls `fs.close` leaks a descriptor for
that run only, and the drop reclaims it. A handle id is only live in the operation that minted it: the
same `u64` in a second operation's table is `not_found`, which is what keeps one loaded plugin serving
`Operation 1..N` honest.

**`FileAccessMode` crosses as a name, not a code.** `fs.open` takes `mode: "read" | "write"` so a
paused run's log line says what the plugin asked for; the mapping lives in the adapter-facing layer, and
the `u64`/`u32` widths of the rest of the request stay fixed because ADR-0068 bans machine words
(`usize`) as boundary types — which is also why `HostCalls::file_read` changed from `max_bytes: usize`.

## WIT-expressibility

Asked and answered per ADR-0068's test ("could this interface be expressed in WIT naturally?"):

```wit
interface file-system {
  resource file-handle;              // the host-assigned u64 becomes a WIT resource

  open: func(path: string, mode: access-mode) -> result<file-handle, plugin-error>;
  read: func(handle: file-handle, offset: u64, max-bytes: u32) -> result<chunk, plugin-error>;
  close: func(handle: file-handle) -> result<_, plugin-error>;
  read-text: func(path: string) -> result<option<string>, plugin-error>;
  write-text: func(path: string, text: string) -> result<_, plugin-error>;

  enum access-mode { read, write }
  record chunk { bytes: list<u8> }
}
```

Every type is a WIT shape: `string`, `u64`, `u32`, `enum`, `record`, `option`, `result`, `list<u8>`,
and `resource` for the handle — which is the mapping ADR-0068 predicted for its opaque `u64` tokens. The
base64 inside `chunk.bytes` is an Extism-adapter encoding detail: a WIT adapter passes `list<u8>` and
the API vocabulary does not change, which is the test the layering exists to pass.

## Alternatives considered

### Dispatch `fs.read` on request shape (path → text, handle → bytes)

Rejected. It keeps one symbol doing two jobs, so the manifest's capability grant cannot distinguish
"may read a document" from "may stream a file", and the WIT mapping of one `read` function with a
variant request is worse than two named functions. It also leaves the ADR table and the code describing
different things, which is how this drift started.

### Add `fs.read_bytes` and leave `fs.read` serving text

Rejected. `xiranite.fs.read` would permanently mean the opposite of its own documentation in
`host_function_names.rs`, and every future reader of the vocabulary inherits the ambiguity.

### Stream the bytes with `fs.open` reading into a guest buffer

Rejected as out of scope and against ADR-0068: host-written guest buffers at caller-supplied pointers
is precisely the raw-pointer/linear-memory ownership machinery the ADR keeps inside the adapter.

### Re-implement chunked reads as a plugin-side loop over `fs.read` with a smaller text cap

Rejected. It encodes binary data as text on every call and cannot express "read the last 32 MiB"
without a UTF-8 validity check standing in the way.

## Consequences

- `crates/xiranite-plugin-api/src/host_function_names.rs` is the 22-name vocabulary; the plugin API
  version fields do **not** move (`PLUGIN_ABI_VERSION` stays `1.0.0`) because nothing built against the
  20-name spelling has shipped, and a bump would describe a compatibility boundary that does not exist
  yet. The first release that carries the old spelling is the one that has to bump.
- `xiranite-core` grows `file_stream` (`FileReadStream`, `MAX_CHUNK_BYTES`) alongside `filesystem`, and
  `xiranite-node-runtime` serves `fs.open`/`fs.read`/`fs.close`/`fs.read_text`/`fs.write_text` — fourteen
  served names, each compile-time-checked to be a member of the vocabulary (the old guard compared
  list *lengths*, which would not catch a typo).
- The three ported manifests that declared the text pair move to `fs.read_text`/`fs.write_text`
  (`crates/nodes/dissolvef`, `plugins/timeu`, `plugins/transq`), and `scripts/audit-plugin-manifests.ts`
  maps the legacy `xiranite.file.read`/`.write` spellings onto the text pair, since what those ports
  actually did was read documents.
- **`fs.open` is not a prerequisite for the czkawka/Kisaki class of node.** A duplicate finder hashes
  arbitrarily large files, and the answer to that is not a faster byte pipe into a 16 MiB sandbox: it is
  the host computing the digest and crossing 32 bytes. That is the `rust-host` feasibility verdict
  (`packages/tauri-migrate/README.md:68`) and ADR-0069's "独立的是 Face，共享的是 Runtime" applied to a
  node: `native/czkawka-core` → a host service → `/operations` → the shared React surface, with no
  `<czkawka>.wasm`. What this ADR's handle family *is* for is the two nodes above, which genuinely must
  hold the bytes.
- Re-admitting `czkawka` under that shape still needs its own decision record: its disposition in
  `docs/xiranite-target-node-manifest.json` is `removed` (ADR-0064), and
  `bun run audit:target-node-manifest` is the gate that says so.
