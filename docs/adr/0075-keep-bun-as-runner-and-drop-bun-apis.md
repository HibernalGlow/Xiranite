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

Measured in this tree on 2026-10-05 by the gate that now enforces it. The **gate counts call-site lines in tracked
source files, comments excluded** (the histogram in the first row is raw `rg` mention counts, so the two numbers
differ by design):

| Bun-only surface | measured | why it is a code problem, not a runner problem |
|---|---|---|
| `Bun.*` global API | **165 call-site lines** (`rg`: 205 mentions, ≥40 files — `spawn` 60, `sleep` 24, `file` 24, `spawnSync` 22, `env` 18, `which` 12, `write` 8, `TOML` 7, `Subprocess` 4, `version`/`resolveSync` 2, `serve`/`stdin`/`Glob`/`SpawnOptions` 1) | it leaks into `packages/runtime` and `packages/backend`, i.e. into code that is supposed to describe the product, not the laptop |
| `import { … } from "bun:test"` | **72 files** | a test API with no equivalent on any other runtime, and a second standard next to the repo's documented Vitest |
| files named `*.bun.test.tsx?` | **54** | the name itself encodes the runner; the same suite cannot be run by the documented command |
| `@types/bun` / `bun-types` | **4 manifests** (+1 exempt, `packages/backend`) | the type layer advertises the non-standard surface, so new code reaches for it |
| `import.meta.dir` / `import.meta.path` | **18 files** (13 converted with this ADR, 5 left in another session's in-flight files) | measured on this machine: under `node` both answer **undefined**, under `bun` they are strings — the code runs on exactly one runtime. `import.meta.dirname` / `.filename` / `.main` behave the same in both and are *not* flagged |

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
| `Bun.Glob` | `node:fs.globSync` (Node 22.13+/26) **plus an explicit file filter** — measured on this tree: brace alternation works (`src/**/*.{ts,tsx}` → 710 matches, same set as `Bun.Glob`), but Node's glob has no `onlyFiles` and this tree contains *directories* whose names end in `.tsx` (the Vitest browser screenshot baselines), so 15 of the 725 raw matches are directories. The `glob`/`tinyglobby`/`minimatch` copies in `node_modules` are all transitive, so reaching for one would be the same phantom dependency that blocks `smol-toml` |
| `Bun.serve` | stays only inside `packages/backend`, the old layer already scheduled for deletion; it is removed with that layer, not ported |
| `Bun.version` / `Bun.stdin` / `Meta.*` | feature-detect and remove, or the standard stream (`process.stdin`) |
| `import { describe, it, expect, mock } from "bun:test"` | **Vitest** (`^4.1.10`, already the documented runner for non-browser tests here); `expect`/`describe`/`it`/`vi.mock` map 1:1 |
| `*.bun.test.tsx?` naming | `*.node.test.tsx?` — the honest name (these tests need a real Node environment, not jsdom), and it puts them inside the existing Vitest include |
| `@types/bun` / `bun-types` | removed from every manifest; `@types/node` covers what is left |

**Four details settled while converting, recorded so the next call site does not re-litigate them:**

- **`windowsHide` is passed explicitly (`true`) in `scripts/lib/subprocess.ts`.** Bun's own default hid the console
  window and most call sites relied on that; the Node documentation for `child_process.spawn` states `Default: false`
  (checked against the Node 26 API page on 2026-10-05), so the behaviour is requested rather than assumed. Windows is
  the delivery platform, where the difference is a console window flashing for every spawned tool.
- **No shell anywhere.** `Bun.\`taskkill /PID ${pid} /T /F\` became `runSync(["taskkill", "/PID", String(pid), "/T", "/F"])`,
  and `cmd /c netstat -ano` became `runSync(["netstat", "-ano"], { maxOutputBytes: 32 MiB })` — argv arrays, which is both
  the helper's contract and the reason a pid interpolated into a shell string stops being a quoting question.
- **Optional external tools are probed, not path-resolved.** `sccache` detection is
  `spawnSync("sccache", ["--version"], { stdio: "ignore" }).error === undefined` and then sets `RUSTC_WRAPPER=sccache`
  (the bare name; rustc resolves it through `PATH` on both platforms). This is the shape `audit-quickjs-host-ops.ts`
  already used. `which()` stays only where the resolved *path* is itself the value — `PKG_CONFIG` in
  `packages/czkawka-native/scripts/build-native.ts`. Package-side scripts use inline `node:child_process`: `packages/*`
  must not import `scripts/lib/*`, and adding a shared helper would mean a new workspace dependency (blocked on
  `bun.lock` being another lane's uncommitted file).
- **`Bun.file(path).writer()` is `createWriteStream(path)`, and a stream consumer iterates.** The vite cold-start
  matrix read the child's pipes through a Web `ReadableStream` reader because Bun hands out Web streams; the Node
  version of `pipeAndWatch` is a `for await` over the same bytes. Verified end to end by running the converted script
  under both runtimes: `bun scripts/benchmark-vite-cold-start.ts --list` and
  `node scripts/benchmark-vite-cold-start.ts --list` print the same variant table and exit 0.

**Progress (same instrument, same counting rule).** Baseline at the gate's first run: **294** total hits, of which
**140** were `Bun.*` call-site lines. Driven to **145** total / **31** `Bun.*` lines across 16 files by 2026-10-05
late session: `scripts/` dev and release tooling, the `-native` package build and smoke scripts, `packages/runtime`
tests, and the two vite benchmarks. What is left is not free-floating: **7 `Bun.TOML` lines wait on step 4**, the rest
sits in the old desktop/node-app layer that the deletion lane is removing as this is written (files that this session
counted in the morning were gone by the afternoon), in files whose whole stack belongs to another branch, or in the
test surface owned by steps 3 and 5.

**A commit-lane constraint, because it changes what "done" means here.** Four converted files
(`packages/czkawka-native/scripts/generate-binding-dts.ts`, `packages/czkawka-native/scripts/smoke-native.mjs`,
`packages/czkawka-native/scripts/benchmark-native.mjs`, `packages/nodes/kisaki/scripts/smoke-cli.mjs`) could not be
committed to `xiranite-rust-rewrite`: `but commit` refuses because those paths' uncommitted content belongs to the
`kisaki-node` stack, and the hint it prints is to reorder the branches (`but move xiranite-rust-rewrite --above
kisaki-node`). Reordering a stack another session is actively committing to is not this task's call, so the
conversions stay in the worktree for that lane to commit, and the gate number already reflects them.

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

One category exists because the first pass under-reported: **`bun-node-export`** catches named imports of Bun's
additions to `node:*` modules. `import { exists } from "node:fs/promises"` (the shape found in
`scripts/lucide-deep-imports.test.ts`) contains no `Bun.` token at all, yet Node does not export `exists` from
`fs/promises`, so the file cannot be loaded there. The category is proven by injection, not by reading the pattern:
adding that import line to a tracked file moves the count 0 → 1 and prints `path:line`, and removing it returns to 0
with the file byte-identical to before.

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
4. **`Bun.TOML` waits for a declared parser.** `smol-toml@1.7.0` is already in the tree, declared by
   `packages/config`, but `scripts/` sits at the workspace root where nothing declares it — importing it there would
   be a phantom dependency. The shared blocker is `scripts/lib/node-build-config.ts:27`, which is the reason
   `audit:target-node-manifest` still cannot be loaded by plain Node (verified: `node scripts/audit-target-node-manifest.ts`
   throws at that line under Node and runs under `bun run`). Either declare `smol-toml` at the root or route the read
   through `@xiranite/config`; both edit the root `package.json`, so the step waits for a moment when that file carries
   no other session's uncommitted lines.
5. Drop `@types/bun` / `bun-types` from the remaining manifests (4 left), then flip the gate strict — only its two
   permanent exemptions (this ADR, its own pattern table) stay.
6. Prose: AGENTS.md's `Node/Bun` phrasing, ADR-0074 §5's face wording, and the migration docs.

## What "zero" means here

The end state is `node scripts/audit-no-bun-apis.ts` reporting **0 non-exempt hits**. Two groups of files are on
track to remove that number *by deletion rather than migration*, and the distinction is recorded so nobody migrates
dead code:

- the **old desktop/backend layer** — `packages/backend`, `scripts/build-desktop-deno.ts`, `scripts/dev-desktop-deno*.ts`,
  `scripts/deno-desktop-command.ts`, `scripts/check-desktop-deno.ts`, `scripts/fetch-bun-runtime.ts`: AGENTS.md already
  lists Deno Desktop, the embedded-Bun host and the standalone backend as layers to delete, so their `Bun.*` calls go
  away with the layer;
- the **`*.bun.test.*` terminal suites** (54 names): they are renamed and run by Vitest, which is the same act as
  step 3, not an extra migration.

Everything else — `scripts/` that stays, `packages/runtime`, the native build scripts — is converted, and the helper
APIs added for it (`spawnProcess`/`ManagedChild`/`readAllText`/`readRangeText`/`which`/`runSync`/`run`) are the
replacement surface: a later call site must reuse them instead of inventing a fourth shape.

## Consequences

- Positive: any file in the tree can be run by plain `node` (verified: Node 26 runs `scripts/x.ts` directly,
  `node --test` and JSON import attributes work), which is what makes the QuickJS/host boundary in ADR-0074 arguable
  in the first place; one test standard; the type layer stops advertising a non-portable global.
- Accepted cost: `scripts/` keeps Bun's speed only where the *runner* provides it; per-call sites that used
  `Bun.spawn`'s ergonomics get a helper instead, and that helper is the thing to reuse rather than re-implement.
- Accepted risk: 205 API mentions plus 72 test files is a long tail. The gate makes the tail visible per category, so
  a partial migration is never mistaken for a finished one.
