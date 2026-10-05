# Keep the runtime boundaries; QuickJS is one node executor behind the node protocol

- Status: **proposed** — not in force until the Windows spike in §"Verification" passes. It is written
  down now because the architecture it fixes is what the remaining work has to be measured against.
- Split status (2026-10-05, decided by the user, not by a spike): **§5 and §6 are accepted and in force
  now** — the terminal faces are Node/Bun TypeScript reaching the core over the existing `/operations`
  protocol, the napi-embedded and "core runs on the shell's own engine" shapes are rejected, and the two
  Rust face runtime crates retire. Their own gates (Verification 3 and 6) still have to run, but nobody may
  start a ratatui/clap terminal port on the strength of ADR-0069 any more. §1–§4 and the executor work stay
  **proposed** pending the QuickJS spike.
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

What must not be re-invented: the terminal face. `packages/cli` (`@xiranite/cli`) already is the aggregate
CLI — `bin.xiranite`, `node-cli-registry.generated.ts` dispatch, and a TUI (`Tui.tsx`/`tui-runner.tsx`) —
and under §5 it stays TypeScript calling into the host. ADR-0069's "`CLI = clap`, `TUI = ratatui`" clause
is superseded precisely here; the per-node Rust bins are not built while that clause is still open.
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

## Consequences

- Positive: the 17.7k-line logic asset and its 14.5k lines of tests survive; one product runtime for
  node logic rather than two; the engine primitives that make pause/cancel/memory limits real come back.
- Negative, accepted: the CLI/TUI shell still requires a Node install, and a terminal run now owns host
  lifecycle (spawn-or-attach, finite TTL, shutdown) that the GUI gets for free from Tauri; an interpreter is
  slower than a JIT on the three compute-heavy nodes (classf/encodeb/marku) and must be measured, not assumed.
- One-time behaviour change: locale-, time- and randomness-sensitive results move from "whatever the
  running Node/QuickJS did" to the host's single implementation. Existing tests that encode the old
  machine-dependent ordering have to be re-baselined **once**, deliberately, with the diff reviewed.
- Work superseded: the per-node Rust ports stop being mandatory; dissolvef's port is kept as the native
  executor's reference implementation rather than thrown away.
