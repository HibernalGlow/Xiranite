# Keep the runtime boundaries; QuickJS is one node executor behind the node protocol

- Status: **proposed** — not in force until the Windows spike in §"Verification" passes. It is written
  down now because the architecture it fixes is what the remaining work has to be measured against.
- Split status (2026-10-05, decided by the user, not by a spike): **§5 and §6 are accepted and in force
  now** — the terminal faces are Node/Bun TypeScript reaching the core over the existing `/operations`
  protocol, the napi-embedded and "core runs on the shell's own engine" shapes are rejected, and the two
  Rust face runtime crates retire. Their own gates (Verification 3 and 6) still have to run, but nobody may
  start a ratatui/clap terminal port on the strength of ADR-0069 any more. §1–§4 and the executor work stay
  **proposed** pending the QuickJS spike.
- §6 addendum (2026-10-05, same session, still the user's decision and not a spike result): a single-node
  release is a **build-target flavor, not a distribution unit** (the saved half is JS; the native layer and
  the user's state would be duplicated per package), and terminal host lifecycle is **spawn-and-read-channel**
  — one channel document, carried either by the spawned child's stdout or by a channel file whose path the
  caller passed in, so no discovery protocol, no well-known file and no fixed port is owed. It also
  re-measures §6's bundle figures against the pruned 30-node set. §6 stays accepted and in force; nothing here
  moves §1–§4 out of **proposed**.
- Date: 2026-10-05
- Amendment note (what it would change if accepted):
  - **ADR-0063**: keeps everything except one sentence — "Bun 只做开发与构建工具，不进入成品" becomes
    "a Node/Bun process *is* the shipped CLI/TUI face (§5); it never executes node logic and never owns
    state". The Rust + Tauri + Axum + HTTP-protocol core is unchanged.
  - **ADR-0069**: keeps the four-face shape and "GUI is one Tauri app". Its per-face implementation
    clause (`CLI = clap`, `TUI = ratatui`, "the only business implementation is a native crate") is
    superseded: the CLI/TUI framework **is** Node (Clack/OpenTUI) and reaches the core over the existing
    `/operations` protocol, and a node's business implementation is "whatever implements the node
    protocol" — today native Rust and QuickJS scripts.
  - **ADR-0073**: keeps the wasm/Extism retirement, the inventory registry, `NodeRequirements`, and
    every gate it introduced. Supersedes exactly one sentence: "节点的唯一业务实现是原生 Rust crate"
    becomes "a node has exactly one implementation, reached through the node protocol; the executor
    behind that protocol is a choice (native Rust, QuickJS script)".
  - This ADR does **not** resurrect Extism or wasm for built-in nodes.
- Related: `docs/migration/quickjs-substrate-evaluation.md` (the evidence pack),
  `docs/adr/0063-…-extism.md`, `docs/adr/0069-…-clap-ratatui-react.md`,
  `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`,
  `docs/migration/extism-retirement-checklist.md`

## Why

Two facts decided it, both measured in this repository:

1. The logic is the expensive part and it is already written in TypeScript: 41 retained nodes carry
   17,746 lines of `core.ts` plus 14,518 lines of node tests, against a Rust port that costs roughly
   1:1 plus tests (dissolvef: 3.6k TS → ~4.5k Rust + 108 tests). Running those bundles in an embedded
   engine removes the largest remaining chunk of migration work.
2. What the host has to provide is the same list either way: 8 `node:` builtins (`fs/promises` in 38
   nodes, `path` 36, `child_process` 31, `fs` 10, `util`/`os` 4, `crypto` 3, `url` 1), six bundleable
   npm packages, the external-program allowlist, and the OS-native services. The engine choice does not
   shrink that list; it only decides who runs the logic.

QuickJS additionally restores three engine primitives ADR-0073 recorded as given up (`set_memory_limit`,
`set_max_stack_size`, `set_interrupt_handler`), which is exactly what a long-running desktop node needs.
The evidence, including the sibling project that already ships this stack, is in
`docs/migration/quickjs-substrate-evaluation.md`.

## Decision

### 1. Core owns the runtime; the Core does not know JavaScript exists

`xiranite-core` owns: operation lifecycle (checkpoint / pause / cancel, the event stream, the undo
journal), the node protocol, scheduling and the task queue, storage, config, permissions, IPC. It holds
no JS value, no engine handle, and no `js_code: String`. "Node" in Core means "something that
implements the node protocol", not "a script".

This is already implemented, not aspirational: `crates/xiranite-node-registry` defines
`NodeDescriptor` (policy: roots, program allowlist, network, budgets) and `BuiltInNode` (behaviour),
and `crates/nodes/dissolvef` is the first implementation. A QuickJS executor is a *third* adapter
behind the same trait, exactly as ADR-0068 framed the Extism adapter.

### 2. Environment-dependent behaviour belongs to the Host Environment API

Any API whose result can differ by machine, OS, locale, clock or engine goes through the host, and
**every entry uses the same Rust implementation** — not "the CLI uses Node's `Intl`, the GUI uses the
host".

- `locale.compare/lower/upper/normalize` — 23 nodes use `localeCompare`/`toLocaleLowerCase`
  (52 + 59 + 1 occurrences); QuickJS ships no Intl, so a script's default `localeCompare` is a code-unit
  comparison, which silently reorders results (e.g. `ä` sorting differently than in Node).
- `time.now/format` — one clock, one spelling (`new Date().toISOString()`'s millisecond UTC form, which
  the undo journals already record).
- `random.uuid/bytes` — the host already supplies the undo id suffix; scripts must not call
  `Math.random()` for anything recorded.
- `fs.*` and `path.*` — the granted-root filesystem and the separator-neutral path helpers
  (`crates/xiranite-core/src/filesystem.rs`), not `node:fs`/`node:path` semantics.
- **Bytes cross as bytes.** ADR-0071's lesson stands: file content is never base64 inside a JSON
  envelope. A host call returns an ArrayBuffer/typed array (or a host-held handle), and positional
  reads are ordinary host calls.

One implementation, because two "equivalent" implementations are how `["a","ä","b"]` becomes
`["a","b","ä"]`.

### 3. One Core, one protocol surface, presentation-only entries

CLI, TUI and GUI are presentation. They speak the protocol the repository already has — the
`/operations` family plus node definitions and help text — extended where needed, never duplicated.
No new RPC vocabulary is invented for CLI convenience, and no entry gets an execution semantic the
others do not have (a `--flag` may not change what a run does, only how it is asked for).

### 4. Executors are adapters; isolation for third-party code is deferred

- Built-in nodes: one executor today (native Rust), a second one planned (QuickJS script bundles).
  A node has exactly one implementation; the registry decides which executor serves it.
- Third-party plugins: **explicitly not designed now**. When the requirement actually arrives, the
  boundary is chosen then (wasm component, or a process with a typed RPC). No abstract sandbox layer is
  built in advance, per ADR-0073's rule about not abstracting for a theoretical future.

### 5. The terminal faces *are* Node; the GUI never launches one

Decided by the user 2026-10-05, in answer to "why is there a runtime if the faces may use Node": because
"independent distribution" never licensed each node to re-hand-roll its terminal plumbing, and it never
licenses it now either. What is decided here is which ecosystem the shared plumbing belongs to.

**Terminal = Node/Bun TypeScript, chosen, not tolerated.** The reason is the ecosystem, not convenience:
the workbench controls, the Clack prompt surface and OpenTUI (`@opentui/core` 0.4.5) *are* the terminal
component library, and the only alternative is transcribing a moving target — `crates/xiranite-tui-runtime/src/tui/layout.rs`
opens by citing `packages/cli-runtime/src/tui/opentui/app.tsx:132-244` for every number in it, which is
exactly the transcription this clause now forbids. So `npm install -g xiranite` shipping a Node shell is
the expected shape, not a compromise; the stated cost is that CLI/TUI users need a Node install and GUI
users never do. The GUI is Tauri + Rust (+ the embedded executor); it never launches a Node process.

The boundary that replaces "the CLI is allowed to use Node" is a transport rule, and it has three
rejected alternatives recorded so nobody rediscovers them:

- **Accepted: the shell speaks the protocol.** A CLI/TUI process draws, asks and streams; every run goes
  through the repository's existing `/operations` surface (ADR-0063, ADR-0065's loopback bearer channel)
  to the host, and the host runs the node's bundle in the embedded QuickJS. One core, one engine, and the
  §2 environment rules (collation, clock, random, bytes) have exactly one implementation. This is already
  the shape of the TS faces — `packages/cli/src/index.ts:6` and `packages/cli-runtime/src/tui/task-queue.ts:1`
  are `@xiranite/api/client` consumers, and `packages/nodes/dissolvef/src/Tui.tsx:2` imports `./core.js` as
  `import type` only.
  What changes is the far end of that seam (Bun/Go backend → Rust host), not the existence of the seam.
  Accepted cost: a terminal run pays host startup/attach, so the host lifecycle (spawn-or-attach, TTL,
  shutdown) is CLI work, not an afterthought.
- **Rejected: embed the executor in the Node process** (a napi-rs addon around `xiranite-quickjs-executor`,
  the shape the sibling project Rossi/Breeze ships). It removes the daemon but adds a platform-specific ABI
  per release and a *second* route to the core, which is what §3's "one protocol surface, never duplicated"
  is against. Revisit only if host lifecycle turns out to dominate CLI latency, and measure it first.
- **Rejected: the terminal imports `core.ts` and lets its own V8/JSC run it.** Source would be shared, the
  engine would not, and §2's `["a","ä","b"]` divergence becomes a product bug between two faces of the same
  node. Any non-type import of a node's core from `cli.ts`/`Tui.tsx` is a violation of this clause — note
  the existing tail to clean: `packages/nodes/trename/src/Tui.tsx` imports the real `parseRenameJson`.

### 6. Distribution is one host binary carrying every node; the terminal face stays TypeScript

Distribution is a build-target question, not a source-tree question. Measured 2026-10-05: the QuickJS
engine costs 1.63 MiB in a release binary, a single node's bundle is 3 KB–1.0 MB, and **all 44 node cores
together bundle to 2.8 MiB**. So the multi-node shape costs almost nothing: the Rust host carries every
linked bundle plus one engine, and a standalone single-node release is a flavor cut of the same tree, not
a second program.

Re-measured the same day against the current tree, because the node set shrank and the old sentence now
reads as a range: `bun run build:node-bundles` produced **30 core bundles totalling 1,766,625 bytes
(1.68 MiB)** — `artifacts/node-bundles/manifest.json:51` `counts.nodes` and `ls packages/nodes | wc -l`
agree on 30 — smallest `linedup.core.js` at 3,111 B, largest `logx.core.js` at 527,107 B (then marku
337 KiB, lata 283 KiB, classf 213 KiB). The "44" and "2.8 MiB" above are the pre-pruning set; the ratio
that matters did not move, and it is the one this clause rests on: **the JS half of a host is smaller than
the engine that runs it** (1.68 MiB of 30 cores vs 1.63 MiB of QuickJS), so cutting bundles out of a
release buys less than it sounds like it does. Same re-measure for the asset §"Why" prices: 30 `core.ts`
files, **13,368 lines**, and 133 in-node test files, **11,733 lines** (`packages/nodes/*/src/core.ts`,
`packages/nodes/*/src/*.test.ts`) — the 41/17,746/14,518 figures above are the pre-pruning set, and the
conclusion held when the set was larger.

What must not be re-invented: the terminal face. `packages/cli` (`@xiranite/cli`) already is the aggregate
CLI — `bin.xiranite`, `node-cli-registry.generated.ts` dispatch, and a TUI (`Tui.tsx`/`tui-runner.tsx`) —
and under §5 it stays TypeScript calling into the host. ADR-0069's "`CLI = clap`, `TUI = ratatui`" clause
is superseded precisely here; with §5's split status the clause is closed, so nothing may start a per-node
Rust bin or a ratatui port on the strength of ADR-0069 any more.
(Recorded because it happened: a Rust `crates/xiranite-cli` with bins `xr`/`xiranite` was written and
removed the same day — it duplicated `@xiranite/cli` and collided on the `xiranite` bin name. What stays
from it is the lesson: dispatch is `NodeRegistry::runnable(id)`, and a node crate that nothing references
is not linked, so a host must name its nodes through `link_nodes!` and fail loudly when the anchor list and
the collected table disagree.)

**Consequence for the two Rust terminal runtime crates: they retire, and they were never wired.** Measured
2026-10-05, in this tree, not in a document: neither `crates/xiranite-cli-runtime` (~2.9k lines) nor
`crates/xiranite-tui-runtime` (~4.1k lines) appears in the root `[workspace] members` (`Cargo.toml:13-24`),
and no `Cargo.toml` anywhere takes a path dependency on them — so nothing links them, which is the same
silent-unregistered failure mode ADR-0073 built `audit:node-registry` for. `xiranite-quickjs-executor` is
the one crate in this area that declared its own `[workspace]` root to stay buildable while unlisted. The
shared terminal layer §5 keeps is TypeScript: `packages/cli-runtime` (`@xiranite/cli-runtime`, Clack +
OpenTUI + `interaction.ts` + the `help.ts` vocabulary) and `packages/cli`. The Rust crates' content does not
move anywhere; the *invariants* they were written to protect move into the protocol and the definition
contract: one vocabulary (`help.ts` must not drift), one danger gate, one keymap, and — per §2 — one
implementation of every environment-dependent entry, which is the host's, not the shell's.
`docs/tui-rust-widget-strategy.md` is superseded by this clause (its "no hand-drawn base controls" rule and
its authorized-enumeration-stays-on-host rule both survive as TypeScript rules; only the Rust crate stack —
ratatui/`tui-input`/`ratatui-textarea`/`tui-tree-widget`/`yazi-adapter`/`ratatui-image` — goes).

**Retiring is not deleting, and the deletion is not this clause's to take.** The files
`crates/xiranite-tui-runtime/src/tui/{form,help,layout}.rs` are untracked and in another session's in-flight
set (`docs/migration/extism-retirement-checklist.md:387` says so, and it is the reason a vocabulary rename
there was deliberately left undone). What this clause enforces from now on is *no new work* in those two
crates; their removal happens in a commit owned by whoever holds those files.

**A single-node flavor is a build target, not a distribution unit (asked and answered 2026-10-05).** The
proposal was: if a node ships alone, compile only that node's JS into its own QuickJS host, and then there is
no host to find. The first half is true and cheap — the executor takes the bundle text at the registration
site (`crates/xiranite-quickjs-executor/src/node.rs:46`), and `quickjs-run` already proves load-bundle →
run-export → one JSON document. The second half is why it stays a flavor:

- The half that would be saved is the cheap half. 30 core bundles together are 1.68 MiB; the native layer a
  flavor cannot cut — tokio/Axum, the engine, the 30 host operations in `host_calls.rs`, the inventory
  registry, and the host services — is linked whole by *every* flavor. Five node packages installed as
  self-contained bins are five copies of that, which is the "每个发行绑 35 MiB 不可接受" the user rejected,
  arriving per package instead of per app.
- It splits state and policy, which is worse than the bytes. Each self-contained bin opens its own settings
  store, its own undo journal, and its own granted-roots + program-allowlist table (`NodeDescriptor` policy),
  and the services that are genuinely shared — recycle-bin trash/restore, recursive enumeration, the
  `service.invoke` pass-through — stop seeing each other. That is the same failure mode that retired the
  per-node `Trename.exe` GUI (ADR-0069, AGENTS.md): N copies of shared infrastructure and N divergent copies
  of one user's state.
- The "no host to find" benefit does not require it. See the next clause: the shell spawns the host, so a
  terminal run is self-sufficient with one shared binary.

So: a `xiranite-findz`-shaped artifact is allowed, and it is produced by selecting a manifest subset at build
time against the same host code. It is not the unit of npm distribution, and nothing may fork the host to
make one.

**Host lifecycle for a terminal run is spawn-and-read-channel: one document, two transports, no discovery
protocol.** Recorded because this session nearly shipped the wrong gap list ("there is no headless host"):
headless start already exists and is already tested. `crates/xiranite-desktop/src/bin/dev_host.rs` binds the
real host with no window and no window server, and `crates/xiranite-desktop/tests/headless_host.rs` asserts
the channel contract end to end (`:50-61` the WebView validator accepts it and camelCase
`baseUrl`/`token`/`instanceId` *are* the protocol; `:71-112` `/health` answers without a token, wrong and
missing tokens get 401, a query token is a valid credential, OPTIONS is answered by the host with 204). The
channel is published as exactly one stdout line, `XIRANITE_CHANNEL {json}` (`dev_host.rs:62-75`), and
`instanceId` is what lets a caller tell "a live host" from "a host that restarted under me". Two provenance
notes: the `--channel-file` branch cited below landed in `dev_host.rs` while this clause was being written,
and `crates/xiranite-desktop` currently shows as staged-deleted-but-present in another lane's `git status` —
re-read those paths before citing them again.

> **Path relocation, 2026-10-05 (`docs/adr/0076-split-the-loopback-host-out-of-the-tauri-desktop-crate.md`):**
> every path above was correct when written. The headless binary is now
> `crates/xiranite-loopback-host/src/bin/dev_host.rs`, the channel proof is
> `crates/xiranite-loopback-host/tests/headless_host.rs`, and the WebView-asset assertions moved to
> `crates/xiranite-desktop/tests/webview_assets.rs`. The **built binary path is unchanged**
> (`target/debug/xiranite-dev-host`, one workspace one `target/`); only the package selector moved:
> `cargo build -p xiranite-loopback-host --bin xiranite-dev-host`. Line-number citations inside those files
> are not re-verified here — cite the crate and re-read before quoting a line.

Given that, the shape §5's accepted cost ("the host lifecycle is CLI work") resolves to **one channel
document carried by two transports**:

- **Child pipe (the default).** The shell spawns the host as its own child and reads the channel line off that
  child's stdout. This case writes nothing to disk: no well-known file in the data directory, no fixed
  port. A fixed port is already wrong for an independent reason (`lib.rs:54-55`: port 0, read back from the
  socket, because a fixed port makes a second instance collide instead of bootstrap).
- **Caller-named file (the non-child case).** A face that is not a child cannot read that stdout, so the same
  document may be asked for at a path the *caller* passes — `--channel-file <path>` /
  `XIRANITE_CHANNEL_FILE` (`dev_host.rs:77-91`, `:111-118`), removed on the way out because "a channel pointing
  at a closed port is worse than none" (`:97-101`). Its own comment records the intent: this is what makes
  `xiranite <node> --backend auto` work **without a second discovery protocol**. That is the rule to keep: the
  path is handed in, never guessed; a third transport (a registry of running hosts, a fixed socket name) is not
  authorised by this clause.
- Attaching to an already-running host is an optimisation, and `instanceId` is what makes it safe — it is the
  restart detector the test already asserts on (`tests/headless_host.rs:54`).
- What is genuinely missing is a **release-buildable** host bin. `dev_host.rs:28-34` exits before it binds
  under `--release` *because* it prints the bearer token, and `HostChannel`'s `Debug` redacts it on purpose.
  The shipped path may hand the token to one reader only — the parent that spawned it, or the one path that
  parent named — so the gate to change is "the channel goes to the spawn pipe", not "debug builds only", and a
  channel file that survives its writer stays debug/dev-only territory. Do not solve this by widening the
  token's audience.
- Also missing, and this is the other half of "one host carrying every node": the 30 production bundles are
  **not wired in**. `include_str!` occurs in this crate only inside doc comments (`src/node.rs:13/32/46`,
  `src/engine.rs:49`); the dev harness reads `artifacts/node-bundles` from disk. Until the wiring lands, the
  shape above is the target, not the current state.

## Verification (the gates that decide whether this ADR is accepted)

1. The six spike gates in `docs/migration/quickjs-substrate-evaluation.md` §6.3, with the node's
   existing TypeScript tests as the fidelity oracle (unchanged assertions).
2. **Windows (MSVC x64) build and run of the executor.** Upstream's platform table marks that
   combination experimental, but the sibling project Rossi already builds and ships rquickjs on that
   exact machine (it enables `bindgen` + the `rquickjs-sys` fork), so the engine family is not in doubt.
   What one run there adds is narrower: whether Xiranite's own probe — **without** `bindgen`, i.e. on the
   pre-generated bindings — also builds, which decides whether build machines need LLVM at all. If it
   does not, enabling `bindgen` like Rossi is the fallback, not a redesign.
3. Locale/time/random reach parity through the host: one golden table of collation and timestamp cases
   asserted identically through the CLI path and the GUI path.
4. A node executed through the new executor produces the same result document as the native
   implementation of the same node (dissolvef is the available pair), including the undo journal.
5. `bun run audit:node-registry` and the other existing gates stay green with the executor added:
   registration is still link-time, one id per node, one implementation per id.
6. **§5's transport rule has a machine gate, not just a sentence.** An ast-grep scan (the `packages/tauri-migrate`
   analyzer is already the tool for this, per ADR-0067) asserts that no `packages/nodes/*/src/cli.ts` or
   `Tui.tsx` holds a *value* import from that node's `./core.js` — type-only imports pass. The gate must fail on
   the known positive control `packages/nodes/trename/src/Tui.tsx` (`parseRenameJson`) until that import moves
   behind the protocol, so a clean run is evidence rather than an empty pattern.
7. **§6's spawn path needs a gate with a positive control, not a sentence.** One test: spawn the *release* host
   bin, parse exactly one `XIRANITE_CHANNEL` line from its pipe, and drive one `/operations` run to a result
   document through it. The same test must go red when the bearer token is wrong (the 401 assertions already in
   `crates/xiranite-desktop/tests/headless_host.rs:91/95` are the control), otherwise "green" only proves the
   spawn was skipped. Separately, a single-node flavor is checked by `bun run audit:node-registry`: the manifest
   subset the bin advertises and the bundles it actually linked must agree — the "a node that nothing references
   is not linked" mode §6 records for `link_nodes!`, reappearing as a packaging bug instead of a missing
   registration.
   Half of this already has teeth, measured 2026-10-05 against dissolvef: spawning `xiranite-dev-host` (debug
   build, 40 s TTL, one granted temp root) yields a parseable channel line, and the documented chain answers
   `/health` 200 with no token, 401 for a wrong and for a missing token, then
   `POST /nodes/dissolvef/operations` → `queued` → terminal phase `completed` with `result.success` and
   `archivePaths` equal to the fixture archive, and the port is confirmed closed once the process leaves. Two
   things this does **not** close: that run was the **native Rust** dissolvef (`launcher.node_ids() == ["dissolvef",
   "kisaki"]`, `crates/xiranite-builtin-host/tests/operations.rs:148`), so the bundle-wired half is still untested;
   and it was a debug binary, because `--release` still exits before it binds. One contract detail is pinned here
   because a hand-written client got it wrong: the start route takes the node input inside an `{"input": …}`
   envelope (`crates/xiranite-api/src/routes.rs:44-49`, `:77-82` — a bare body is legal and reaches the node as
   `{}`, which is how "Path is required." shows up as a `phase:"error"` record rather than a 400).

## Consequences

- Positive: the 17.7k-line logic asset and its 14.5k lines of tests survive; one product runtime for
  node logic rather than two; the engine primitives that make pause/cancel/memory limits real come back.
- Negative, accepted: the CLI/TUI shell still requires a Node install, and a terminal run now owns host
  lifecycle (spawn-or-attach, finite TTL, shutdown) that the GUI gets for free from Tauri; an interpreter is
  slower than a JIT on the three compute-heavy nodes (classf/encodeb/marku) and must be measured, not assumed.
  §6 narrows that cost to one mechanism — spawn a child and read its single `XIRANITE_CHANNEL` line — so no
  discovery file and no fixed port are owed; what is owed instead is a release-buildable host bin and the
  bundle wiring that 30 production bundles still lack.
- One-time behaviour change: locale-, time- and randomness-sensitive results move from "whatever the
  running Node/QuickJS did" to the host's single implementation. Existing tests that encode the old
  machine-dependent ordering have to be re-baselined **once**, deliberately, with the diff reviewed.
- Work superseded: the per-node Rust ports stop being mandatory; dissolvef's port is kept as the native
  executor's reference implementation rather than thrown away.
