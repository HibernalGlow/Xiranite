---
status: accepted
---

# Drop nodes already covered by standalone projects and keep no migration middleware

## Context

Xiranite's node list grew by porting whatever the surrounding standalone tools did. Several of those
tools now have their own maintained repositories under `HibernalGlow`, verified present on
2026-10-04 with `git ls-remote --heads`:

| Node | Standalone project | Branches | Ruling |
|---|---|---|---|
| `arcthumb` | ArcThumbX | 1 | removed from the rewrite list |
| `czkawka` | czkawka-tauri | 5 | removed from the rewrite list |
| `xlchemy` | Xlchemy | 4 | removed from the rewrite list |
| `enginev` | EngineV | 1 | **kept** — stays in the list and is rewritten in Rust |
| `trename` | trename | 1 | **kept** — stays in the list and is rewritten in Rust |
| `neoview` | neoview | 92 | **ruled out 2026-10-04** — the reader belongs to its own repository |

Two rulings recorded here on 2026-10-04, superseding the earlier open questions:

- `enginev` and `trename` stay in the rewrite list despite having same-named repositories; the user
  keeps them and wants them rewritten in Rust like any other retained node.
- `neoview` is out. The reader lives in the standalone `neoview` repository, and the Neoxide /
  mImageViewer egui interface work is not this project at all, so every `AGENTS.md` rule that had
  protected the NeoView card-by-card migration inside Xiranite was removed alongside this decision.

The governing rule for the rewrite (ADR-0063) is: a capability already covered by a more specialized
standalone project is not re-implemented, and the rewrite is thorough — no compatibility window, no
deprecated-but-kept code, no middleware left behind to make the old tree and the new one coexist.

Separately, three nodes were already inert: `gitalso`, `scoolp` and `vert` sat in
`xiranite.build.toml` as `disabled`, so they produced nothing in the shipped application. Keeping a
node in a disabled list is not a state anyone maintains; per the same rule they were deleted outright
rather than re-decided later.

## Decision

`docs/xiranite-target-node-manifest.json` is the single source of truth for which nodes exist after
the rewrite, and `bun run audit:target-node-manifest` fails when the manifest, `xiranite.build.toml`
and the node directories disagree.

Dispositions recorded there:

- `arcthumb`, `czkawka`, `xlchemy` → `drop-to-standalone`. They are not rewritten, get no Extism
  plugin, and their trees, UI, node-specific scripts, i18n catalogs and migration snapshots are
  removed rather than carried.
- `gitalso`, `scoolp`, `vert` → deleted from the repository now. `xiranite.build.toml` shrank to
  `disabled = ["clipm", "lata"]`, `packages/nodes/*` and `src/nodes/*` for the three ids are gone,
  along with their workspace dependencies, `cliNameOverrides` entry, dry-run id set entries, QA
  reference aliases, real-click e2e case and marker, i18n module blocks and TUI review docs.
  `envuconfig`'s default include list dropped the now-meaningless `src/scoolp/*.toml` pattern, and
  `docs/aestivus.md` records `scoolp` under pruned nodes.
- `clipm`, `lata` → `hold-unmigrated`. Shelved by explicit instruction, neither rewritten nor deleted
  in this round. They must stay listed in `xiranite.build.toml`, because
  `scripts/generate-node-registries.ts:78-80` throws `Unknown node id in build filter` for a
  disabled id with no directory, and `scripts/build-packages-lazy.ts:307-316` would then demand a
  build script for a node that is not there.
- `enginev`, `trename` → kept in the rewrite list and rewritten in Rust like any other retained node.
  A standalone sibling project is a reason not to *duplicate* a node in the product; it is not a
  reason to delete a node the user still uses.

Native cores are not nodes. Two of them are load-bearing for surviving code, so `drop-to-standalone`
applies to the node surface only and the capability moves into `xiranite-core` as a host service
(ADR-0063 principle 8):

- `@xiranite/arcthumb-core` / `@xiranite/arcthumb-native` — system and archive thumbnails, required by
  `packages/nodes/neoview/package.json:54`,
  `packages/nodes/neoview/src/platform/windows/WindowsSystemThumbnailProvider.ts:94`,
  `packages/nodes/neoview/src/platform/images/WindowsWicImageTransformer.ts` and
  `src/nodes/neoview/entry.ts:17` (`nativeProbe`).
- `@xiranite/czkawka-core` / `@xiranite/czkawka-native` — the recycle-bin service
  (`getTrashCapabilities`, `listTrashItems`, `restoreTrashItem`, `trashPath`) used by
  `packages/file-operations/src/platform.ts:3-11` and therefore by cleanf, bandia, smartzip, enginev,
  `packages/repository`, `packages/backend` and `packages/api`; `scripts/lib/node-app-packager.ts:160`
  also injects it into every packaged node app.

Deleting a node's UI, CLI and TUI while quietly losing trash or thumbnail behavior would be a
capability regression, not a cleanup, so the two services are restated in the manifest as host
services with these consumers as evidence.

## Alternatives considered

### Keep the three inert nodes disabled

Rejected. `disabled → disabled → disabled` is the state the rewrite is explicitly meant to end; a
disabled node still costs a package entry, a workspace dependency, i18n keys, QA aliases and an e2e
case that nobody runs.

### Delete the arcthumb and czkawka native crates along with the nodes

Rejected on measured grounds (the consumer list above). It would break NeoView thumbnails and every
delete-to-recycle path, and AGENTS.md forbids degrading the retained media core.

### Retire enginev and trename because standalone repos exist

Rejected by the user on 2026-10-04: they stay in the list and are rewritten in Rust. Recorded here so
the next reader does not re-litigate it from the repo names alone.

### Leave the deleted nodes' docs as history

Partially rejected. Docs that gate builds must go with their node — `scripts/audit-node-tuis.ts:41-42`
demands `docs/<id>-tui-visual-review.md` for any node directory still present, so a doc deleted first
fails the audit and a doc kept after the directory is gone is dead weight. Planning docs that record
past decisions (`docs/modernization-strategy.md`, `docs/cli-modernization-plan.md`, ADRs) are left
alone; they are dated records, not product surface.

## Consequences

Manifest drift between the JSON, `xiranite.build.toml` and the directories becomes a build-time
failure instead of something discovered during a rewrite. Removals must be atomic: deleting a node
directory without its `package.json` workspace entry breaks `bun install` for the entire tree, and
generated registries must be regenerated in the same commit for any node that was enabled.

Node id strings survive in prose that legitimately refers to the external tools — for example
`packages/nodes/kavvka/src/index.ts:11` keywords and its copy still name "czkawka", now honestly
meaning `czkawka-tauri`. Residue checks therefore walk import specifiers and member expressions via
the AST (ADR-0067) instead of grepping for node names, which both false-positives on words like
`vert-gradient` and misses real coupling such as `scripts/benchmark-runtime-contention.ts:10`, where
an xlchemy core import lives outside every `tsconfig` include set.

The `arcthumb`, `czkawka` and `xlchemy` trees are deleted on branch `xiranite-rust-rewrite`, together with
their workspace dependency declarations, generated registry entries (regenerated by
`scripts/generate-node-registries.ts`, not hand-edited), i18n catalogs, node-private scripts, stylesheets
and the xlchemy per-node memory-protection preset. `docs/xiranite-target-node-manifest.json` records all
three as `removed`, and the manifest gate reports zero blocking seams for each. Two follow-ups remain by
construction rather than oversight: `bun.lock` must be refreshed by a real `bun install` before CI's
`--frozen-lockfile` step can pass, and the settings/type surfaces that were edited alongside the preset
removal still need a `typecheck:app` plus Vitest run in a free build slot.
