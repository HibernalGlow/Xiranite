# Keep the Plugin API WIT-migratable while Extism stays the current runtime

- Status: accepted
- Date: 2026-10-04
- Amendment note: this amends ADR-0063 principle 8 ("Extism is the only plugin execution layer") in one
  respect: Extism remains the runtime **today**, but it is demoted from "the plugin API" to "the current
  adapter". Host-function names pinned in ADR-0066 are revised here to capability namespaces.
- Related: `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`,
  `docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md`,
  `docs/adr/0067-use-ast-inventories-as-migration-source-of-truth.md`

## Context

ADR-0063 made Extism the only plugin execution layer, and ADR-0066 pinned a host-function vocabulary.
Measured in this tree before that vocabulary spread:

- `crates/xiranite-plugin-abi/src/payload.rs:29` publishes `pub struct OpaquePayload(Vec<u8>)` as the
  boundary type, and `src/lib.rs` exposes `abi_code`, `host_calls` and `host_function_names` next to the
  business vocabulary — the ABI crate mixes the stable contract with the runtime-specific parts.
- `plugins/logx/manifest.json` carries `id`, `wasm`, `memoryMaxPages`, `allowedPaths`, `allowedHosts`,
  `hostFunctions` and **no version field at all**, so nothing distinguishes the plugin's own version from
  the plugin-API version it was written against.
- Five plugin ports already declared five dialects of the same capabilities, which the vocabulary gate in
  ADR-0066 now reports.

WASM Component Model with WIT is the credible next ABI, and the user's ruling is that the migration must
not require rewriting plugins: today's design may not create that debt. This ADR is the insurance, not a
Component Model implementation.

## Decision

**Three layers, named in code.** `Xiranite Plugin API` (stable, capability-oriented, cross-language DTOs)
sits above `Extism Adapter` (the only crate allowed to know about Extism ABI, linear memory and
`extism:host/env`), which sits above `plugin.wasm`. Replacing the middle layer with a
`WIT / Component Model Adapter` must not force changes in `xiranite-core` or in plugin business logic.
Business code and plugin manifests address API concepts, never Extism mechanisms.

**Types must be WIT-expressible.** The API vocabulary uses strings, booleans, sized integers, floats,
records, variants, enums, `list<T>`, `option<T>` and `result<T, E>`, plus opaque handles. Banned as
public protocol types: Rust-specific types, trait objects, Rust ABI, raw pointers, `usize`/`isize`,
lifetimes, Rust serialization tricks, and any Extism-internal data structure. Widths are explicit
(`u32`, `u64`, `i64`) because WIT has no machine-word type.

**JSON is an encoding, not the ABI.** `OpaquePayload` stays, but only inside the adapter as the wire
container. Every operation boundary gets a typed record, so a WIT `record` can be generated from the API
definition without parsing JSON semantics.

**Large data crosses as handles.** `FileHandle` / `OperationHandle` are opaque `u64` tokens assigned by
the host; bytes move through capability calls with host-validated offsets and caller-sized buffers, never
as one giant JSON document in a single call. This is both the Extism performance answer and the natural
future `resource` mapping.

**Host functions are capability interfaces, in namespaces.** Revised vocabulary (superseding ADR-0066's
flat names):

| Capability | Functions |
| --- | --- |
| file system | `xiranite.fs.read`, `.write`, `.open`, `.close`, `.stat`, `.list`, `.move`, `.copy`, `.delete`, `.ensure_dir`, `.set_times` |
| operation | `xiranite.operation.checkpoint`, `.update`, `.emit` |
| process | `xiranite.process.run` |
| resource | `xiranite.scheduler.acquire`, `.release` |
| diagnostics | `xiranite.log` |
| clock | `xiranite.now` |

Each has one typed request and one typed response, so the mapping to a WIT `interface` is mechanical. No
capability grants arbitrary filesystem, process or network access; the Extism manifest ceilings
(`allowed_paths`, `allowed_hosts`, `memory`, `timeout`) stay as the second layer, and a capability call
checks the handle against them again.

**Plugin lifecycle is not operation lifecycle.** A plugin instance is loaded once; operations are created,
paused, cancelled and finished per run, and every cross-boundary call carries an `operation_id`. One
plugin serves `Operation 1..N`. This matches both `xiranite-core`'s operation manager and the Component
Model instance/resource split.

**Errors are structured.** `PluginError { code, message, details: option(list<(string, string)>) }`,
where `code` is a stable machine-readable enum rendered in WIT as `enum`, and `message` is display text
for UI and logs only. Capability failures return `result`-shaped envelopes, they do not trap: one locked
directory must fail one item, not the whole run.

**Versions are three separate fields.** Every manifest declares `pluginVersion` (this plugin's release),
`pluginApiVersion` (the Plugin API major/minor it targets) and `runtimeVersion` (the WASM/Extism runtime
it was built for). `Xiranite`'s own version is not a plugin-API version: as long as Plugin API 1.x stays
compatible, a 1.x plugin keeps running under Xiranite 2.x.

**No speculative design.** No Component Model implementation, no WIT toolchain in the build, no resource
graphs built "for theoretical compatibility". The test for every added abstraction is the question the
user set: *could this interface be expressed in WIT naturally?* If not, redesign the interface rather
than cementing it with an Extism-specific mechanism.

## Plugins ship in Rust; the boundary stays language-neutral in shape

Plugin implementations in this product are written in Rust only. TinyGo and other-language plugin toolchains
were considered on 2026-10-04 and dropped: Homebrew core has no `tinygo` formula (the toolchain would come
from a 163 MB GitHub release tarball), `extism/tinygo-sdk` does not exist, and `extism/go-sdk` is the
**host**-side SDK built on wazero rather than a plugin-side one — so a non-Rust plugin would have to declare
`extism:host/env` and its exports by hand with no upstream support. No pilot, no promise, no second toolchain.

The boundary is still specified so it *could* be expressed by another language, because the point of
WIT-compatibility is ABI shape rather than multi-language marketing, and a boundary that only Rust can
express is a boundary a future WIT adapter also cannot express:

- Entry points are **flat exported functions** taking one `u64` (an offset/length pair in module memory)
  and returning one `u64`. No Rust-specific calling convention leaks across the boundary.
- Capability calls are **plain wasm imports** named by the capability vocabulary above; the Extism adapter
  is what registers them as host functions.
- Boundary data is the WIT-expressible set (fixed-width integers, `list<u8>`, UTF-8 text, records encoded
  explicitly, opaque `u64` handles). A plugin may not assume a Rust serialization layout, `serde` naming
  behaviour or an SDK-generated envelope.

`crates/xiranite-plugin-api` is therefore a vocabulary and type crate, not a plugin framework: the Rust
plugins import it, and `bun run audit:plugin-manifests` checks names and versions regardless of how a
plugin was built.

## Alternatives considered

### Keep Extism as the plugin API and rewrite plugins if WIT arrives

Rejected. Every plugin would encode `extism:host/env` calling conventions, linear-memory buffer ownership
and JSON-blob payloads, so a future WIT migration becomes an N-plugin rewrite plus a manifest format
change — the exact outcome this ADR forbids.

### Adopt the Component Model and WIT now

Rejected by the user's ninth principle and by ADR-0063's delivery scope: it buys an ABI nothing in the
product needs yet, costs a toolchain and host rewrite, and forfeits Extism's existing host-function and
manifest story. Recorded here as the rejected alternative so the layering can be re-evaluated when a real
WIT host exists.

### Put the stable API and the Extism adapter in one crate

Rejected. `crates/xiranite-plugin-abi` currently mixes both, and that is how `abi_code` and raw
`host_calls` leaked into what plugins import. Splitting them keeps the API crate free of runtime symbols,
which is checkable by the residue scan in ADR-0067.

## Consequences

- `crates/xiranite-plugin-abi` splits into `crates/xiranite-plugin-api` (stable vocabulary and typed
  records) and `crates/xiranite-extism-adapter` (the only crate permitted to reference Extism ABI). Typed
  request/response records replace `OpaquePayload` at the API surface.
- `xiranite.file.*` / `xiranite.checkpoint` / `xiranite.emit` / `xiranite.now` in ADR-0066, in the
  `bun run audit:plugin-manifests` canonical list, and in the five ported plugin crates are renamed to the
  capability namespaces above; the gate reports each undeclared name until it is fixed.
- `audit:plugin-manifests` gains three version checks (`pluginVersion`, `pluginApiVersion`,
  `runtimeVersion`) and rejects manifests missing them, so a plugin can never again be versionless.
- Host-function additions require a typed request/response pair plus a WIT-expressibility note in the ADR
  or a follow-up amendment; adding an `extism_*` specific mechanism to the API layer is a review reject.
- `packages/file-operations` and `xiranite-core` implement the capability side of these names; the React
  layer keeps talking to `/operations` over HTTP and never sees any of it.
