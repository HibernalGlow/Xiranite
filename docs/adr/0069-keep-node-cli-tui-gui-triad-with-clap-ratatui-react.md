# Node-owned CLI and TUI faces, one shared Rust runtime, one WASM implementation per node

- Status: accepted
- Superseded by: `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md` — 仅 Node Core 的产物形态作废（`cdylib` + wasm target）；四面结构、CLI=clap+cliclack、TUI=ratatui、GUI 统一不打散、禁止在 face 里重写业务逻辑，全部继续有效。
- Date: 2026-10-04
- Amendment note: this narrows ADR-0063 principle 8 and the "layers to delete" list in AGENTS.md. The Node
  *runtime* goes; each node's logic, CLI and TUI do not, and the GUI stays one product.
- History, so nobody re-litigates it. This ADR went through three revisions in one day. Revision 2 concluded
  that because plugins are reached through a unified interface, `xiranite-cli` and `xiranite-tui` should each
  be *one* generic, definition-driven face, and it explicitly rejected per-node `[[bin]]` targets. **That was
  wrong and revision 3 overturns it**: 42 nodes carry deliberately designed node-specific terminal UX
  (trename's path diff, JSON tree, conflict panel and workflow actions; each node's own command structure),
  and collapsing them into a form renderer sacrifices existing product design for architectural tidiness.
  The settled line is **独立的是 Face，共享的是 Runtime** — with the GUI as the exception: it was always one
  unified product.
- Related: `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`,
  `docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md`,
  `docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`,
  `docs/adr/0064-drop-nodes-covered-by-standalone-projects.md`

## Context

Every node package ships four surfaces. A scan of the tree finds 42 of each of `cli.ts`, `Tui.tsx` and
`interaction.ts` under `packages/nodes/*/src/`, and the product depends on all of them:

| surface | today | who uses it |
| --- | --- | --- |
| `core.ts` | pure TypeScript | the GUI through `/node-operations`, and the CLI/TUI |
| `cli.ts` | `@xiranite/cli-runtime` (citty, Clack) on Node/Bun | terminal users, `bun run` scripts, QA harnesses |
| `Tui.tsx` | `@opentui/react` on Node/Bun | terminal users, `docs/*-tui-visual-review.md` gates |
| `Component.tsx` | React 19 in `src/nodes/<id>/` | workspace cards, floating windows, swimlanes |

The reason for the migration decides this ADR. If the end state were

```
CLI → Bun → TS → WASM
TUI → Bun → TS → WASM
GUI → Tauri → Node → WASM
```

the dependency the migration exists to remove would still sit under all three entry points, and a node that
"runs standalone" only because `bun` travels with it is not standalone. Meanwhile the asset the rewrite must
not lose is the node's business logic. For trename that asset is its **Chinese→English path translation
pipeline** — the `scan` / `import` / `validate` / `rename` / `undo` / `history` actions at
`packages/nodes/trename/src/interaction.ts:37` — not file renaming by pattern.

Two rankings bind the order of work:

- **业务逻辑优先于界面打磨.** A node's core is migrated before its terminal faces are polished; no amount of
  clap/ratatui fidelity compensates for a half-ported pipeline.
- **For trename the core already exists in Rust**, rewritten as a standalone program outside this repo (the
  user's location for it is `/Users/glow/tingzhi`; it is not present on the current machine, so the path is
  resolved at port time). Its port is a *wrap*: keep the pipeline, put it behind ADR-0068's boundary, compile
  to `trename.wasm`. That is the reference case, and proof that "the CLI/TUI host must be rewritten" does not
  imply "the node must be rewritten".

## Decision

**TS/React owns the Web. Rust owns every host. WASM is the single node business implementation. Each node
owns its logic, its CLI and its TUI; the GUI is one product; the runtime beneath everything is shared.**

| 面 | 归属 | 形式 |
| --- | --- | --- |
| Node Core | 每个 Node | Rust → WASM（唯一业务实现）|
| CLI | 每个 Node | 自己的 Rust 可执行文件（clap + Extism + 自己的 wasm）|
| TUI | 每个 Node | 自己的 Rust 可执行文件，或 `x<id> tui` 子命令（ratatui + Extism + 同一个 wasm）|
| GUI | Xiranite 统一 | `src/nodes/<id>/*.tsx` 打进一个 bundle，由一个 Tauri 壳承载全部 Node |

```
                    trename.wasm   ← the only business implementation
                ┌───────┼───────────────┬────────────────┐
                ↓       ↓               ↓                ↓
            xtrename   xtrename-tui   Xiranite GUI   (任何新面)
            clap       ratatui        Tauri+React
                └───────┴───────┬──────┴──────────────┘
                                ↓
                    共享 Rust Runtime（node / cli / tui runtime）
                                ↓
                              Extism
```

### A node is one Rust package owning its three native artifacts

```
crates/nodes/trename/
├── Cargo.toml
└── src/
    ├── lib.rs    → trename.wasm      （唯一业务实现）
    ├── cli.rs    → xtrename          （Node-specific CLI）
    └── tui.rs    → xtrename-tui      （Node-specific TUI）
```

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[[bin]]
name = "xtrename"
path = "src/cli.rs"

[[bin]]
name = "xtrename-tui"
path = "src/tui.rs"
```

**同一个 crate，不代表同一份代码。** `lib.rs` carries node behaviour; `cli.rs`/`tui.rs` carry node-specific
*interface* only. A node whose design prefers one binary with a `tui` subcommand may drop the second `[[bin]]`
— that is a per-node product decision, not a shared convention.

The boundary is mechanical: node logic appearing in `cli.rs`/`tui.rs` is a bug to move into `lib.rs`, and a
generic terminal utility appearing inside a node crate is a bug to move into a shared runtime crate.

### Shared runtime, not shared application

```
crates/
├── xiranite-core/            ← Xiranite 自身的 operation/history/repository
├── xiranite-api/             ← Xiranite 自身的 Axum 服务
├── xiranite-node-runtime/    ← 通用：装 wasm → 跑 operation → 事件/取消/暂停
├── xiranite-cli-runtime/     ← 通用：terminal、输出、错误、标志原语、帮助渲染
├── xiranite-tui-runtime/     ← 通用：ratatui 事件循环、widget 基础件、按键原语、布局
└── nodes/trename/            ← 节点自己的 plugin / cli / tui
```

Each layer knows its job and nothing further:

- `xiranite-node-runtime` knows how to load `trename.wasm`, provide capabilities, run an operation, receive
  events, pause and cancel. It does not know Trename's field model or panel layout.
- `xiranite-cli-runtime` knows how to draw help, parse a flag set, prompt for a value and render terminal
  output. It does not know Trename's command structure.
- `xiranite-tui-runtime` knows `ratatui`'s event loop, key handling, themes and reusable components. It does
  not know Trename's layout.
- `nodes/trename` owns the command design, the TUI layout, and the business logic — the latter only as the
  plugin.

The prohibition that falls out of this: **no `xiranite-cli run <node>`, no "read the definition and render a
form" universal shell, no "one shared CLI/TUI for 42 nodes".** Those were revision 2's proposal.

### CLI tooling is pinned: clap parses, cliclack restores Clack 1:1, inquire fills the gaps

The interactive layer is not an incidental runtime detail — it is product design the user already paid for,
and `fadeevab/cliclack` is a port of `@clack/prompts`, so it is reproduced rather than replaced:

| layer | crate | measured facts (2026-10-04, crates.io sparse index) |
| --- | --- | --- |
| 参数解析 | `clap` | parsing is redesigned per node: command tree, flag groups, subcommands. "命令行这边可以修改一下解析" — clap is kept, the old citty shape is not binding. |
| Clack 富界面 1:1 | `cliclack` | latest 0.5.6, no cargo features. Provides `intro`, `outro`, `confirm`, `input` (with `.multiline()`), `password`, `select`, `multiselect`, `spinner`, `progress_bar`, `multi_progress`, `log::{info,warning,error}`, `note`. Deps: `console`, `ctrlc`, `indicatif`, `once_cell`, `rand`, `strsim`, `textwrap`, `zeroize`. |
| 补齐缺口 | `inquire` | latest 0.9.4. Default features `macros`, `crossterm`, `one-liners`, `fuzzy`; opt-in `editor` (external `$EDITOR`, which cliclack has no equivalent of), `experimental-multiline-input`, `date`. Used only where cliclack is genuinely short. |

What the TypeScript runtime actually uses from Clack is small and fully covered:
`confirm`, `select`, `text`, `isCancel` (`packages/cli-runtime/src/index.ts:1`), plus `boxen` panels and
`chalk` colours, which `cliclack`/`console` replace. Names Clack has that cliclack does **not**: `group`,
`task`, `bar`, `alert`, `mention`, `separator`, `close` — `progress_bar` stands in for `bar`, and if a node
ever needs a grouped prompt flow it is composed in `xiranite-cli-runtime` rather than dropped onto inquire.

So the division of freedom is: **parsing design is open to revision, the Clack-style prompt appearance is not**
— it is matched 1:1, because matching it is a port of the same library rather than an invention.

### The node definition carries shared semantics, each face owns its composition

`interaction.ts` is more than CLI plumbing. `TerminalInteractionSchema`
(`packages/cli-runtime/src/interaction.ts:80-102`) already declares `fields`,
`view.sections`/`dashboard`, `toInput`, `validate`, `preview`, `isDangerous`, `dangerPrompt` and `result`,
and `InteractionField` (`:18-34`) declares `kind`, `options`, `role: "action"`, `lines`, `min`/`max`/`step`,
`visibleWhen`, `validate`. Trename's schema (`packages/nodes/trename/src/interaction.ts:37-77`) shows the
vocabulary in use: `visibleWhen: actionIs("scan")`, `validate: nonNegativeInteger`, `dangerPrompt: { title,
body, confirmLabel }`.

The shape survives; the encoding changes. Closures cannot cross into Rust, so the definition becomes data the
node publishes and all faces read:

```
              node definition: action · field · default · range · visibility · safety · help
                      /                    |                    \
                   Web                   CLI                   TUI
           (how it renders)      (how it organises)    (how it composes)
```

| Shared as definition | Owned per face |
| --- | --- |
| action / field / default | 命令怎么组织 |
| 类型 / 范围 | 提示怎么问 |
| 安全条件 | TUI 怎么排版 |
| help 文本 | 哪些面板该出现 |
| 校验语义 | 怎么展示结果 |
| | 怎么做键盘交互 |

- A rule that cannot be declared stays a pure function **exported by the plugin**, which any host calls. It is
  never reimplemented per face.
- Node id, actions, flags, defaults, argument types and help text are one vocabulary (ADR-0067's generated
  catalog). A face may render differently; no face may define differently.
- `crates/xiranite-cli-runtime` rendering help *from* the definition is not a generic shell: the definition
  holds help text and flag descriptions, while `cli.rs` owns the command tree and flag groups.

### What parity means for the terminal faces

- **Business logic: 100% preserved.** Every action a node performs today stays reachable through the plugin.
- **Node-specific UX is preserved as design and re-authored deliberately** — trename's diff / JSON-tree /
  conflict / workflow panels are the product, rebuilt in ratatui from the runtime's widgets, not generated.
- **Flag-by-flag replay is not required, but the Clack-style prompt layer is.** Parsing is redesigned per
  node with clap (command tree, flag groups), and old citty flag spellings/exit-code details came from a
  runtime being deleted — the Rust face must be equally capable and equally usable, and may reorganise the
  surface. The *interactive* layer is different: `@clack/prompts`' appearance has a direct Rust port
  (`cliclack`), so prompts, cancels, spinners and notes are matched 1:1 instead of reinvented. Freedom in
  the CLI layer therefore lives in parsing, not in look-and-feel.
- **Help text does not drift.** `packages/nodes/<id>/src/help.ts` is node-authored content feeding both the
  terminal `--help` and the in-app help card, and stays verbatim. The framing the old TS runtime generated
  around it is not part of the contract.
- **That rule has a gate, and the gate found the drift it was written against.** A definition repeats the
  node's title and description because a published plugin must be readable without the TypeScript workspace;
  a repeat is only safe if it is the *same string*. `bun run audit:node-help-text` resolves each locale side
  through the contract's own `localizeNodeHelp` (so a node's `zh-CN` translation is required for the `zh`
  side, exactly as the UI reads it) and fails on any value the dictionary does not publish;
  `bun run migrate:node-help-text` rewrites only the values that drifted, so a node that quotes its `short`
  or its `description` keeps whichever it chose. Measured first run: **0 of 41 definition files quoted their
  own dictionary** — 14 titles, 38 English and 36 Chinese descriptions had been paraphrased during
  transcription — and after `--apply` 39 do, with the residual debt disclosed rather than hidden:
  `comfygure` and `findz` ship no `NodeHelp` dictionary (`docs/node-help-text-baseline.json`, fail on a new
  one), and `soundw` puts Chinese text in its base fields, which is reported as non-English base text instead
  of being silently Latinised. Falsification: writing an invented English sentence into
  `node-definitions/trename.json` turns the gate red naming that string, and `--apply` restores the
  dictionary's text.
- **`docs/<node>-tui-visual-review.md` stays the layout reference** and stays the evidence a TUI port is done.

### A node's own storage is not a Node dependency

Standalone means "the user does not need Node/Bun", not "no data files". Trename's dictionary is a
SQLite/FTS index — an embedded database with no JS runtime requirement — so it stays in the design:

- it is an ordinary file;
- wasm accesses it through `xiranite.fs.*` handles plus chunked reads/writes (ADR-0068 principle 4), not
  through a Node API.

```
xtrename.exe
├── Rust CLI
├── Extism host
├── trename.wasm
└── trename-dictionary.sqlite   ← 数据资源，不是 Node 依赖
```

The same reasoning applies to any node with local state, and to a standalone app shipping that file as a
Tauri `resource`.

### Standalone is a build target; the GUI stays one product

- **Xiranite is the only GUI product.** All `src/nodes/<id>/*.tsx` build into one React bundle inside one
  Tauri shell. `Trename.exe`-style per-node desktop apps are dropped: the interface is kept, nothing more.
- Per-node desktop packaging stays technically available through Tauri 2's own mechanisms — embedded
  frontend assets and per-build config overlays (`tauri build --config trename.conf.json` with that node's
  assets, `manifest.json` and `<id>.wasm` as `resources`) — so no host source is ever copied per node and no
  dev-server config is duplicated. A node launched from CLI or TUI has no WebView, so no shell may assume one.
- Because the GUI is unified, the rule that keeps the option open is a code rule, not a packaging rule:
  **never write code that requires the GUI to depend on Xiranite in order to run.** A node's React UI reaches
  the backend only through the HTTP client that `@xiranite/api/client` already exports (`createXiraniteNodeClient`,
  `createXiraniteConfigClient`, `createSourceThumbnailClient` — plain `fetch` against a base URL plus the
  `x-xiranite-token` header) and the seam that resolves that
  URL — today `src/backend/adapters/{web,wails,denoDesktop}.ts` plus `src/backend/localBackendConfig.ts`, after
  this rewrite `web` + `tauri`. Nothing in a node's UI may import Xiranite-only state (workspace store, global
  config, nexus, the main app's routing).
- What *is* produced per node: `xtrename`, `xtrename-tui` (or `xtrename tui`), each a self-contained
  executable plus its data files, needing no Xiranite install.

### One Cargo workspace, one `target/`

Cargo manages Rust; the root Bun workspace manages Web. Sharing `target/` is what makes
42 nodes × (plugin + CLI + TUI) affordable to build:

```
cargo build --release -p xtrename        # reuses core/tokio/extism; compiles the node crate
cargo build --release -p xtrename-tui    # shared artifacts already cached
cargo build --release -p xiranite-desktop
```

`target/` is a developer cache and never a runtime edge — each executable links its own copy of the shared
crates, so `xtrename` requires no Xiranite install and no `target/` at run time. The intended symmetry:

```
Web 开发:   一个 node_modules  → 所有 Node 的 React UI（一个 bundle）
Rust 开发:  一个 target/       → 所有 Node 的 plugin / CLI / TUI
运行时:     每个产物独立        → 不带 node_modules、bun、node，也不带 Xiranite
```

Tree:

```
Cargo.toml                      ← [workspace], one Cargo.lock, one target/
crates/
├── xiranite-plugin-api/        ← boundary types, no runtime (ADR-0068)
├── xiranite-core/              ← operations, history, repositories, capabilities
├── xiranite-api/               ← Axum surface (ADR-0063 principle 2)
├── xiranite-extism-adapter/    ← the only crate allowed to reference Extism ABI
├── xiranite-node-runtime/      ← wasm load → run → events, shared by every face
├── xiranite-cli-runtime/       ← shared terminal primitives
├── xiranite-tui-runtime/       ← ratatui event loop, theme, common widgets
└── nodes/<id>/{lib,cli,tui}.rs
```

`native/` keeps its own workspace and its own `native/Cargo.lock` (another task owns it); the per-crate
`[workspace]` stubs in `crates/xiranite-*` exist only until this root workspace lands, and plugin crates
join as each builds, so a half-ported node never blocks the shared `target/`.

### The Web stays one project

`packages/nodes/*` (node) plus `src/nodes/*` (Web UI) is the current split and stays: development keeps
exactly one `node_modules`, one Vite, one React, one Tailwind, one UI library shared by every node's Web
UI. Standalone delivery is a build-time property, so it needs a build target, not a source tree. What is
broken is the staging half of the old path: `scripts/package-node-app.ts` copies a large slice of the
Xiranite backend/Go/Bun workspace (`packages/api`, `packages/backend`, `packages/services`,
`packages/runtime`, `packages/repository`, …) to build a node app. That staging gets deleted, not extended.
**The rework target is the packaging mechanism, not `src/nodes`' organization.**

### Node as a runtime dependency ends

`@xiranite/cli-runtime` (citty, Clack, `@opentui/core`, `@opentui/react`, sharp, sixel, its own React),
`@opentui`, the Bun-embedded node process, external node launch and node app packaging are **executors to
delete**. The Rust `xiranite-cli-runtime` / `xiranite-tui-runtime` crates deliberately carry the same job and
name; the difference is that they link `xiranite-node-runtime` instead of `bun`. `bun` remains the dev/build
tool (ADR-0063). Any Node file still on a runtime path is a gap in the migration, not a supported surface.

### Out of scope: nodes that are already their own projects

ADR-0064 settled these, and this ADR does not reopen them. ArcThumb in particular is fully Rust with a Rust
Tauri GUI in its own project (`ArcThumbX`), reached today through Node-API; it is **not** a Xiranite node, so
it gets no `xarcthumb` face here, and deleting Xiranite's `native/arcthumb-*` crates does not affect that
project. `neoview`, `czkawka`, `xlchemy` are likewise out.

## Alternatives considered

### One generic `xiranite-cli` and one generic `xiranite-tui`, driven entirely by the node definition

Rejected — this ADR's own revision 2. It is tidier and it is wrong for this product: node-specific terminal
design is existing product work, and a definition-driven renderer flattens it. Shared semantics belong in the
definition; shared *composition* does not.

### Merging plugin, CLI and TUI code in a node crate to save files

Rejected: `lib.rs` is node behaviour (compiled to wasm), `cli.rs`/`tui.rs` are node presentation. Merging
them re-creates the second implementation this ADR forbids and makes the cdylib depend on terminal crates.

### One crate per node face (`nodes/trename-cli/`, `nodes/trename-tui/`)

Rejected on cost with no benefit: a node is one unit — plugin, CLI, TUI — and splitting crates multiplies path
dependencies and lock churn while making `cargo build -p trename` unable to mean "this node".

### Per-node frontend projects (`apps/trename-desktop/`, …)

Rejected: breaks the deliberate `packages/nodes/*` + `src/nodes/*` split and duplicates React, Vite,
Tailwind and the UI library per node. The Web UI stays one project; a standalone app would be a build flavor.

### Keep `cli.ts` and `Tui.tsx` running on Node behind the Rust backend

Rejected: three faces preserved at the cost of the exact dependency being removed, plus two implementations
of every action — the plugin core and a Node interpretation of it.

### Ship the CLI and TUI only from the React app

Rejected: drops capability users have today, and the terminal faces are how several QA and diagnostic scripts
exercise nodes.

### A single `xr` umbrella as the only terminal entry

Rejected as a replacement for node entries; acceptable only as Xiranite's aggregate/management entry.
`xtrename` must work as a product on its own.

### Reproduce the old CLI's flag surface byte-for-byte in clap

Rejected as a requirement, kept as a tiebreaker for the prompt layer. Binding the new face to citty's
incidental flag names would preserve the implementation instead of the capability. The interactive
*appearance* is the opposite case: `@clack/prompts` has a Rust port (`cliclack`), so matching it costs a
dependency rather than an invention, and `help.ts` text stays binding in both.

## Consequences

- Every node port writes real Rust: `lib.rs` (plugin), `cli.rs` (its own command design), `tui.rs` (its own
  panels). That is the cost of 42 node products instead of one form renderer, bounded by the shared runtime
  crates: terminal init, colour, widgets, event subscription, Extism wiring and host capabilities are written
  once.
- Port order per node: plugin first (logic 100% reachable), then CLI, then TUI. The node's old TS faces
  retire once its plugin runs under the new faces, `help.ts` is unchanged, and its
  `docs/<node>-tui-visual-review.md` layout is reproduced — never by deleting the TS first.
- The parity evidence for a ported node is: every action reachable, help text intact, TUI layout reproduced.
  Not a flag-by-flag diff.
- `crates/nodes/<id>/` needs the root `[workspace]`; the per-crate `[workspace]` stubs are dropped as it is
  unified, with `native/` staying its own workspace.
- The definition language now exists as types: `crates/xiranite-plugin-api/src/node_definition.rs`
  (`NodeDefinition`, `FieldDefinition`, `FieldKind`, `Condition`, `Rule`, `GuardedRule`, `DangerGate`,
  `InputBinding`, `Transform`, `NodeAction`, `FieldGroup`, `DangerPrompt`, `Scalar`, `LocalizedText`) with
  `validate()` enforcing the cross-references a face would otherwise have to guess at — action selector
  versus action list, group/condition/rule references, range versus kind, default type versus kind, every
  escape hatch required to name a plugin export, and **both languages of every authored string**: nodes
  write `label: zh ? "扫描目录" : "Folders"` inline, so a `String` label would delete one language, and
  `LocalizedText { zh, en }` is checked for blank sides instead. Tests live in
  `node_definition/tests.rs` to keep each file under the maintained size limit. Encoding stays outside the
  crate (ADR-0068), so there is no serde here.
- Three authoring facts from transcribing the first five nodes shaped the language, rather than being
  worked around: keyword lists split on commas/semicolons/newlines (`Transform::Delimited`), a blank filter
  meaning "no filter" rather than "empty filter" (`Transform::TrimOrOmit`, logx's `text()`), and rules that
  only apply under a condition (`GuardedRule::only`, transq's "roots required unless action is status" and
  trename's "Rename JSON required for import/validate/rename"). Where a value's own default is node
  behaviour that depends on more than one field, the binding names a plugin export
  (`InputBinding::default_export`, transq's `plan` forcing `preview`).
- The gate is wired: `scripts/lib/node-definition.ts` mirrors the vocabulary and the same cross-references,
  and refuses any definition file the Rust types cannot represent. Its test asserts the TS lists equal the
  Rust enum variants parsed out of the source, so a one-sided addition fails CI.
  `audit:plugin-manifests` now requires each plugin to publish a valid `definition.json`; five do —
  `plugins/{snf,nameu,logx,timeu,transq}/definition.json`, transcribed from their own `interaction.ts`.
  Measured: `bun run test:plugin-manifests` 14 tests / 64 assertions pass (including controls proving a
  missing definition and an undeclarable condition each fail the gate), and the contract crate's own suite
  is 63 tests.
- Transcribing 38 nodes grew the language four times, each from a rule that was being pushed into a plugin
  export for no reason: `Test::Never` (cleanf writes `visibleWhen: () => false`), `Rule::NumberAtLeast` /
  `NumberInRange` with `f64` bounds (bitv's `positive` steps by 0.5), `DangerGate::Any` (repacku's
  `dryRun === false || deleteAfter === true`, also bandia and dissolvef), and `dangerPromptExport`
  (enginev's body varies with `permanent` + `delete`, bitv interpolates the mode). `Condition::AnyAll`
  covers the OR-of-ANDs that marku and migratef gate on: nested through lists, which WIT allows, rather
  than nested through variants, which it does not. The TS gate's forward-reference report was also moved
  into the deferred pass after a transcription had to reorder a node's fields to satisfy it — field order
  is presentation, not scope.

- Three more things the transcriptions forced into the contract: `GuardedRule.message` (every node writes its
  own bilingual failure copy, and a face inventing that text would be a second implementation), an empty
  compound is now refused (`all([])` reads as valid data but means *always*, which is how a transcription
  would silently reveal every field), and `Test::Never` so `visibleWhen: () => false` states what it means.

  Still open, and deliberately not papered over: `dangerPrompt` stays static where three nodes compute it
  per action (`dangerPromptExport` is the named escape hatch), and separators are only distinguished as
  `lines` vs `delimited`, so `[/\r\n;]+` and `/[,;]+` sources share one transform.

- The contract is consumable, not just declarable: `packages/node-definitions` owns the TypeScript
  vocabulary, the validator and the **form bridge** (`conditionHolds`, `visibleFields`, `defaultValues`,
  `validateValues`, `buildInput`, `dangerState`), so the Web UI renders a node from its definition instead of
  from that node's closures, and `scripts/` gates import the same module rather than keeping a second copy.
  `xiranite-cli-runtime` and `xiranite-tui-runtime` implement the same rules over the same data in Rust —
  that is the whole point: one semantics, three renderers.
  Measured proof, not a claim: `form-bridge.test.ts` drives the real `packages/nodes/trename/src/interaction.ts`
  closures against the transcribed definition over the full action × dryRun × jsonContent cross-product
  (288 field visibility comparisons and 24 danger-gate comparisons, all equal, counted so a zero-comparison
  run cannot pass). `bun run test:node-definitions` = 9 tests across both locations, 0 fail.

- `audit:node-definitions` is the migration scoreboard for this contract. It counts definitions against the
  retained node set (`packages/nodes/*`, currently 43 directories), separates published from
  `node-definitions/*.json` drafts, refuses an empty scan, and reports the **vocabulary backlog**:
  how many rules became `custom{exportName}` and how many `defaultExport`/`DangerGate::PluginExport` names
  exist, i.e. the plugin exports every face will have to call. First measured run: 5 published, 0 drafted,
  38 missing, 1 plugin export (transq's `default_preview`), 0 invalid published.
- **Node residue in `cli.ts`/`Tui.tsx` does not block wasm-ing a node's core.** The two are checked
  separately: what decides plugin feasibility is the import set of `core.ts`/`platform.ts`, and the faces are
  being replaced anyway. Verified example: `packages/nodes/enginev/src/cli.ts:2-3` imports `node:fs/promises`
  and `node:url`, and `:25-29` pulls `@xiranite/cli-runtime/*` and `@xiranite/config`, while
  `packages/nodes/enginev/src/core.ts:1` imports only types from `@xiranite/contract`. So enginev's core is
  wasm-portable and its CLI keeps Node-shaped helpers until the Rust face replaces them — those helpers are
  not candidates for the plugin, and their presence is not evidence that the node cannot be a plugin.
- The feasibility audit keeps excluding `cli.ts`/`Tui.tsx`/`help.ts`/`interaction.ts` from the *plugin*
  surface, for the reason now stated: those faces become Rust hosts, so their Node imports say nothing about
  whether a node's core can run as a plugin.
- `scripts/package-node-app.ts` / `build-node-app-staged.ts` stop copying the backend/Go/Bun workspace. This
  is a deletion, not a new pipeline; no per-node desktop app is scheduled.
- Generated registries grow the Rust-side catalog (per node: plugin present, CLI bin present, TUI bin present,
  definition present) so the same AST-driven codegen keeps one source of truth; catalog-vs-reality drift
  fails the manifest gate.
- `xiranite-tui-runtime` must provide the building blocks the old OpenTUI layer offered (`WorkbenchPanel`,
  `WorkbenchField`, `ActionTabs`, `PathDiff`, `ProgressBar`, `ExecutionActions`) as *widgets nodes compose*,
  not as a shared screen. Which library supplies each control — and the explicit ban on hand-rolling inputs,
  trees, tables, popups, markdown, ANSI, image and diff rendering — is decided in
  `docs/tui-rust-widget-strategy.md`, with crates.io numbers measured 2026-10-04. Terminal image preview
  becomes `ratatui-image` rather than the old sharp+sixel JS path.
- Interaction schema authors gain a real constraint: a rule expressible only as a closure must either join the
  definition language (`visibleWhen: actionIs("scan")` is the model case) or become a plugin export.
- The gate for that rule exists: `audit:node-ui-independence` scans `src/nodes/*` import specifiers (never
  bare word grep, per ADR-0067) for Xiranite-only modules — `@/store`, `@/features`, `@/nexus`,
  `@/services`, `@/App`, `@/router` — and fails CI on **growth** past `docs/node-ui-coupling-baseline.json`,
  so existing debt is visible but cannot spread; comments and string literals mentioning those paths do not
  count, which the gate's own test asserts. Measured first run: 336 files across 44 nodes, coupling 4
  (`clipm` 3 via `@/store/nodeOperations`, `repacku` 1 via `@/store/workspaceStore`), and 10 transport-seam
  call sites through `@/backend/*`. Those ten are not Wails bindings waiting to be rewritten: each already sits
  on the HTTP client (`src/backend/nodeRpcClient.ts` builds it with `createXiraniteNodeClient` from
  `@xiranite/api/client`, and `src/backend/nexusCaptureClient.ts`'s `listNexusCaptures` does its own `fetch`
  with the token header), so the swap is a base-URL and adapter change, not ten call-site rewrites.
  The real impurity is one import higher: `src/backend/nodeRpcClient.ts` also imports `useNodeOperations` from
  `@/store/nodeOperations` and writes every operation and event into that global store, so 4 of the 10 seam
  imports smuggle Xiranite state into a node's UI — which is exactly how
  `clipm` ended up with 3 of the 4 coupling hits. Dropping that store write from the transport module (or
  letting the node use the client directly) is what takes the seam number to zero; the 4 coupling hits go with
  `clipm`'s and `repacku`'s own migration.
  Test files are counted on purpose: a node's browser test importing the workspace store is still coupling
  the node's UI to it.
  Measured once the swap landed: 378 files across 45 nodes, coupling 1 (`repacku` through
  `@/store/workspaceStore`, growth 0) and **transport-seam call sites 0** — the gate now fails on any seam call
  site instead of only reporting the count, and the baseline entry for `clipm`'s 3 went down because the code
  no longer reaches the store. The transport split into three pieces with one job each:
  `src/lib/nodeOperationTransport.ts` speaks HTTP and publishes `NodeOperationUpdate` without touching a store,
  `src/lib/nodeOperationJournal.ts` is the pure reducer the old store body was, and two projections sit on top
  (`src/store/nodeOperationStoreBridge.ts` for the shell, `src/nodes/shared/nodeOperationStore.ts` for node UI)
  so neither side imports the other. `clipm`'s thumbnails and `lorat`'s nexus inbox moved 1:1 into
  `src/nodes/shared/api.ts`, which is the only seam a node UI may use, and
  `src/backend/{nexusCaptureClient,sourceThumbnailClient}.ts` were deleted with their callers — those two
  clients had no other consumer, so nothing was lost that a retained node still needs. What is **not** yet
  verified is the live path: pub-sub mirroring and stream replay under a real Tauri host have not been run on
  a device, only the unit, browser and gate layers.
- "Business logic is preserved 100%" now has a machine behind it: `audit:node-interaction-parity` compares each
  node's `interaction.ts` schema against its definition — action ids against the action selector's options, every
  field id, each field's initial value against `fields[].default`, and the danger closure's body reduced to the
  same disjunctive normal form the definition language expresses. Measured over the 39 nodes that have both:
  **151 action ids and 357 field ids (357 defaults) compared, 34 danger gates matched with 0 mismatches, 21
  prompt texts matched with 0 mismatches**, and 16 items parked in `needsManualReview` with file:line rather than
  being scored — the honest bucket: 5 nodes whose gate is a `pluginExport` call (all five bodies did reduce, so
  they are declarable if we choose), and 11 whose prompt function formats its argument while the definition holds
  static copy.
  It caught real drift on its first run, in `plugins/logx/definition.json`: `minimumSeverity` and `order` had no
  declared default while `initialValues` prefills `info`/`desc`, and because `minimumSeverity`'s option list
  *starts* at `trace`, a face that fell back to the first option would have quietly changed what logx reports.
  Fixed by declaring the two defaults; the gate is green and the node's authored behaviour is now the only
  answer. `findz` is disclosed as having a definition without a readable terminal schema, which is what a
  GUI-only node looks like.
- The CLI port now has a measured starting point instead of a promise: `audit:node-cli-surface` reads each
  retained node's `packages/nodes/<id>/src/cli.ts` out of the syntax tree and keeps the surface in
  `docs/node-cli-surface-baseline.json`, failing on drift. Two things the inventory settled before any clap
  code gets written. First, **the legacy CLI cannot be probed at runtime for this**: a node's entry intercepts
  `--help` and prints the help card, so `trename --help` and `trename scan --help` produce the identical card
  and never the flag list — the tree is the only source, which is ADR-0067's rule applied to the CLI face.
  Second, **the 41 ports are not 41 clap programs**: of the 40 with a CLI file, 22 declare citty command trees
  (115 commands, 83 of them taking their flags from one shared `commonArgs()`-style helper), 15 delegate to
  `runInteractionCli` so their flags *are* the node's definition (the definition contract already carries
  them), 1 uses `node:util` `parseArgs`, and 2 hand-compare flag strings (`bitv`) or have no CLI at all
  (`findz`, GUI-only — its own entry point says so). `comfygure` is retained but ships no `cli.ts`, disclosed
  rather than invented. Fidelity checks, both of which caught a silent under-report before any clap code
  existed: the extractor's trename row reproduces the command table the running CLI prints
  (`xtrename scan|import|validate|rename|undo|history|guided`) — the first version dropped `guided` because
  that command declares no flags — and `marku workflow` reads as 17 flags, not the 3 an object-pairs-only
  reader returns, because its `args` is `{ ...commonArgs(), … } as const` and the spread has to be unwrapped.
  `bun run report:node-cli-surface` turns that into the port's actual workload: **29 distinct flag shapes for
  115 commands** (24 commands take no flags at all, then groups of 9×19, 7×5, 6×25, 5×23, 5×10), so the clap
  layer is 29 argument groups plus one shared renderer, not 115 hand-written flag lists. Falsification: adding
  one invented flag to `commonArgs()` turns the gate red naming that flag, and restoring the file turns it
  green again.
- The Axum side is now a measured crate rather than a plan: `crates/xiranite-api` compiles into the root
  workspace, its `/operations` family answers the legacy shapes, and `cargo test -p xiranite-api`
  (`tests/operations_api.rs`) is green with clippy clean at `-D warnings`. Two facts the first real run
  settled, neither of which the TS source could tell me: the events page serialises `next` as `null` at the
  end (so a client must test for null, not for a missing key), and the token gate answers `401` **before**
  the store is consulted, so an unauthenticated request for a non-existent operation never becomes a `404`
  and cannot be used to probe which ids exist. The error slot is a two-field `ApiError` instead of
  `axum::response::Response` because clippy measures that response at 128 bytes per early return, and
  `Box<Response>` is not available — axum implements `IntoResponse` for `Box<str>`/`Box<[u8]>` only.
- The help-text gate binds the **node-level** text, and measuring it exposed a fiction in my own contract that
  is now deleted rather than papered over: all 174 `actions[].helpKey` values across the 41 definitions were
  literally `action.<id>` — derived from the id sitting next to them — pointing into a dictionary that has no
  per-action entries to resolve them against (`NodeHelp` is a fixed shape: `workflows`/`commands`/`fields`/
  `safety`; measured, 4 of 41 nodes publish any `help.fields` at all, and only 9 of 373 definition fields had
  a matching name). A required key that resolves nowhere would make the CLI and the TUI promise help text that
  does not exist, so `helpKey` is **removed** from the contract: the Rust `NodeAction` has `id` + `label`, the
  TS validator reports the key as "not accepted vocabulary", and `migrate:node-help-text` strips it from any
  definition that still carries one. Per-action prose is therefore a node author's job, not the port's: if a
  node later publishes `help.actions`, the key returns with a gate that resolves it.
  Consequence for #17/#18: `--help` and the TUI help card render the node dictionary plus each action's
  `label` and field defaults — which is what the TS faces effectively print today, so this is parity, not a
  reduction.
- The node dictionary is now **data in the definition**: `definition.help` carries `whenToUse`, `workflows`,
  `commands` and `safety`, with every string turned into a `{zh, en}` pair and every list into a
  `{zh: [], en: []}` pair. The English side comes from `help.ts`'s base fields and the Chinese side from
  `translations["zh-CN"]`, both resolved through the contract's own `localizeNodeHelp`, so the block is the same
  text the app's help card renders today. This is what closes the last hole in "help text does not drift": the
  ADR claimed `help.ts` feeds the terminal `--help`, and once the TypeScript workspace is gone a Rust face has
  nothing to read unless the published definition carries it. Measured and published by
  `bun run audit:node-help-text -- --apply`: 39 of 41 definitions now carry the block and read verbatim, 2 do
  not because their nodes ship no dictionary (`comfygure`, `findz`, the baselined debt), and 16 entries across
  the set are mirrored from the English base because the node translated only part of its prose — disclosed,
  not failed, because a mirrored line is still the node's own text and the app already falls back that way.
  The block is optional in the contract language but **required by the gate** for any node with a dictionary,
  and the validator refuses a list whose two sides differ in length (a translation that dropped a step would
  print three bullets in one language and two in the other). The Rust mirror is
  `crates/xiranite-plugin-api/src/node_definition/help.rs`, read by `wire`, rendered by
  `crates/xiranite-cli-runtime/src/help.rs` into clap's long help; only the section *headings* are the face's
  own vocabulary (`FaceHeading`), because a node's dictionary publishes none.
- **Each language keeps its own lists.** The first version of this rule refused a block whose `zh` and `en`
  sides had different lengths; measured against the dictionaries, that rule was wrong. The legacy page prints
  `localizeNodeHelp(view, locale)`'s own array, so `classf`'s Chinese command list has two examples where its
  English one has three, and `cleanf`'s workflow counts differ the same way. Publishing one shape for both
  languages would delete node-authored prose — the thing this block exists to prevent — so the contract and
  `LocalizedList::resolves_complete` refuse only blank lines, and a length difference is a **disclosure** the
  gate prints (17 of them across the 39 published blocks). Entry arrays (workflows, commands, examples) can only
  have one length inside a definition, so the block publishes the union and lets the untranslated side quote the
  base text: the Chinese page gains `classf`'s third example, untranslated, rather than losing a command the node
  wrote. The printed page matches the legacy layout line for line except where a node's own translation is
  asymmetric, and that asymmetry is disclosed rather than hidden.
- `xiranite help` and `xiranite help <node>` are therefore host commands over published data, which is what the
  node dictionaries already advertise (`xiranite help marku` is one of `marku`'s own published examples).
  `crates/xiranite-cli-runtime/src/catalog.rs` reads `<root>/node-definitions/*.json` plus
  `<root>/plugins/*/definition.json`, lists a node id once with the installed plugin copy winning over the draft,
  refuses a scan that found nothing instead of rendering "no nodes", and names the file when a definition cannot
  be read or is a future `definitionVersion`. An unknown node id comes back as `UnknownNode` carrying the ids that
  do exist. Measured: 41 definitions discovered, one line per node in both languages, and a node whose dictionary
  is the baselined debt still prints its tagline and `参数` list rather than an empty screen.
- `crates/xiranite-cli-runtime` now exists as the shared library the node CLIs sit on: `wire` reads a published
  `definition.json` into the Plugin API model, `plan` evaluates the condition and danger algebra over the
  answers, `term` renders the resulting questions with clap and cliclack. The reader rejects unknown keys
  exactly like the TypeScript validator does, and the test suite shows all 41 published/drafted definitions
  parse through it. This is the shared-semantics half of the CLI; each node still owns its `cli.rs`. The crate
  is not yet a member of the root workspace — that file belongs to the workspace-unification lane — so
  `bun scripts/verify-cli-runtime-out-of-workspace.ts` proves it by building a copy under `artifacts/` with its
  own workspace root and absolute path dependencies. Measured there: 7 integration tests green, clippy clean at
  `-D warnings`, and both already-committed crates still green after the model gained `Display` for
  `DefinitionError` (11 route tests, 70 model tests).
- `crates/xiranite-tui-runtime` started on the same principle and carries only the semantics that are TUI's own:
  the focus ring (copied from `moveFocus` in `packages/cli-runtime/src/tui/session.ts`, including that a stale
  focus id re-enters the ring from an end) and the key meanings (the `app.tsx` chain order: escape, then tab,
  then the section strip, then idle `q`, then enter/space, with the editor keeping its own keys). It depends on
  nothing, not even ratatui, so it is verified with `rustc --edition 2024 --test` (11 tests) and the tab
  binding was mutation-checked — breaking it turns two tests red.
- The TUI theme vocabulary is **generated, not transcribed**: `scripts/audit-tui-theme-table.ts` asks
  `packages/cli-runtime/src/tui/theme.tsx` through its own `listTerminalThemes()`/`resolveTerminalTheme()` and
  writes `crates/xiranite-tui-runtime/src/theme.rs`; the same script is the gate (`audit:tui-theme-table` fails
  on drift, `migrate:tui-theme-table` rewrites). 40 themes × 8 tokens is exactly the volume that loses an entry
  or a byte to hand-copying, and the producer immediately proved the point: the `cursor` theme publishes
  `#e4e4e45e`, an **alpha-bearing** colour, which a `#rrggbb`-only reader would have rejected (and a
  transcription would have flattened to opaque). The generated table carries the alpha byte and says so, because
  ratatui cannot draw a translucent foreground and the face that drops it must be the place where that choice is
  visible. The two behaviours the port would most likely lose are asserted in generated tests: the fallback theme
  is `nord`, not the palette literally named `default`, and an unknown name resolves to the fallback rather than
  failing. Controls: changing one byte of nord's `primary` and deleting the `orng` row each turn the gate red
  naming exactly that theme, and regenerating returns it to green.
- A semantics bug the CLI runtime's own tests caught before any node was ported: `danger_required` treated
  [`DangerGate::PluginExport`] as "the gate holds", so a node whose gate is computed by a plugin export *and*
  which authors confirmation copy would get `Confirm` — the CLI would show the node's text for a run the plugin
  might judge harmless, then let it proceed on the user's shrug, never calling the export. Measured blast radius:
  5 drafted definitions are exactly that shape (`repacku`, `marku`, `migratef`, `bandia`, `dissolvef`), and a
  sixth (`lorat`) authors its prompt through `dangerPromptExport` while its gate stays declarative. The
  evaluator now answers `FromPlugin { export_name }` for an export-computed gate, and the terminal layer refuses
  to guess instead of asking. This is the case for keeping the evaluator in one place: five nodes were about to
  inherit the bug.
- The placement question is settled, not deferred: the visibility/required/danger algebra moved out of
  `xiranite-cli-runtime::plan` into `crates/xiranite-plugin-api/src/definition_eval.rs`, next to the model it
  interprets and still dependency-free, so a wasm plugin and a host binary compile the same rules. The CLI
  re-exports it (`plan` keeps `Values`, `Danger`, `test_holds`, … as `pub use`, and adds only `Step`/`prompt_plan`,
  which is terminal-shaped), and `xiranite-tui-runtime::surface::plan_visible_surface` is now the section builder
  for a node's `tui.rs`, so neither face holds a private variant of the algebra. Verified after the move: 70 model
  tests and 11 CLI tests green with clippy clean, 19 TUI-runtime tests green, and one of them asserts a tab strip
  appearing and vanishing **through** the shared evaluator rather than a local rule.
- Two API facts the port must not re-derive, learned from the published sources and the compiler instead of a
  tutorial: cliclack 0.5.6 has **no numeric prompt**, its `interact()` takes `&mut self`, and it has no
  "confirm label" knob — so a `number` field is a validated text input (which is what the legacy Clack code did
  anyway) and a node's three authored danger strings render as `note(title, body)` followed by
  `confirm(confirmLabel)` rather than being paraphrased into one line. And clap 4.6.7 gates `From<String>` for
  `Str`/`Id` behind its **`string` feature** while its parse entry point is `try_get_matches_from`, which
  consumes the `Command`; a definition-driven command therefore owns every string it hands to clap.
