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
| `Bun.TOML.parse/stringify` | `parseToml`/`stringifyToml` re-exported by `packages/config/src/xiraniteToml.ts` (`smol-toml`, already declared there) — see migration step 4 for why not the package's dist entry |
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

### Runner coverage: a second check in the same script, counted separately

Migrating the test surface produced 24 suites that ran under **no** runner (11 node packages whose
`Tui.bun.test.tsx` was `--exclude`d with no `bun test` half to pick it up, plus 13 `scripts/` suites outside the root
config's `src/**` include). Nothing in the repo would notice that class coming back, so the gate computes it: for every
tracked `*.test.*` file, each manifest script that could run it is split into "mentions" and `--exclude` clauses, and a
file whose only mentions are inside exclude clauses is reported as unrouted.

Two things worth recording about how this was built:

- **The first version was blind, and the injection control is what said so.** Asking "is this file mentioned by any
  script?" with a plain `includes()` is satisfied by the `--exclude` clause itself, so the check returned `0` against a
  deliberately unrouted suite (`packages/logging/src/cli.test.ts`, made unrouted by editing that package's only test
  script to `vitest run src --exclude src/cli.test.ts --maxWorkers=1`). After splitting the clause out, the same
  injection reports it (`0 → 1`, path printed) and the manifest was restored byte-identical (sha256 unchanged, empty
  diff). The `bun-node-export` category had already taught the same lesson; this is the second gauge that needed a
  violation with a known path before it was trusted.
- **These hits are printed under `Runner coverage:` and kept out of `Bun-only code surface`.** The remaining gap is
  routing, not Bun-specific code, and mixing it into the total would make this gate red for a condition no Bun-API
  conversion can close. `--json` carries it as a separate `unroutedTestFiles` object.

What that surfaced on the current tree is a genuine, older finding, and it is an **inconsistency rather than a policy**.
There are 22 `packages/nodes/*/src/cli.visual.test.ts` suites. Reading every owning manifest's scripts now:

- **14** exclude the file from their only test script (`vitest run src --exclude src/cli.visual.test.ts`, in one of the
  three spellings the repo uses) and name it nowhere else → nothing ever runs them. No root script, no CI job, no turbo
  task mentions it at all: `visual` has zero matches across `package.json`, `.github/workflows/`, `turbo.json`.
- **8** (`bitv`, `dissolvef`, `gifu`, `recycleu`, `sleept`, `smartzip`, `timeu`, `trename`) run `vitest run src` with no
  such exclude → the same file **does** execute there.
- **0** route it deliberately through a second half of the script.

So the same suite class is gated in two incompatible ways per package, and the 14 that opted out are opted out of a
coverage that the other 8 prove is intended to run. The reason for the exclude is real and was measured this session:
`node-pty` aborts on this machine with `Error: posix_spawnp failed.`, which is exactly why those 8 are the red lines in
the per-package baselines. Aligning the 14 upward would therefore turn `test:packages` red here instead of making
anything better, and aligning the 8 downward would delete coverage — neither is this conversion's call, and the excludes
themselves predate it (the migration recipe preserved them verbatim). Recorded here so the gap is visible in the gate's
own output; the fix is a decision about where pseudo-terminal suites run (a dedicated script or CI job that is allowed to
fail where a pty is unavailable), not a Bun-API rewrite.

## Corollary: local import specifiers must name the real file

`scripts/*` imports its own helpers as `./lib/x.js` while only `./lib/x.ts` exists. That resolves under Bun (which
rewrites the extension) and fails under plain Node (`ERR_MODULE_NOT_FOUND`), so the file is not standard-Node code
even when every API in it is. New and touched files import the **actual** specifier (`./lib/subprocess.ts`), the way
`packages/quickjs-shims` already does with `allowImportingTsExtensions`. Proven both ways: after the change,
`node scripts/run-turbo.ts` and `bun scripts/run-turbo.ts` print the same usage line and exit 2 from the same file.

This is a per-file rule applied as each file is touched — no repo-wide specifier sweep is scheduled, because the
runner still resolves the old spelling and a big-bang rename would collide with every in-flight branch.

## The last real Bun dependency in product code: `bun:ffi`

Two sites, both found by the gate's `bun-specifier` category after it was tightened to import positions (a third
mention, `packages/tauri-migrate/src/node-feasibility.ts:156`, is the *vocabulary* list `NO_HOST_FREE_ANSWER_LIBS`
naming FFI libraries beside `koffi`/`ffi-napi`/`ref-napi` — data about a runtime, not a call into it):

- `packages/findz-native/src/index.ts:105-112` — the Findz native client, guarded by
  `if (!process.versions.bun) throw new Error("Findz native core requires Bun's bun:ffi runtime.")`, then
  `dlopen(bindingPath, { findz_call: { args: ["ptr","usize","ptr"], returns: "ptr" }, … })`;
- `packages/native-loader/scripts/build-native-assets.ts:161` — the same call shape in the asset build script.

Measured on this machine (Node 26.10, bun 1.4.2). **`node:ffi` exists, is libffi-backed (`process.versions.libffi`),
and all three shapes Findz needs work** — proven, not inferred:

```js
const { dlopen, types, toString } = await import("node:ffi")
const lib = dlopen("/usr/lib/libSystem.B.dylib", {
  strlen: { arguments: [types.STRING],  return: types.UINT_64 },   // Number(…) === 5
  strdup: { arguments: [types.STRING],  return: types.POINTER },   // bigint pointer
  free:   { arguments: [types.POINTER], return: types.VOID },
})
toString(lib.functions.strdup("roundtrip-pointer"), 9)             // "roundtrip-pointer"
```

**Two traps, both measured the hard way.** (1) The return-type key is `return:`, not bun's `returns:` — and a wrong key
is *silently ignored*, so the first probes returned `NaN`/`undefined` instead of erroring. Any conversion must assert
on a known value (`strlen("hello") === 5`), not assume a signature was accepted. (2) Buffers pass as
`types.BUFFER` without a manual `ptr()`, but declaring a variadic C function with extra fixed arguments produces
garbage (`snprintf(buf, 32n, "hi-%d", 42)` wrote `"hi-1803687648"`) — irrelevant to Findz's fixed-arity ABI, worth
knowing before anyone reaches for it.

**What actually blocks the conversion is the runner, not the API: bun 1.4.2 does not implement `node:ffi`**
(`import("node:ffi")` → `No such built-in module: node:ffi`), while `bun:ffi` is absent from Node. So switching the
two sites to `node:ffi` would move the Bun-only dependency rather than remove it, and doing it while the terminal face
and dev scripts still launch under `bun` needs either a two-path loader or dropping `bun:` from those processes.
The callers are `packages/nodes/findz/src/core.ts` and `src/findz-worker.ts`, i.e. exactly the layer the QuickJS
executor decision (ADR-0074) and the `findz` Go-worker allowlist exception are about, so this is a placement decision
for that lane, not an API port to slip in. Until it is made, the guard at `index.ts:105` says "this needs
`bun:ffi`" out loud rather than failing obscurely, and the gate counts those two hits.

The alternatives, priced: a declared FFI dependency (`koffi`, already named in the feasibility vocabulary) works on
both runtimes but adds a native module to a shipped package and touches `bun.lock`; waiting for `node:ffi` to
stabilise keeps Findz Bun-only and is fine as long as that is *stated*, which is what the guard does.

## Migration order

1. This ADR + the gate (baseline number, and the residue cannot grow silently).
2. `scripts/lib/subprocess.ts` and the helper-level replacements, then the `Bun.*` call sites — `scripts/` first
   (largest count, no shipped surface), then `packages/runtime`, then the rest, file by file.
3. `bun:test` → Vitest and the `*.bun.test.*` → `*.node.test.*` rename, per package, each verified by running the
   suite (assertions unchanged — a migrated test that no longer asserts the same thing is a regression, not a migration).

   **Step 3 is decoupled from the root manifest, contrary to how this ADR first framed it.** Measured 2026-10-05: only
   the `scripts/*` suites are named by the root `test:*` lines (`bun test scripts/…`); the node and runtime packages
   decide their own runner in their **own** `packages/<x>/package.json` `test` script, and `test:packages` runs them
   through turbo. Seventeen packages therefore flip today, no root edit needed. Four are done and verified
   (`packages/cli`, `packages/runtime`, `packages/nodes/trename`, `packages/nodes/enginev`).

   **The recipe, with each knob justified by a measurement rather than by taste:**
   1. **Baseline both halves from inside the package directory.** `bun test src/Tui.bun.test.tsx` run from the repo
      root does *not* run one file — bun treats the argument as a substring filter and matched 30 files, which reads
      as "40 tests pass" and proves nothing. Per-package baselines: cli 1 test/4 expects, runtime 6 tests (5 pass,
      1 fail), trename 2, enginev 4.
   2. **Add a package `vitest.config.ts` with `environment: "node"`.** This is not cosmetic: with no config, vitest
      walks up to the app root `vite.config.ts`, whose setup imports `src/i18n`, which calls
      `window.localStorage.setItem` — Node 26 defines `window` but leaves `localStorage` undefined unless
      `--localstorage-file` is passed. Measured consequence: **every test file in `packages/cli`, `packages/nodes/trename`
      and `packages/nodes/enginev` failed to collect under the package's own existing `vitest run` half**, so those
      suites were not actually running. After the config, all four files per package pass. That is coverage recovered,
      not coverage traded for a green board.
   3. **Two extra knobs for the OpenTUI tests.** `test.server.deps.inline: [/@opentui\/react/]` plus
      `resolve.alias: { "react-reconciler/constants": "react-reconciler/constants.js" }`, because
      `react-reconciler@0.33.0` ships `constants.js` with **no `exports` map**: Bun's resolver appends the extension,
      Node's ESM loader refuses and throws `Cannot find module`. The alias only takes effect once vite (not Node)
      resolves the importer, hence the inline list. Without these two lines the OpenTUI test fails at collection; with
      them it runs in the same ~200 ms it took under bun.
   4. **Drop only the runner coupling from the `test` script**: remove the trailing `&& bun test <file>`, the
      `--exclude src/Tui.bun.test.tsx`, and the now-redundant `--environment node`; preserve
      `--exclude src/cli.visual.test.ts`, `--passWithNoTests`, and the package's existing
      `node ../../../node_modules/vitest/vitest.mjs` spelling. Edit the manifest as **text** — a JSON round-trip
      silently reformatted compact lines in `packages/nodes/enginev/package.json` and that churn had to be reverted.
      Acceptance: `git diff` for the manifest is 1 added / 1 removed.
   5. **Matcher surface:** Vitest 4.1.10 has no `toBeTrue()`/`toBeFalse()` (measured:
      `Error: Invalid Chai property: toBeFalse`), so those become `.toBe(true)`/`.toBe(false)` — same strength, not a
      loosening. **And my first survey for this was itself wrong, which is worth recording as a method lesson:** its
      regex demanded empty parens (`\.toStartWith\(\)`), so it reported "zero remaining uses" while
      `packages/cli-runtime/…/image-preview.bun.test.ts:56` still had `toStartWith("\u001bP")` — a matcher **with an
      argument**. The discovery was not a green-board correction: that file failed the moment it ran under vitest
      (`Error: Invalid Chai property: toStartWith`). Rescanning 415 tracked test files with `\.matcher\(` instead found
      two more sites, both in the root-coupled `scripts/` group (`backend-gateway.integration.test.ts` `toBeString`,
      `node-definition.test.ts` `toBeObject`), so they travel with that wave rather than being converted on their own.
      Translations used: `toStartWith(x)`/`toEndWith(x)` → `startsWith(x)`/`endsWith(x)` plus `toBe(true)`, same strength.
      A survey whose pattern is "the shape I expected" is not a gauge — the failing test was the check that caught it.
      That blind spot is now a gate category, **`bun-test-matcher`**, so it cannot recur silently: it lists every
      `.toBeTrue|.toBeString|.toStartWith|…(` call site. It reports 1 hit today
      (`scripts/node-definition.test.ts:270`, in the root-coupled group), and its gauge was checked by injection —
      adding `expect(1).toBeTrue()` to a tracked file moved the count 1 → 2 with the path:line printed, and removing it
      returned to 1 with the file byte-identical. Note this is why the gate total rose 34 → 35: the number went up
      because the instrument got eyes, not because the code got worse.
   6. **Equality criterion per package:** the migrated file must report the same test count as the bun baseline, and
      the package must have at least as many passing files as before. `packages/runtime` is the case that shows the
      criterion is honest rather than "make it green": it still reports exactly one failure under vitest, the same
      `node-module-loader` test that fails under bun because the node it watches (`packages/nodes/neoview/src`) no
      longer exists — the child just runs on `node` now instead of `bun` (same `ENOENT: watch`, same root cause).
   7. **Which knob is load-bearing was itself measured wrong at first, and is corrected here.** Fourteen packages are
      migrated as of this writing (cli, runtime, trename, enginev, bandia, bitv, classf, classq, cleanf, clipm, encodb,
      formatv, gifu, recycleu, plus repacku, sleept, smartzip, timeu). For **`packages/cli`, `packages/logging`(no),
      `trename`, `enginev` and `bandia`** the package's existing vitest half really did fail at collection through the
      root config's i18n setup. For **classf, classq, cleanf, encodb, formatv, gifu, recycleu, repacku, sleept,
      smartzip, timeu and clipm's other files** that half was already green: the root `vite.config.ts` carries a
      `test` block (`environment: "happy-dom"`, `setupFiles: src/test/setup-i18n.ts`) which those tests tolerate. So
      the knob that *always* decides whether the OpenTUI file can load is the `react-reconciler/constants` alias plus
      `server.deps.inline` (measured error without them: `Cannot find module '.../react-reconciler/constants' imported
      from .../@opentui/react/chunk-hjtp6jv9.js`). **A package config's comment must state only what that package
      measured** — five configs shipped with a copied "every test file failed to collect" sentence that was false, and
      were rewritten before commit.
   8. **A package-local `include` can silently swallow the migrated file.** `packages/nodes/clipm` had
      `include: ["src/**/*.test.ts"]`, i.e. `.ts` only — after the rename its `.tsx` suite would have collected
      nothing, and the package would have reported success while never running the Tui test. Verified after widening
      to the default pattern: 12 files collected (11 before, +1 = the migrated suite).
   9. **Renaming breaks gates that hard-code the old name.** `scripts/audit-node-tuis.ts` looked only for
      `src/Tui.bun.test.tsx`, so after the first nine renames every migrated package reported `missing OpenTUI test`.
      Fixed by listing both spellings as candidates, with the negative control run in the same session: hiding
      `packages/nodes/trename/src/Tui.node.test.tsx` moves the count 1 → 2 and restoring it returns to 1, so the rule
      was widened, not neutered. `docs/migration/node-quickjs-workorders.json` still carries 39 stale paths; it is
      another lane's untracked snapshot, so it is reported rather than edited here.
   10. **Reds the wave uncovered that are not about Bun** (listed so nobody attributes them to the migration or
       "fixes" them by excluding): `cli.visual.test.ts` fails with `Error: posix_spawnp failed.` from `node-pty`
       (`scripts/cli-visual-testing.ts:270` spawns a pty of `bunExecutable()`) in bitv, gifu, recycleu, sleept,
       smartzip and timeu — identical at baseline, and those scripts never excluded the file; `clipm`'s
       `mcp-client.integration.test.ts` fails with `MCP error -32000: Connection closed`, and its `test:python` step
       cannot resolve `torch==2.4.0+cu121` on macOS arm64 at all; `packages/cli`'s `index.test.ts` asserts a help line
       that the product has since changed (`xiranite [ui | logs | <node> [args]]`), a stale expectation left by
       whoever added `logs`.
4. **`Bun.TOML` → the parser the tree already declares, and the earlier note about this blocker was wrong in both
   directions.** Measured 2026-10-05: `smol-toml@1.7.0` is in the tree via `packages/config`, and importing
   `@xiranite/config` does **not** require editing the root `package.json` — but its `exports` map points at
   `./dist/index.js`, and CI's first gate step is `bun run generate:node-registries` (`.github/workflows/ci.yml:52-53`),
   which runs *before* any package build and already imports `scripts/lib/node-build-config.ts`. So the dist route
   would make the lazy builder depend on an artefact the builder produces. The route that works is the **leaf source
   file**: `packages/config/src/xiraniteToml.ts` imports only `smol-toml` and re-exports `parseToml`/`stringifyToml`,
   and `smol-toml` resolves because the *declaring* package owns the importing file — the same cross-package source
   import `audit-quickjs-host-ops.ts:46` already uses for `packages/quickjs-shims/src/*.ts`.
   Six of the seven call sites are converted this way (`node-build-config.ts:27`, `audit-node-registry.ts` ×3,
   `audit-plugin-manifests.ts` ×1, its test's `stringify` ×1); the seventh is `scripts/build-node-wasm.ts:96`, which
   belongs to the retired wasm layer and is not migrated.
   A/B evidence that the parsers agree rather than merely loading: with `Bun.TOML` the three gates printed
   `audit:node-registry rc=0 (28 retained nodes)`, `audit:plugin-manifests rc=0 (9 plugins)`,
   `audit:target-node-manifest rc=1` with exactly one `FAIL` line (`movea: … scripts/quickjs-parity-cases.ts`, another
   lane's seam). Under the swap they print the same three verdicts under **both** runtimes, and
   `node scripts/audit-target-node-manifest.ts` now runs to that FAIL set instead of throwing at the `Bun.TOML` line —
   which is the claim this step existed to prove.
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
