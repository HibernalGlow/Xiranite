# Keep each node's CLI, TUI and GUI, rebuilt on clap, ratatui and React

- Status: accepted
- Date: 2026-10-04
- Amendment note: this narrows ADR-0063 principle 8 and the "layers to delete" list in AGENTS.md. The
  Node *runtime* goes; the three faces of a node do not.
- Related: `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`,
  `docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md`,
  `docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`

## Context

Every node package in `packages/nodes/<id>` ships four surfaces, and the product depends on all of them
existing side by side:

| surface | today | who uses it |
| --- | --- | --- |
| `core.ts` | pure TypeScript, called by the backend | the GUI through `/node-operations`, and the CLI/TUI |
| `cli.ts` | `@xiranite/cli-runtime` on Node | terminal users, `bun run` scripts, QA harnesses |
| `Tui.tsx` | `@opentui` on Node/Bun | terminal users, `docs/*-tui-visual-review.md` gates |
| `Component.tsx` | React 19 | the workspace cards, floating windows, swimlanes |

`packages/cli/package.json`, the four committed generated registries and `scripts/generate-node-registries.ts`
all enumerate those faces, and the `help.ts` text drives both the terminal `--help` output and the in-app
help card. So "delete the CLI and TUI because they are Node" would remove product capability, and the
feasibility audit's exclusion of `cli.ts`/`Tui.tsx` from the *plugin* surface was being read as a plan to
delete them. It is not.

## Decision

The node keeps all three faces. What changes is which runtime executes them, and the shared logic stops
being JavaScript at runtime:

```
                     React GUI  ─┐
                     clap CLI   ─┼─→ xiranite-core (Rust) ─→ Extism plugin (core logic)
                     ratatui TUI ─┘
```

- **GUI** stays React 19 in `src/`, unchanged in shape, talking HTTP to `xiranite-api` (ADR-0063 principle
  1, ADR-0065 loopback channel). No new renderer, no rewrite of cards.
- **CLI** becomes `clap` definitions inside one `xiranite-cli` host binary that dispatches per node
  (`xr node <id> …`), calling `xiranite-core` operations in process. The per-node flag vocabulary, exit
  codes and `--help` text are the contract that must not drift; `packages/cli` and the generated
  `node-cli-registry` describe it, so a Rust-side catalog has to cover the same ids and bins.
- **TUI** becomes `ratatui`, driven by the same core operations, with the existing per-node TUI visual
  reviews as the reference for layout and key bindings.
- **One source of truth for the shared vocabulary.** Node id, action list, flags, argument types,
  defaults and help text are defined once — the `node def` plus its action/interaction schema — and read
  by all three faces. A face may render differently, never define differently. Today that vocabulary is
  the node's `node def` and `help.ts` plus `scripts/lib/read-node-def.ts` (already AST-read); the Rust
  side consumes the same generated catalog rather than restating it.
- **Shared logic lives in the plugin**, not in each face: CLI, TUI and GUI start the same operation over
  `/node-operations`-equivalent core calls, so pause/resume/cancel, event retention and history behave
  identically from all three, and ADR-0066's checkpoint is the single cooperation point.
- **Node stops being a runtime dependency.** `@xiranite/cli-runtime`, `@opentui`, the Bun-embedded node
  process and the Node-based external node launch are removed as *executors*. `bun` remains only as the
  dev/build tool the rewrite already uses (ADR-0063), and any Node file left behind is a gap in the
  migration, not a supported surface.

## Alternatives considered

### Ship the CLI and TUI only from the React app

Rejected: it drops a capability users have today, and the terminal faces are how several QA and diagnostic
scripts exercise nodes.

### Keep `cli.ts` and `Tui.tsx` running on Node behind the new backend

Rejected. That preserves three faces at the cost of keeping the exact dependency this migration removes,
and it means two implementations of every action: the plugin core plus a Node interpretation of it.

### One Rust crate per node's CLI and TUI

Rejected for now, not on the merits but on cost: 41 nodes × two faces of argument parsing before the
shared vocabulary exists. `xiranite-cli` and the TUI host carry the dispatch, and a node whose terminal
surface needs node-specific code adds a small per-node module against the shared catalog. Recorded so a
later split is a deliberate choice rather than an accident.

## Consequences

- The feasibility audit's exclusion of `cli.ts`/`Tui.tsx`/`help.ts`/`interaction.ts` from the *plugin*
  surface stays, and its comment now says why: those faces move to Rust, so their Node imports say
  nothing about whether a node's core can run as a plugin.
- `bun run audit:node-feasibility` tiers keep their meaning; the plan for every retained node is
  plugin (core) + clap (CLI) + ratatui (TUI) + existing React (GUI).
- The old `@xiranite/cli-runtime` and OpenTUI surfaces stay functional until their Rust counterparts
  exist: a face is retired per node only after the Rust face covers it, verified against the node's
  help text and its TUI review document, not by deleting the file.
- Generated registries must grow the Rust-side catalog entries (per-node CLI/TUI presence) so the same
  AST-driven codegen keeps one source of truth; drift between catalog and reality fails the manifest gate.
- `docs/*-tui-visual-review.md` and the QA scripts that drive them remain meaningful: they describe the
  TUI the Rust implementation has to reproduce.
