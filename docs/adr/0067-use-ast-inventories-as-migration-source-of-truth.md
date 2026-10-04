---
status: accepted
---

# Use syntax-tree inventories as the source of truth for the rewrite

## Context

The rewrite rests on three claims that are easy to assert and hard to keep true:

1. "React UI stays as-is" (ADR-0063 principle 1).
2. "The HTTP/Operation protocol is ported, not redesigned" (ADR-0063 principle 2).
3. "Only nodes whose dependencies allow it become WASM plugins" (ADR-0063 principle 8).

Each has a silent failure mode that a green build will not show. During the czkawka and NeoView
migrations this repository already learned the same lesson in the other direction: a claim of
completeness backed by titles, capability summaries or smoke UI is not evidence, and a generated
artifact can look correct while the source of truth drifted.

Measured blind spots that make string search insufficient here:

- No `tsconfig` covers `scripts/`: `tsconfig.app.json:35` includes only `src`, `tsconfig.node.json:25`
  only the Vite/Vitest/Playwright configs and `desktop/**/*.ts`. A script importing a deleted node core
  survives `tsc` and only explodes when someone runs it. This is not hypothetical:
  `scripts/benchmark-runtime-contention.ts:10` imports `packages/nodes/xlchemy/src/core` directly.
- Node-name grep produces both directions of error. `vert` matches `vert-gradient` in
  `packages/czkawka-native/src/index.ts:34`, while `packages/nodes/kavvka/src/index.ts:11` legitimately
  names "czkawka" in copy that refers to the standalone tool, not to a deleted node.
- `bun run typecheck` resolves `tsconfig.json`, whose `files` is empty, so it checks three files; the
  real application check is `bunx tsc -p tsconfig.app.json --noEmit`.

## Decision

Every migration claim in this rewrite must be produced or checked by a syntax-tree inventory, using the
AST tooling this repository already has rather than a second engine.

Existing machinery to reuse (`packages/tauri-migrate`, built on `@ast-grep/napi ^0.44.1` with
`@ast-grep/lang-rust ^0.0.7`, `package.json:26-27`):

- `src/analyze.ts:62 analyzeTauriProject` plus `:49 discoverRustSourceRoots` — Rust-side inventory of
  commands, events, parameters, state access and native-dependency evidence.
- `src/types.ts:1 MigrationDisposition = "typescript-portable" | "native-required" | "manual-review"`
  — the disposition skeleton the node feasibility tiers extend.
- `src/rewrite.ts:17 applyStructuralRewrites` with `src/languages.ts:8 toNapiLanguage` — deterministic
  same-language structural codemods for js/ts/tsx/rust.
- `src/frontend.ts:48 portTauriFrontend` and `:94 rewriteFrontendSource` — source port plus manifest and
  review report, keeping host APIs visible as explicit adapter boundaries.
- `src/generate.ts:7 generateMigrationArtifacts` — emits the JSON artifacts the gates read.

Related in-repo precedent, kept as-is: `packages/svelte-migrate/src/react-scaffold.ts` (AST-frozen
component hierarchy for the NeoView card rule in `AGENTS.md`), `scripts/lib/read-node-def.ts` (already
reads node definitions through `oxc-parser`), and `scripts/validate-node-architecture.ts`.

Required gates, in the order the rewrite needs them:

1. **Protocol differential (blocking, per ADR-0063 principle 2).** An AST pass over
   `packages/api` and `packages/backend` extracts every route (method, path, handler), request/response
   DTO shape and NDJSON event field into `artifacts/legacy-http-surface.json`. The Rust side produces
   `artifacts/rust-http-surface.json` from `crates/xiranite-api` via `analyzeTauriProject`. The gate
   fails on **either** direction of difference: a legacy route missing from Axum, and a Rust route with
   no legacy counterpart. Route counts matching is not the assertion; the symbol-level sets are.
2. **Node feasibility audit (blocking, per ADR-0063 principle 8).** Implemented as
   `packages/tauri-migrate/src/node-feasibility.ts`: it parses every `packages/nodes/<id>` source file
   with `@ast-grep/napi`, reading static imports, re-exports, `require` and dynamic `import()`
   specifiers plus each package's own dependencies, and classifies the node as `wasm-plugin`,
   `wasm-with-host-io`, `rust-host`, `blocked-native` or `manual-review`, recording file:line evidence.
   An unclassified third-party specifier lands in `manual-review` rather than silently becoming a plugin
   verdict. Run `bun run audit:node-feasibility` to write `artifacts/node-wasm-feasibility.json`, then
   `bun run audit:target-node-manifest -- --apply-feasibility artifacts/node-wasm-feasibility.json` to
   move the verdicts into `docs/xiranite-target-node-manifest.json`; `--strict` fails while any retained
   node is still `pending-audit`.
3. **UI immutability proof (per ADR-0063 principle 1).** Before the transport swap, a structural
   fingerprint of `src/components/**` and of each retained node `Component.tsx` (component tree, props,
   event bindings, conditional and loop blocks, icon imports) is captured. After the swap the same scan
   must produce an identical fingerprint. Any difference is either reverted or recorded in an ADR as an
   intentional deviation with its replacement contract — the same rule the NeoView card migration
   already enforces.
4. **Residue and contract drift.** `scripts/lib/node-removal-surface.ts` computes, per node id, the
   surface that still references it — node trees, workspace dependency declarations, the four committed
   generated registries, i18n catalog blocks (`module.<id>`,
   `settings.memoryProtection.scopes.<id>`), node-private scripts and docs, and the known coupled code
   (per-node memory-protection preset, `XIRANITE_<ID>_*` env overrides, hardcoded settings scope, node
   stylesheet classes). `bun run audit:target-node-manifest -- --surface <id>` prints the findings.
   The gate treats build-graph categories as blocking: a record with `disposition: removed` fails while
   any blocking seam survives, which is what turns "we deleted it" into a checkable claim.
   Once `specta` emits TypeScript from Rust types, the same pass compares generated type members against
   the members the frontend actually accesses, so a hand-maintained DTO cannot quietly reappear.

Codemods stay inside their documented competence: `applyStructuralRewrites` performs imports, renames
and same-language structural edits. It does not translate Rust business logic to TypeScript or vice
versa, and no part of this plan assumes it does.

## Alternatives considered

### String search plus human review for each claim

Rejected as the primary instrument. It produced both false confidence (a `vert` hit that is really
`vert-gradient`) and false completeness (the xlchemy import in `scripts/` that no typecheck sees). It
remains acceptable for reading a diff, never for asserting coverage.

### Write a new migration analyzer

Rejected against `AGENTS.md` dependency-reuse rules: `@ast-grep/napi` is already vendored into the
workspace, already proven on Rust and TS/TSX here, and already wired into `packages/tauri-migrate`.
The work is a new analyzer module plus artifact emission, not a new parser.

### Trust the existing test suite as the immutability proof

Rejected. Tests assert selected behavior; the claim to be protected is structural non-change across
roughly 40 retained nodes, which needs a whole-tree fingerprint rather than per-case assertions.

## Consequences

The gates must exist before the work they police, otherwise "ported" and "unchanged" become unfalsiable
after the fact. That makes this ADR's inventory code the first implementation task of the rewrite, ahead
of any `crates/` scaffolding. Artifacts are committed-or-reproduced on demand and treated as generated:
regenerate rather than hand-edit, and never hand-resolve a generated registry, matching the existing
rule that generated files are whole-file outputs.

Real limitations, stated rather than hidden: the UI fingerprint proves structure did not change, not
that rendering, performance or platform behavior is identical — browser tests and a Windows Tauri run
still carry that. And an import-specifier classification is evidence about dependencies, not a guarantee
that a crate compiles to `wasm32`; anything in `blocked-native` or `manual-review` still needs a real
target build before it is promised as a plugin.
