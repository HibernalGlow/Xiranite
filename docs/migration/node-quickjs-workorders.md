# Node → QuickJS work-order ledger (the 41 retained TypeScript nodes)

Generated 2026-10-05 next to `docs/migration/node-quickjs-workorders.json`, which carries the full records —
evidence lines, per-member provenance, roots, processes, budgets and test files. **Do not hand-edit either file:**
every number here is read off another artifact, §7 states how each field is derived, and §8 gives the commands, so a
regeneration re-derives the same fields instead of re-arguing them.

| what | value | where it comes from |
|---|---|---|
| records in this ledger | 41 | `docs/xiranite-target-node-manifest.json`, `disposition: retain-rewrite` |
| bundle records (41 retained + 3 hold) | 44 | `artifacts/node-bundles/manifest.json:31-37` (`counts.nodes: 44`, generatedAt 2026-10-04T21:10:32.921Z) |
| entries in the runtime registry table | 42 | `packages/runtime/src/node-runner.generated.ts` (41 retained + `kisaki`) |
| retained nodes with no `core.ts` | 0 | none — every `retain-rewrite` id has `packages/nodes/<id>/src/core.ts` (the same predicate `scripts/audit-node-bundles.ts:384-392` walks) |
| host operations the executor answers | 29 | `crates/xiranite-quickjs-executor/src/host_calls.rs` `HostOperation::ALL` (read after its 2026-10-05 05:52 write) |
| of those, wired through a shim member today | 12 | `packages/quickjs-shims/src/host.ts:60-73` (`OPERATIONS_V1`), `ops.ts` `hostCall` sites, `surface.ts:66-207` `implemented` lists |
| shimmed `node:` builtins | 8 | `packages/quickjs-shims/src/surface.ts:39-48` (`SHIMMED_BUILTINS`) |
| node test files carried by the 41 | 169 | `packages/nodes/*/src/*.test.ts(x)`, per record `testOracle.files` |
| retained core bundle bytes | 2,651,795 over these 41 | `artifacts/node-bundles/manifest.json` `counts.totalCoreBytes` = 3,012,226 over all 44 — the 2.8 MiB ADR-0074 §6 cites |

> **Read §2 before quoting this file anywhere.** The executor grew from 12 answered operations to 29 while this ledger
> was being built, and the shim layer has not caught up. Most of what looks like missing host work is a shim wiring
> task; §9.10 states the two places that pin it.

## 1. Totals

| difficulty | nodes | ids (cheapest first) |
|---|---|---|
| `trivial` | 3 | audiov, mvz, soundw |
| `normal` | 20 | classq, encodeb, formatv, kavvka, linedup, migratef, nameu, snf, synct, crashu, dissolvef, linku, movea, samea, seriex, timeu, transq, trename, repacku, sleept |
| `heavy` | 16 | cleanf, logx, marku, bandia, jellypot, recycleu, classf, enginev, coveru, envuconfig, rawfilter, bitv, smartzip, lorat, gifu, comfygure |
| `blocked` | 2 | owithu, findz |

Ladder (rule in §7): **trivial** = nothing the node's own code reaches is missing today, and `fileIo: none` (no granted
root), and no os-native or network need; **normal** = at most two own-code gaps; **heavy** = three or more own-code
gaps, or an os-native service, or a core bundle over 100 KB (the interpreter cost ADR-0074 accepts as its negative), or
network; **blocked** = the two structural blockers.

Only **3** nodes are trivial — `audiov`, `mvz`, `soundw` — and the reason is worth stating plainly: the
other 38 each reach at least one thing that throws today. Four nodes (`formatv`, `linedup`, `logx`, `marku`) reach
exactly one thing, `locale.compare`: QuickJS ships no Intl and answers `localeCompare` as a code-unit comparison, which
silently reorders non-ASCII names (ADR-0074 §2, `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md:62-64`).

| blocker | nodes | ids |
|---|---|---|
| `none` | 31 | audiov, bitv, classq, coveru, crashu, dissolvef, encodeb, envuconfig, formatv, gifu, kavvka, linedup, linku, logx, lorat, marku, migratef, movea, mvz, nameu, rawfilter, repacku, samea, seriex, sleept, snf, soundw, synct, timeu, transq, trename |
| `os-native:recycleBin` | 5 | bandia, cleanf, enginev, recycleu, smartzip |
| `go-worker` | 1 | findz |
| `native-addon` | 1 | owithu |
| `network` | 1 | comfygure |
| `os-native:clipboard` | 1 | classf |
| `os-native:registry` | 1 | jellypot |

## 2. The three states a gap can be in

A host operation may be **answered and wired** (the node runs today), **answered but not wired** (the Rust side replies,
but the shim member still throws — the fix is a shim line, not a host project), or **not answered at all**.

| state | operations | nodes whose own code is blocked by it |
|---|---|---|
| answered **and** wired (`clock.now, crypto.randomBytes, crypto.randomUUID, fs.delete,…`) | 12 | — these run today |
| answered, **not** wired | 17: crypto.digest, fs.appendText, fs.copy, fs.link, fs.mkdtemp, fs.readBytes, fs.readlink, fs.realpath, fs.symlink, fs.utimes, fs.writeBytes, os.cpus, os.homedir, proc.kill, proc.poll, proc.spawn, proc.wait | 28 |
| not answered | locale collation, realm timer, realm `require`/`import.meta`, file-handle reads, network, worker | 25 |

Operations the executor already answers but no shim member calls yet — `fs.copy`, `fs.utimes`, `fs.appendText`,
`fs.mkdtemp`, `fs.realpath`, `fs.link`, `fs.symlink`, `fs.readlink`, `crypto.digest`, `os.homedir`, `os.cpus`,
`proc.spawn`, `proc.poll`, `proc.wait`, `proc.kill`, `fs.readBytes`, `fs.writeBytes` — are **exactly** the list
`packages/quickjs-shims/src/host.ts:78-90` still calls `OPERATIONS_V2_REQUESTED`. The host overtook the shim.

Reached-and-answered counts over the 41 records (`hostOperationsRequired.servedByExecutor`, the wired twelve only):

| operation | nodes reaching it | reached through |
|---|---|---|
| `fs.stat` | 36 | `access`/`stat`/`lstat`/`existsSync`/`accessSync` — `packages/quickjs-shims/src/fs-promises.ts:146-157`, `packages/quickjs-shims/src/fs.ts:80-90` |
| `fs.ensureDir` | 32 | `mkdir`/`mkdirSync` |
| `proc.exec` | 30 | `execFile`/`execFileSync` — `packages/quickjs-shims/src/child-process.ts:103,140` |
| `fs.list` | 30 | `readdir`/`readdirSync` |
| `fs.move` | 23 | `rename`/`renameSync` |
| `fs.writeText` | 21 | `writeFile`/`writeFileSync` |
| `fs.delete` | 20 | `rm`/`unlink`/`rmdir` and the Sync forms |
| `fs.readText` | 20 | `readFile`/`readFileSync` |
| `crypto.randomUUID` | 6 | `randomUUID` — `packages/quickjs-shims/src/crypto.ts:19` |
| `os.tmpdir` | 3 | `tmpdir` — `packages/quickjs-shims/src/os.ts:24` |

`proc.exec` at 30 is **overstated**: 16 of those nodes import `execFile` in `src/platform.ts` only for the
byte-identical clipboard boilerplate that `docs/migration/node-native-shape.md:113-119` files under `cliOnlySpawn` —
`cleanf, crashu, dissolvef, encodb, enginev, formatv, kavvka, linedup, linku, lorat, marku, migratef, movea, rawfilter,
seriex, trename` — a path the node core never calls. Those records repeat the warning under `crossChecks` so nobody
declares a program the node does not use.

## 3. Gaps, ranked

### 3.1 Own-code gaps that need **shim wiring only** (the host already answers them)

| operation | nodes | the nodes |
|---|---|---|
| `fs.copy` | 18 | bitv, classq, coveru, crashu, dissolvef, encodeb, enginev, envuconfig, gifu, kavvka, linku, lorat, migratef, movea, rawfilter, seriex, transq, trename |
| `fs.appendText` | 4 | envuconfig, gifu, jellypot, smartzip |
| `fs.utimes` | 4 | nameu, snf, synct, timeu |
| `fs.mkdtemp` | 3 | gifu, repacku, smartzip |
| `crypto.digest` | 2 | comfygure, lorat |
| `fs.symlink` | 2 | linku, rawfilter |
| `child_process.ChildProcess (member absent from the shim module)` | 1 | gifu |
| `fs.Dirent (member absent from the shim module)` | 1 | transq |
| `fs.link` | 1 | bitv |
| `os.cpus` | 1 | sleept |
| `proc.spawn` | 1 | bandia |

### 3.2 Own-code gaps that need **host work**

| gap | nodes | the nodes | what is actually missing |
|---|---|---|---|
| `locale.compare` | 20 | bitv, comfygure, coveru, crashu, dissolvef, enginev, envuconfig, formatv, gifu, linedup, logx, lorat, marku, movea, rawfilter, repacku, samea, seriex, timeu, trename | one host collation, ADR-0074 §2; nothing in operations answers it |
| `fs.open/readRange/closeHandle host-handle operations` | 3 | coveru, lorat, smartzip | `fs.readBytes`/`fs.writeBytes` exist, but `fs/promises.open` needs a host-held handle |
| `locale.lowerUpperFormat` | 3 | classf, comfygure, samea | same collation service |
| `timer.after` | 3 | comfygure, recycleu, sleept | no realm timer; nothing in `crates/xiranite-quickjs-executor/src/` wires `setTimeout`/`setInterval` |
| `net.fetch` | 1 | comfygure | no socket surface in operations; comfygure is the only network node |
| `realm.importMetaUrl` | 1 | findz | the realm has no `import.meta`; `findz` needs `new URL('./findz-worker.js', import.meta.url)` |
| `threading.worker` | 1 | findz | no worker surface; `findz` plus the `fflate`/`zip.js` codec pools |

### 3.3 All gaps by nodes touched, any origin (including shared workspace code and npm)

| operation | nodes | note |
|---|---|---|
| `locale.compare` | 24 | ADR-0074 §2 wants one host collation |
| `fs.copy` | 22 | `cp`/`copyFile` — `surface.ts:74-75`; the host answers `fs.copy` already |
| `timer.after` | 15 | no realm timer |
| `os.homedir` | 12 | all of them reach it through `packages/platform/dist/index.js:1`, not node source |
| `realm.require` | 12 | `createRequire` — `packages/czkawka-native/src/index.ts:2` plus npm dist |
| `locale.lowerUpperFormat` | 8 | `toLocaleLowerCase`/`toLocaleUpperCase`/`toLocaleString` |
| `fs.realpath` | 7 | `surface.ts:80`; the host answers `fs.realpath` already |
| `threading.worker` | 7 | no worker surface |
| `crypto.digest` | 6 | `surface.ts:179-180`; the host answers `crypto.digest` already |
| `realm.importMetaUrl` | 6 | no `import.meta` in a realm |
| `fs.appendText` | 4 | `surface.ts:73`; the host answers it already |
| `fs.open/readRange/closeHandle host-handle operations` | 4 | `open` hands back a descriptor the realm cannot own |
| `fs.utimes` | 4 | `surface.ts:81`; the host answers it already — and it is the whole product of `nameu`/`snf`/`synct`/`timeu` |
| `fs.mkdtemp` | 3 | `surface.ts:76`; the host answers it already |
| `fs.symlink` | 2 | `surface.ts:78`; the host answers it already |
| `locale.intlAbsent` | 2 | `Intl` absent |
| `child_process.ChildProcess (member absent from the shim module)` | 1 | esbuild still resolves the type-only import |
| `fs.Dirent (member absent from the shim module)` | 1 | esbuild still resolves the type-only import |
| `fs.access (member absent from the shim module)` | 1 | `packages/quickjs-shims/src/fs.ts:127` exports `accessSync` but not `access`, and `surface.ts:98-122` lists it in neither bucket, so the named-import check kills the bundle |
| `fs.createReadStream (operation not named in surface.ts)` | 1 | host-held descriptor with backpressure |
| `fs.createWriteStream (operation not named in surface.ts)` | 1 | as read |
| `fs.link` | 1 | `surface.ts:77`; the host answers it already |
| `net.fetch` | 1 | no socket surface |
| `net.webSocket` | 1 | no socket surface |
| `os.cpus` | 1 | `surface.ts:149`; the host answers `os.cpus` already |
| `proc.execShell` | 1 | bypasses the allowlist, deliberately unanswered |
| `proc.spawn` | 1 | `surface.ts:136`; the host answers `proc.spawn` already |
| `util.TextDecoder (operation not named in surface.ts)` | 1 | `surface.ts:170-171`: should come from the engine global (`quickjs-wpt-sys`), not realm code |

The headline is §3.1: **18 of the 41 nodes are blocked on `fs.copy` alone, and the host already answers `fs.copy`.**
Wiring `cp`/`copyFile` in `packages/quickjs-shims/src/fs-promises.ts` plus dropping the `OPERATIONS_V1` subset gate
(`surface.ts:30`, `host.ts:60-73`) moves more nodes than any other single change in this ledger.

## 4. Unmapped builtins, ranked by node count

`unmappedExternals` is `nodes.<id>.core.unresolvedExternals` unioned with `nodes.<id>.platform.unresolvedExternals` from
`artifacts/node-bundles/manifest.json`, i.e. what the aliased build could not resolve. For the two nodes whose bundle
does not build (`logx`, `owithu`) the closure scan in `nodeBuiltinsTouched.beyondShimmed` supplies the list instead.

| builtin | nodes | what drags it in |
|---|---|---|
| `stream` | 9 | `graceful-fs`/`proper-lockfile` via `@xiranite/config`; `liquidjs`; `rotating-file-stream` |
| `events` | 8 | `graceful-fs`, `packages/logging/dist/node.js:6`, `@stable-canvas/comfyui-client` |
| `assert` | 7 | `graceful-fs`/`proper-lockfile` |
| `constants` | 7 | `graceful-fs` |
| `worker_threads` | 7 | the cluster path inside `graceful-fs` |
| `module` | 5 | `packages/czkawka-native/src/index.ts:2` (`createRequire`) — the recycle-bin service, so it rides along with every `recycleBin` node |
| `zlib` | 2 | `packages/logging/dist/node.js:7` and `node:zlib` in comfygure's platform |
| `readline` | 1 | `packages/logging/dist/node.js:5` |
| `string_decoder` | 1 | `iconv-lite` (`encodeb`) |
| `timers` | 1 | `node_modules/rotating-file-stream/dist/esm/index.js:9` |
| `vm` | 1 | `jsonpath-plus`, inside comfygure's core |

12 of the 41 produced bundles carry at least one unmapped builtin: bandia, classf, cleanf, comfygure, dissolvef, encodeb, enginev, linku, marku, migratef, smartzip, trename. Not one of them
is a *node* requirement in the `NodeRequirements` sense — they are shared-code and npm surface, which the
`docs/migration/quickjs-substrate-evaluation.md:121` (§3.2) count never saw because it was taken over `platform.ts`
direct imports only. Recomputed over the whole closure the eight come out at fs/promises
36, path 34, child_process 30, fs 12, os 15, util 5, crypto 7, url 5 —
the same eight names, but `os` 4→15 and `util` 4→5. See §9.4.

## 5. Recommended migration order (cheapest fidelity first)

Waves are named after the prerequisite that opens them, not after effort. Inside a wave, order is
`migrationOrderScore` ascending (own-code gaps ×100, declared programs +10, os-native +50, core bundle over 100 KB +30,
network +20, blocked +100000). `migrationWaveOrder` and `prerequisites` are on every record.

**Wave 1** — nothing required — operations v1 already covers the node (3 nodes): audiov, mvz, soundw

**Wave 2** — shim wiring only: the host already answers these operations (9 nodes): classq, encodeb, kavvka, migratef, nameu, snf, synct, linku, transq

**Wave 3** — the host locale-collation service (+ shim wiring) (14 nodes): formatv, linedup, crashu, dissolvef, movea, samea, seriex, timeu, trename, repacku, envuconfig, rawfilter, bitv, gifu

**Wave 4** — the remaining host surfaces (realm timer, file handles, realm require) (3 nodes): sleept, coveru, lorat

**Wave 5** — os-native services, network, and the interpreter-cost decision (10 nodes): cleanf, logx, marku, bandia, jellypot, recycleu, classf, enginev, smartzip, comfygure

**Wave 6** — structural blockers (2 nodes): owithu, findz

Wave 1 first, on purpose: `audiov`, `mvz`, `soundw` need nothing the executor has not already answered (`fs.stat` for a
candidate-path probe plus `proc.exec` for one allowlisted program), and all three are `fileIo: none`
(`docs/migration/node-native-shape.md:100-102`), so they exercise bundle → `run(input, runtime, onEvent)` → result
document with no granted root in the way. `linedup` is the other natural harness target: it is the ledger's only pure
node (`pureNode: true`, `run: filterLines`, `createRuntime: null`,
`packages/runtime/src/node-runner.generated.ts:140-145`), so it is the cheapest test of ADR-0074's parity gate.

Wave 2 is the payoff wave: nine nodes whose *only* own-code gap is a shim member the host already answers
(`fs.copy` for seven of them, `fs.utimes` for `nameu`/`snf`/`synct`, `fs.symlink` for `linku`, the type-only
`fs.Dirent` for `transq`). Do the shim wiring once and take them together.
Wave 3 needs the host collation service; it is 14 nodes and it is also the one-time re-baseline ADR-0074 §Consequences
warns about ("existing tests that encode the old machine-dependent ordering have to be re-baselined once, deliberately"),
so land it with the golden table from ADR-0074 verification item 3 rather than node by node.

## 6. Fidelity oracles

- 41 of 41 retained nodes ship `packages/nodes/<id>/src/core.test.ts`;
- 39 of those import no `node:fs`, no `node:child_process` and no socket — **39 nodes re-run inside the
  executor with no machine at all**, which is the oracle ADR-0074 §Verification item 1 asks for (unchanged assertions);
- the two exceptions are `dissolvef` and `kavvka`, whose `core.test.ts` builds real temporary directories, so their run
  needs a granted scratch root;
- `cli.*` and `Tui.*` files are listed per record with `face: cli` / `face: tui`, but ADR-0074 §5 keeps the terminal shell
  in TypeScript, so they are **not** part of the QuickJS fidelity run;
- `dissolvef` also has a native Rust twin (`crates/nodes/dissolvef`), which makes it ADR-0074 verification item 4's
  parity pair: native executor versus QuickJS executor, same result document, same undo journal.

## 7. How each field is derived

| field | derivation |
|---|---|
| `runExport`, `createRuntimeExport`, `pureNode` | parsed out of `packages/runtime/src/node-runner.generated.ts` the way `scripts/audit-node-bundles.ts:194-199` parses it; a `message:` block with no `createRuntime:` is a pure node. Never guessed. |
| `coreBundleBytes`, `platformBundleBytes`, `unmappedExternals`, `bundleErrors` | `artifacts/node-bundles/manifest.json`, fields `nodes.<id>.core`/`.platform` → `bytes`, `unresolvedExternals`, `error`; produced by `bun run build:node-bundles`. |
| `closure.*`, `nodeBuiltinsTouched.*`, `hostOperationsRequired.*` | esbuild metafile scan per face — `esbuild packages/nodes/<id>/src/core.ts --bundle --platform=node --format=esm --metafile=…`, and the same for `platform.ts`, **without** `--alias`, the same resolver path as `spikes/node-core-isolation-scan.ts:64-79`. Every named import, namespace import and `createRequire` destructuring of a builtin in the closure becomes `module.member@file:line`; each evidence path is attributed `node`, `workspace-package` or `npm` by prefix, and the node's own file wins when several exist. |
| member → operation | `packages/quickjs-shims/src/ops.ts` (`opFsStat` … `opTmpdir`) plus `surface.ts:66-207`. A member in a module's `unsupported` list contributes its `requiredOperation` text; a member Node has that the shim module does not export at all contributes a `build-breaking` entry, because that is what stops the bundle compiling. |
| `hostAnswersIt`, `shimWiresIt`, `gap` | `hostAnswersIt` compares the operation name against `HostOperation::ALL` read from `crates/xiranite-quickjs-executor/src/host_calls.rs` (29 names, file mtime 2026-10-05 05:52). `shimWiresIt` compares against `OPERATIONS_V1` at `packages/quickjs-shims/src/host.ts:60-73` (12 names) and the `hostCall` sites in `ops.ts`. The executor is the moving part here — re-read it, do not trust this file's counts next week. |
| `requirements.processes` and evidence | `docs/migration/node-native-shape.json` `nodes.<id>.spawn` / `spawnEvidence`. `confirmBeforeRun` is set only for the seven DangerGate nodes at `docs/migration/node-native-shape.md:196-203` (`bandia, enginev, cleanf, smartzip, recycleu, sleept, owithu`). |
| `requirements.roots` | `docs/migration/node-native-shape.json` `fileIo`/`fileIoAll` decides whether a root is needed; reaching `fs.writeText`/`fs.move`/`fs.delete`/`fs.ensureDir` decides `ReadWrite` versus `ReadOnly`; the role string stays **provisional** and the path-shaped field ids of `node-definitions/<id>.json` are quoted as candidates, because the only precedent in the tree is `workspace` (`crates/nodes/dissolvef/src/builtin.rs:37-40`). Five nodes (`logx, nameu, snf, timeu, transq`) have no `node-definitions/<id>.json`, so their candidates come from `plugins/<id>/manifest.toml` `allowed_paths`. |
| `requirements.enumeratesRecursively` | `docs/xiranite-target-node-manifest.json` `hostRequirements` containing `recursive-enumeration` (the ADR-0073 renamed field), itself an ast-grep product in `artifacts/node-host-requirements.json`. |
| `requirements.budget.maxLiveBytes` | `plugins/<id>/manifest.toml` `memory_max_pages` × 65536, the arithmetic the native dissolvef registration documents (`crates/nodes/dissolvef/src/builtin.rs:41-45`, `crates/nodes/dissolvef/manifest.toml:11`). Only 9 retained nodes have such a manifest — `classq` 256, `linedup` 256, `logx` 1024, `nameu` 512, `samea` 256, `snf` 256, `soundw` 64, `timeu` 256, `transq` 64 pages. Every other record says *no ceiling on record* rather than inventing one: ADR-0073 and AGENTS.md both record that the wasm memory limit was never wired into a host. `maxConcurrentItems` is `null` everywhere for the same reason. **These 9 files are being retired right now** (see §9.11), so this is the last run that can read them. |
| `fileIoClassFromShape`, `fileIoAllFromShape` | copied from `docs/migration/node-native-shape.json` so a reader sees the verdict behind a root decision without opening a second file. |
| `prerequisites`, `migrationWaveOrder`, `migrationOrderScore`, `estimatedDifficulty` | the rules stated in §1, §3 and §5, applied to the fields above. |
| `crossChecks` | where two artifacts disagree about *this* node; §9 lists the recurring ones. |

## 8. How to regenerate

```sh
bun run build:node-bundles        # esbuild only, never cargo; refreshes artifacts/node-bundles/manifest.json
bun run audit:node-bundles        # today: OK, 41 retained required / 44 records / 19 warnings
# then the ledger pass: for each of the 41 retain-rewrite ids, per face in {core, platform},
#   esbuild packages/nodes/<id>/src/<face>.ts --bundle --platform=node --format=esm --metafile=<scratch>/<id>.<face>.json
#   (no --alias, so the builtins stay visible; <scratch> is a throwaway directory), then join the metafiles against
#   docs/xiranite-target-node-manifest.json    packages/runtime/src/node-runner.generated.ts
#   artifacts/node-bundles/manifest.json      docs/migration/node-native-shape.json
#   packages/quickjs-shims/src/surface.ts     packages/quickjs-shims/src/host.ts
#   crates/xiranite-quickjs-executor/src/host_calls.rs   (re-read it: it is being extended)
#   plugins/*/manifest.toml  node-definitions/*.json  packages/nodes/*/src/*.test.ts
# writing docs/migration/node-quickjs-workorders.json and rendering this file from it.
```

The join is not committed as a script: it is read-only over the artifacts named above, and §7 pins its rules so the next
run re-derives the same fields. Everything in this file that is not a citation of an artifact is a rule stated here.

## 9. Contradictions and drift found while building this ledger

1. **41 vs 43 vs 44 vs 42.** The request spoke of 43 nodes. `docs/xiranite-target-node-manifest.json` carries 41
   `retain-rewrite` ids (the gate agrees: `bun run audit:node-bundles` prints 41 retained node(s) required) and
   `docs/migration/node-native-shape.md:15` says 41; `artifacts/node-bundles/manifest.json:31` says 44, because it unions
   in the three `hold-unmigrated` ids (`clipm`, `kisaki`, `lata` — universe rule at `scripts/build-node-bundles.ts:23-25`);
   `packages/runtime/src/node-runner.generated.ts` registers 42 (41 + `kisaki`). **This ledger has 41 records**;
   `clipm`/`lata`/`kisaki` stay out as debt, matching `scripts/audit-node-bundles.ts:262-264`.
2. **`owithu` is blocked in one artifact and clean in the other.** `docs/migration/node-native-shape.md:81` gives it
   `blockers = –` and `docs/migration/node-native-shape.json` records an empty `blockers` array, while
   `artifacts/node-bundles/manifest.json` (`nodes.owithu.core.error`, `.bundleError`) reads *No loader is configured for
   `.node` files: node_modules/registry-js/build/Release/registry.node* and `scripts/audit-node-bundles.ts:67-71`
   already allowlists it as a structural blocker. The addon arrives through
   `packages/shell-integration/src/node.ts:38` (a dynamic import of `registry-js`), which both faces reach
   (`packages/nodes/owithu/src/core.ts:2`, `packages/nodes/owithu/src/platform.ts:4`). Ledger: `blocked` / `native-addon`.
3. **`logx`'s dead platform bundle is invisible to the gate.** `bun run audit:node-bundles` exits 0 and none of its 19
   warnings mentions `logx`, because `scripts/audit-node-bundles.ts:338` guards with
   `if (platform && platform.ok && platform.path)` and silently skips a platform bundle that never built. Yet
   `artifacts/node-bundles/manifest.json` records `logx.platform.ok = false`, error *No matching export in
   `packages/quickjs-shims/src/fs.ts` for import `access`*. Cause: `node_modules/rotating-file-stream/dist/esm/index.js:4`
   imports `{ access }` from `node:fs`; `packages/quickjs-shims/src/fs.ts:127` exports `accessSync` but not `access`;
   `packages/quickjs-shims/src/surface.ts:98-122` lists `access` in neither `implemented` nor `unsupported`, so
   `memberState(fs, access)` answers *unknown* and nothing turns red. The silent-miss class ADR-0073 warns about: a
   green bundle gate does **not** mean 43 cores and 44 platforms build.
4. **The eight-builtins figure is a `platform.ts`-direct-import count.** `docs/migration/quickjs-substrate-evaluation.md:121`
   says `os` 4 nodes and `util` 4; over the whole closure the ledger measures `os` 15 and `util` 5, and 12
   produced bundles still import assert, constants, events, module, stream, string_decoder, vm, worker_threads, zlib as externals (§4). `scripts/audit-node-bundles.ts:72-76`
   noticed it for `comfygure` alone — *The §3.2 8 builtins measurement was over platform.ts's direct imports only* — but
   it holds for 12 nodes, not 1. ADR-0074's *What the host has to provide is the same list either way: 8 `node:`
   builtins* (`docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md:32-35`) is understated: the host also needs a timer, a collation service and an answer for
   `createRequire`.
5. **A registered node whose `run` export does not exist.** `packages/runtime/src/node-runner.generated.ts:136,138`
   registers `kisaki` as `run: runKisaki` / `createRuntime: createNodeKisakiRuntime`, but
   `packages/nodes/kisaki/src/core.ts:430` exports `runCzkawka` and `packages/nodes/kisaki/src/platform.ts:166` exports
   `createNodeCzkawkaRuntime`; the produced bundle's own export block (the final `export { … }` of
   `artifacts/node-bundles/kisaki.core.js`) lists `runCzkawka`, `CZKAWKA_TOOLS`, `smartSelect`.
   `bun run audit:node-bundles` WARNs both absences. The surviving source is the czkawka surface the manifest declares
   `removed` (`docs/xiranite-target-node-manifest.json:204-220`), so it is out of scope here — but it is the
   silent-miss-under-registration failure ADR-0073 predicted, on the TypeScript side.
6. **16 nodes would declare a program their core never runs** (§2). `docs/migration/node-native-shape.md:113-119` is the
   right-hand side; a naive import scan — the one behind §3.2, and this ledger's `servedByExecutor` column — over-counts.
   Both readings live in the records under `crossChecks` so a farming agent does not re-litigate it.
7. **`fileIo: none` versus a real `fs.stat`.** `docs/migration/node-native-shape.md:100-102` files `audiov` under
   `fileIo: none`; the reason is `packages/nodes/audiov/src/platform.ts:48-50`, an existence probe
   `access(path, constants.F_OK)` on candidate ffmpeg paths. That probe *is* host operation `fs.stat`, answered by
   `packages/quickjs-shims/src/fs-promises.ts:190`. The ledger keeps the shape verdict for the root decision
   (`roots[0].role = null`) and still lists the operation, so both readings stay visible instead of merged.
8. **`classf` is not one node's closure.** `packages/nodes/classf/src/core.ts:2-5` and `platform.ts:3-8` import the cores
   *and the platform factories* of `crashu`, `migratef`, `samea` and `repacku` (`runCrashu`, `createNodeCrashuRuntime`,
   `runMigratef`, `createNodeMigratefRuntime`, `runSamea`, `createNodeSameaRuntime`), so `classf.core.js` is 218 KB and
   `classf.platform.js` bundles four other nodes **through their `dist/` output**
   (`packages/nodes/crashu/dist/platform.js` and siblings appear in the metafile). Consequences: `classf` cannot be cut
   over before those four, and its bundle is stale by construction unless `dist` is rebuilt (the `XIRANITE_NODE_SOURCE`
   rule in AGENTS.md). `docs/migration/node-native-shape.json` scores `classf` as `fileIo: singleDirList` from its own
   `platform.ts` alone, which understates it.
9. **`clock.now` is answered but unreachable.** `crates/xiranite-quickjs-executor/src/host_calls.rs` answers `clock.now`
   (`HostOperation::ClockNow`) and `crates/xiranite-quickjs-executor/src/shims.rs:103` exposes `__xrh.now()`, but
   `crates/xiranite-quickjs-executor/src/lib.rs:33-35` asserts *no wall clock inside the sandbox* while nothing rewrites
   the realm's `Date`. **28 of the 41** closures call `new Date()`, `Date.now()` or `toISOString()` directly, and only members that
   go through `packages/quickjs-shims/src/ops.ts` reach the host. Until the realm `Date` is routed, ADR-0074 §2's *one
   clock, one spelling* guarantee is unenforced for every node that writes a timestamp into a journal (`crashu`,
   `envuconfig`, `timeu`, `synct`, `bitv`, `jellypot`, `repacku`, …). Each record carries this as a `missing` entry with
   `gap: "realm Date routing"` rather than as an absent operation.
10. **The executor overtook the shim.** `HostOperation::ALL` in `crates/xiranite-quickjs-executor/src/host_calls.rs` now
    answers **29** operations. The shim layer still pins **12**: `packages/quickjs-shims/src/host.ts:60-73` names them
    `OPERATIONS_V1`, and `host.ts:78-90` still lists `fs.readBytes`, `fs.writeBytes`, `fs.appendText`, `fs.copy`,
    `fs.mkdtemp`, `fs.link`/`fs.symlink`/`fs.readlink`, `fs.realpath`, `fs.utimes`, `crypto.digest`, `proc.spawn` as
    `OPERATIONS_V2_REQUESTED` — i.e. *requested*, when the Rust side has already answered every one of them
    (`surface.ts:66-207` wires only the twelve). `surface.ts:30` then requires each module's `hostOperations` to be a
    **subset of `OPERATIONS_V1`**, with the comment *the audit fails on anything else*, and `host.ts:212` builds its
    refusal text from the same twelve-name list. So no shim member can be wired to `fs.copy`, `fs.utimes`,
    `crypto.digest` or `os.homedir` until that rename happens — and 18 nodes are waiting on exactly that. Treat §3.1 as
    the queue and §3.2 as the host backlog; do not re-implement an operation from §3.1 in Rust.

## 10. Per-node rows

Evidence lines, per-member provenance, roots, processes, budgets and test files are in the matching record of
`docs/migration/node-quickjs-workorders.json`. `W` is `migrationWaveOrder`; `own gaps` are
`hostOperationsRequired.missingFromNodeOwnCode`, split by which §3 table they fall in.

| id | diff | W | blocker | core B | platform B | wired ops | own gaps needing shim only | own gaps needing host work | unmapped builtins | fidelity tests | maxLiveBytes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `audiov` | trivial | 1 | none | 4,479 | 43,524 | 2 | — | — | — | 1/2 core-clean | — |
| `mvz` | trivial | 1 | none | 9,324 | 53,582 | 3 | — | — | — | 1/4 core-clean | — |
| `soundw` | trivial | 1 | none | 2,643 | 32,932 | 2 | — | — | — | 2/5 core-clean | 4194304 |
| `classq` | normal | 2 | none | 7,224 | 37,958 | 4 | fs.copy | — | — | 1/2 core-clean | 16777216 |
| `encodeb` | normal | 2 | none | 5,509 | 748,246 | 5 | fs.copy | — | stream, string_decoder | 2/5 core-clean | — |
| `kavvka` | normal | 2 | none | 11,586 | 44,274 | 6 | fs.copy | — | — | 1/4 | — |
| `migratef` | normal | 2 | none | 12,870 | 272,393 | 8 | fs.copy | — | assert, constants, events, stream, worker_threads | 2/5 core-clean | — |
| `nameu` | normal | 2 | none | 10,597 | 37,261 | 3 | fs.utimes | — | — | 1/3 core-clean | 33554432 |
| `snf` | normal | 2 | none | 7,066 | 37,087 | 3 | fs.utimes | — | — | 1/3 core-clean | 16777216 |
| `synct` | normal | 2 | none | 9,559 | 37,966 | 4 | fs.utimes | — | — | 1/3 core-clean | — |
| `linku` | normal | 2 | none | 12,066 | 304,796 | 7 | fs.copy, fs.symlink | — | assert, constants, events, stream, worker_threads | 2/5 core-clean | — |
| `transq` | normal | 2 | none | 5,981 | 43,664 | 6 | fs.Dirent (member absent from the shim module), fs.copy | — | — | 1/2 core-clean | 4194304 |
| `formatv` | normal | 3 | none | 9,630 | 46,467 | 6 | — | locale.compare | — | 1/4 core-clean | — |
| `linedup` | normal | 3 | none | 3,111 | 27,328 | 1 | — | locale.compare | — | 1/4 core-clean | 16777216 |
| `crashu` | normal | 3 | none | 13,406 | 47,100 | 7 | fs.copy | locale.compare | — | 1/4 core-clean | — |
| `dissolvef` | normal | 3 | none | 28,052 | 272,335 | 8 | fs.copy | locale.compare | assert, constants, events, stream, worker_threads | 1/4 | — |
| `movea` | normal | 3 | none | 8,960 | 42,354 | 6 | fs.copy | locale.compare | — | 1/4 core-clean | — |
| `samea` | normal | 3 | none | 11,372 | 37,736 | 4 | — | locale.compare, locale.lowerUpperFormat | — | 1/3 core-clean | 16777216 |
| `seriex` | normal | 3 | none | 18,295 | 44,535 | 7 | fs.copy | locale.compare | — | 1/4 core-clean | — |
| `timeu` | normal | 3 | none | 7,612 | 41,789 | 5 | fs.utimes | locale.compare | — | 2/5 core-clean | 16777216 |
| `trename` | normal | 3 | none | 26,571 | 273,787 | 9 | fs.copy | locale.compare | assert, constants, events, stream, worker_threads | 1/4 core-clean | — |
| `repacku` | normal | 3 | none | 25,530 | 62,547 | 8 | fs.mkdtemp | locale.compare | — | 1/4 core-clean | — |
| `envuconfig` | heavy | 3 | none | 7,366 | 40,647 | 4 | fs.appendText, fs.copy | locale.compare | — | 1/3 core-clean | — |
| `rawfilter` | heavy | 3 | none | 12,803 | 48,176 | 7 | fs.copy, fs.symlink | locale.compare | — | 1/4 core-clean | — |
| `bitv` | heavy | 3 | none | 18,443 | 59,139 | 7 | fs.copy, fs.link | locale.compare | — | 3/6 core-clean | — |
| `gifu` | heavy | 3 | none | 24,212 | 67,311 | 7 | child_process.ChildProcess (member absent from the shim module), fs.appendText, fs.copy, fs.mkdtemp | locale.compare | — | 4/7 core-clean | — |
| `sleept` | normal | 4 | none | 9,970 | 33,006 | 1 | os.cpus | timer.after | — | 3/6 core-clean | — |
| `coveru` | heavy | 4 | none | 9,109 | 286,326 | 4 | fs.copy | fs.open/readRange/closeHandle host-handle operations, locale.compare | — | 2/3 core-clean | — |
| `lorat` | heavy | 4 | none | 16,303 | 57,658 | 7 | crypto.digest, fs.copy | fs.open/readRange/closeHandle host-handle operations, locale.compare | — | 1/3 core-clean | — |
| `cleanf` | heavy | 5 | os-native:recycleBin | 8,979 | 675,671 | 9 | — | — | module | 3/6 core-clean | — |
| `logx` | heavy | 5 | none | 527,107 | 0 | 8 | — | locale.compare | — | 1/2 core-clean | 67108864 |
| `marku` | heavy | 5 | none | 344,984 | 271,699 | 6 | — | locale.compare | assert, constants, events, stream, worker_threads | 3/6 core-clean | — |
| `bandia` | heavy | 5 | os-native:recycleBin | 16,757 | 628,258 | 9 | proc.spawn | — | module | 2/5 core-clean | — |
| `jellypot` | heavy | 5 | os-native:registry | 9,179 | 42,598 | 4 | fs.appendText | — | — | 2/3 core-clean | — |
| `recycleu` | heavy | 5 | os-native:recycleBin | 4,235 | 30,355 | 1 | — | timer.after | — | 2/5 core-clean | — |
| `classf` | heavy | 5 | os-native:clipboard | 217,943 | 313,550 | 8 | — | locale.lowerUpperFormat | assert, constants, events, stream, worker_threads | 5/7 core-clean | — |
| `enginev` | heavy | 5 | os-native:recycleBin | 18,540 | 627,283 | 9 | fs.copy | locale.compare | module | 2/5 core-clean | — |
| `smartzip` | heavy | 5 | os-native:recycleBin | 12,992 | 650,603 | 9 | fs.appendText, fs.mkdtemp | fs.open/readRange/closeHandle host-handle operations | module | 3/5 core-clean | — |
| `comfygure` | heavy | 5 | network | 1,135,075 | 1,129,331 | 7 | crypto.digest | locale.compare, locale.lowerUpperFormat, net.fetch, timer.after | assert, constants, events, module, stream, vm, worker_threads, zlib | 3/3 core-clean | — |
| `owithu` | blocked | 6 | native-addon | 0 | 0 | 0 | — | — | — | 1/4 core-clean | — |
| `findz` | blocked | 6 | go-worker | 6,355 | 16,700 | 0 | — | realm.importMetaUrl, threading.worker | — | 3/3 core-clean | — |

Bundle totals over these 41 rows: 2,651,795 core bytes and 7,567,972 platform
bytes. The manifest's `counts` block says 3,012,226 / 9,324,446 for all 44 records, and `owithu` contributes 0 to both
because neither face builds. ADR-0074 §6's *all 44 node cores together bundle to 2.8 MiB* is the same measurement at
2,873 KiB, so a host carrying every node pays about 2.8 MiB of script plus the 1.63 MiB engine
(`docs/migration/quickjs-substrate-evaluation.md:512-519`).

