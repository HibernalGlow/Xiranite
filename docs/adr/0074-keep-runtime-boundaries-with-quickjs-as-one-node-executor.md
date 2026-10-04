# Keep the runtime boundaries; QuickJS is one node executor behind the node protocol

- Status: **proposed** — not in force until the Windows spike in §"Verification" passes. It is written
  down now because the architecture it fixes is what the remaining work has to be measured against.
- Date: 2026-10-05
- Amendment note (what it would change if accepted):
  - **ADR-0063**: keeps everything except one sentence — "Bun 只做开发与构建工具，不进入成品" becomes
    "a Node/Bun process may ship as the CLI/TUI *presentation shell*; it never executes node logic and
    never owns state". The Rust + Tauri + Axum + HTTP-protocol core is unchanged.
  - **ADR-0069**: keeps the four-face shape and "GUI is one Tauri app". Its per-face implementation
    clause (`CLI = clap`, `TUI = ratatui`, "the only business implementation is a native crate") is
    superseded: the CLI/TUI *framework* may stay Node (Clack/OpenTUI), and a node's business
    implementation is "whatever implements the node protocol" — today native Rust and QuickJS scripts.
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

### 5. CLI/TUI may keep a Node presentation shell; the GUI may not need Node at all

`npm install -g xiranite` remains acceptable for the developer-facing tools if the Node process is only
a terminal-UI framework that calls into the Rust runtime — and the cost is stated out loud: users of the
CLI/TUI need a Node install; users of the GUI never do. The GUI is Tauri + Rust (+ the embedded
executor); it never launches a Node process.

## Verification (the gates that decide whether this ADR is accepted)

1. The six spike gates in `docs/migration/quickjs-substrate-evaluation.md` §6.3, with the node's
   existing TypeScript tests as the fidelity oracle (unchanged assertions).
2. **Windows (MSVC x64) build and run of the executor.** Upstream marks that combination experimental;
   this is the only veto. Everything else is tunable, this is not.
3. Locale/time/random reach parity through the host: one golden table of collation and timestamp cases
   asserted identically through the CLI path and the GUI path.
4. A node executed through the new executor produces the same result document as the native
   implementation of the same node (dissolvef is the available pair), including the undo journal.
5. `bun run audit:node-registry` and the other existing gates stay green with the executor added:
   registration is still link-time, one id per node, one implementation per id.

## Consequences

- Positive: the 17.7k-line logic asset and its 14.5k lines of tests survive; one product runtime for
  node logic rather than two; the engine primitives that make pause/cancel/memory limits real come back.
- Negative, accepted: the CLI/TUI shell still requires a Node install; an interpreter is slower than a
  JIT on the three compute-heavy nodes (classf/encodeb/marku) and must be measured, not assumed.
- One-time behaviour change: locale-, time- and randomness-sensitive results move from "whatever the
  running Node/QuickJS did" to the host's single implementation. Existing tests that encode the old
  machine-dependent ordering have to be re-baselined **once**, deliberately, with the diff reviewed.
- Work superseded: the per-node Rust ports stop being mandatory; dissolvef's port is kept as the native
  executor's reference implementation rather than thrown away.
