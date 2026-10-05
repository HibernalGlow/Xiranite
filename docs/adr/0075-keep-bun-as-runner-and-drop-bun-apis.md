# Bun stays the runner, Bun stops being an API: the codebase writes standard Node

- Status: **accepted** — decided by the user 2026-10-05: "bun 应该彻底去掉对它的依赖，不要留下这个东西了；要么还是标准的 node 语法，或者 QuickJS，或者彻底变成 Rust。**从运行时层面不需要更换，只是代码层面还是按照标准的 Node 语法，不要使用 Bun 的特性。**"
- Date: 2026-10-05
- Scope line, stated first because it is the whole decision: **the runtime layer is out of scope.** `bun` remains the
  local runner for `package.json` scripts, `bun.lock` stays, CI keeps `oven-sh/setup-bun`, and no package manager
  migration happens. **The code layer is in scope:** no source file may use a Bun-only API, because that is the part
  that makes the tree unrunnable anywhere else and keeps pulling a non-standard surface into shipped packages.
- Related: `docs/adr/0063-…-extism.md` (Bun as dev/build tool — unchanged), `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`
  §5 (the terminal face is a **Node** process; this ADR removes the "/Bun" from that phrasing),
  `scripts/audit-no-bun-apis.ts` (the gate shipped with this decision)

## Why

Measured in this tree on 2026-10-05 by the gate that now enforces it:

| Bun-only surface | measured | why it is a code problem, not a runner problem |
|---|---|---|
| `Bun.*` global API | **205 mentions, ≥40 files** (`spawn` 60, `sleep` 24, `file` 24, `spawnSync` 22, `env` 18, `which` 12, `write` 8, `TOML` 7, `Subprocess` 4, `version`/`resolveSync` 2, `serve`/`stdin`/`Glob`/`SpawnOptions` 1) | it leaks into `packages/runtime` and `packages/backend`, i.e. into code that is supposed to describe the product, not the laptop |
| `import { … } from "bun:test"` | **72 files** | a test API with no equivalent on any other runtime, and a second standard next to the repo's documented Vitest |
| files named `*.bun.test.tsx?` | **54** | the name itself encodes the runner; the same suite cannot be run by the documented command |
| `@types/bun` / `bun-types` | **6 manifests** | the type layer advertises the non-standard surface, so new code reaches for it |

Three concrete failures this repo already recorded are Bun-API failures, not Bun-as-runner failures: the isolated
linker's symlink tree (any copy/embed step that does not dereference silently ships an empty directory), and a
`fetch`/abort interaction that wedges the event loop and forced the download path into a subprocess. Those bugs come
from *calling* Bun.

## Decision

**Rewrite every call site to the standard Node equivalent, and keep the runner as it is.**

| Bun-only API | Standard replacement |
|---|---|
| `Bun.spawn` / `Bun.spawnSync` / `Bun.Subprocess` / `Bun.SpawnOptions` | `node:child_process` (`spawn`/`spawnSync`) behind one helper, `scripts/lib/subprocess.ts` |
| `Bun.file(...)` (`.text()`, `.json()`, `.bytes()`, `.exists()`) | `node:fs/promises` (`readFile`/`writeFile`/`stat`) |
| `Bun.write(dest, data)` | `node:fs/promises` (`writeFile`, `mkdir` when the parent is missing) |
| `Bun.sleep(ms)` | `setTimeout` from `node:timers/promises` |
| `Bun.env` | `process.env` |
| `Bun.which(bin)` | a `PATH` scan in the same helper (`node:path` + `fs.statSync`) |
| `Bun.resolveSync(specifier, from)` | `import.meta.resolve` / `require.resolve` from `node:module` |
| `Bun.TOML.parse/stringify` | an npm TOML library — measured before landing, recorded in the commit that introduces it |
| `Bun.Glob` | `node:fs.globSync` (Node 22.13+/26) or the already-present glob dependency |
| `Bun.serve` | stays only inside `packages/backend`, the old layer already scheduled for deletion; it is removed with that layer, not ported |
| `Bun.version` / `Bun.stdin` / `Meta.*` | feature-detect and remove, or the standard stream (`process.stdin`) |
| `import { describe, it, expect, mock } from "bun:test"` | **Vitest** (`^4.1.10`, already the documented runner for non-browser tests here); `expect`/`describe`/`it`/`vi.mock` map 1:1 |
| `*.bun.test.tsx?` naming | `*.node.test.tsx?` — the honest name (these tests need a real Node environment, not jsdom), and it puts them inside the existing Vitest include |
| `@types/bun` / `bun-types` | removed from every manifest; `@types/node` covers what is left |

**Rejected alternatives:**
- *Swap the runner/package manager to Node + npm too.* Explicitly out of scope by the user's clarification; it would
  rewrite `node_modules` under every in-flight session for no code-level gain.
- *Keep `bun:test` because it is "only a test API".* It is the single largest Bun-only surface by file count (72) and
  it keeps two test standards alive at once, which is exactly the drift AGENTS.md forbids.
- *Write a `Bun`-shaped shim module so call sites keep compiling.* That re-introduces the non-standard surface under a
  project name — the API stays Bun's shape, every reader still has to learn it, and the gate could not tell the
  difference.
- *Move the tooling to Rust.* Not the objective: the objective allows Rust where Rust is already the product
  (`crates/`), and asks for standard Node elsewhere.

## Gate

`scripts/audit-no-bun-apis.ts` — pure Node (no Bun globals, so it can be run by any runtime, including the one it
polices). It walks `git ls-files`, classifies hits per category above, prints the offending paths, and exits non-zero
on any hit. Its exemption list is data, short, and each entry carries a reason — the ADR that records this decision,
the gate's own pattern table, and `packages/backend` while the old layer still exists.

Registered as `bun run audit:no-bun-apis` (the runner is unchanged; the *script* it invokes uses no Bun API).

## Corollary: local import specifiers must name the real file

`scripts/*` imports its own helpers as `./lib/x.js` while only `./lib/x.ts` exists. That resolves under Bun (which
rewrites the extension) and fails under plain Node (`ERR_MODULE_NOT_FOUND`), so the file is not standard-Node code
even when every API in it is. New and touched files import the **actual** specifier (`./lib/subprocess.ts`), the way
`packages/quickjs-shims` already does with `allowImportingTsExtensions`. Proven both ways: after the change,
`node scripts/run-turbo.ts` and `bun scripts/run-turbo.ts` print the same usage line and exit 2 from the same file.

This is a per-file rule applied as each file is touched — no repo-wide specifier sweep is scheduled, because the
runner still resolves the old spelling and a big-bang rename would collide with every in-flight branch.

## Migration order

1. This ADR + the gate (baseline number, and the residue cannot grow silently).
2. `scripts/lib/subprocess.ts` and the helper-level replacements, then the `Bun.*` call sites — `scripts/` first
   (largest count, no shipped surface), then `packages/runtime`, then the rest, file by file.
3. `bun:test` → Vitest and the `*.bun.test.*` → `*.node.test.*` rename, per package, each verified by running the
   suite (assertions unchanged — a migrated test that no longer asserts the same thing is a regression, not a migration).
4. Drop `@types/bun` / `bun-types` from the manifests, then flip the gate strict (no exemptions except the two rows
   that must stay).
5. Prose: AGENTS.md's `Node/Bun` phrasing, ADR-0074 §5's face wording, and the migration docs.

## Consequences

- Positive: any file in the tree can be run by plain `node` (verified: Node 26 runs `scripts/x.ts` directly,
  `node --test` and JSON import attributes work), which is what makes the QuickJS/host boundary in ADR-0074 arguable
  in the first place; one test standard; the type layer stops advertising a non-portable global.
- Accepted cost: `scripts/` keeps Bun's speed only where the *runner* provides it; per-call sites that used
  `Bun.spawn`'s ergonomics get a helper instead, and that helper is the thing to reuse rather than re-implement.
- Accepted risk: 205 API mentions plus 72 test files is a long tail. The gate makes the tail visible per category, so
  a partial migration is never mistaken for a finished one.
