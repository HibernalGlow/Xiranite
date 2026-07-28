# Node Library Adoption and Simiu Migration

Date: 2026-07-28

## Decision

Retire `lata` and `scoolp` from the default Xiranite build, development, UI,
and CLI registries. Keep their source directories temporarily so the removal is
reversible, but exclude both node ids everywhere the default registry or node
package build is assembled.

Remove the standalone `simiu` node after its verified behavior is available as
the `simiu-sets` mode of the Czkawka node.

The following dependency boundaries are adopted:

| Node | Dependency | Boundary retained by Xiranite |
| --- | --- | --- |
| Coveru | `@zip.js/zip.js` | cover selection, naming, output policy, and recursive discovery |
| Encodeb | `chardet` | mojibake safety checks, explicit codec transforms, rename/copy policy |
| Marku | `remark` | module choice, text transformations, diffs, history, and undo |
| Owithu | `registry-js` | shell-entry validation, plan creation, and per-item error reporting |
| Czkawka Simiu mode | Czkawka native Similar Images | directory policy, managed-set operations, and undo |

`@zip.js/zip.js` is already a maintained workspace dependency for NeoView and
is suitable for Coveru's ZIP listing and extraction. `chardet` is already
present in the lockfile and is used only to rank possible encodings; it does
not make an unsafe conversion authoritative. `remark` supplies an mdast parser
for structure-sensitive Markdown transforms without coupling the node's domain
contract to a UI framework. `registry-js` belongs behind the Windows adapter in
`@xiranite/shell-integration`; no shared domain contract may import it.
It provides the direct Win32 `createKey` and `setValue` calls used during
registration. Its API has no key-deletion operation, so unregister continues
to use the existing `reg.exe delete` adapter and retains its idempotent
"already absent" handling. The native addon is dynamically imported only by
the Windows adapter, keeping previews and non-Windows hosts outside that load
path.
The Simiu extension reuses Czkawka's existing native Similar Images binding;
it adds no second image decoder or hashing dependency.

`renamer` is intentionally not adopted. It is a batch-renaming CLI, whereas
Formatv requires deterministic per-file `.nov` plans, Nameu preserves archive
and timestamp policy, and Trename validates arbitrary JSON mappings, supports
cross-volume moves, and persists undo records. Spawning it would weaken those
contracts and duplicate the existing plan execution path rather than remove a
general-purpose implementation.

## Simiu Contract

The original source in `D:/1VSCODE/Projects/ImageAll/simiu` is the behavior
source, not the simplified standalone TypeScript node. Its contract is:

- scan each directory independently, optionally recursively;
- group visual variants using perceptual-image similarity;
- skip a directory when every image would land in one group;
- create deterministic managed-set directories;
- preview before move, copy, or hard-link application; and
- retain an undoable record of applied operations.

`simiu-sets` is an Xiranite extension mode, not an upstream Czkawka tool. The
extension owns folder traversal, same-directory grouping, group-folder naming,
operation planning, and undo records. Its detector is the existing
`CzkawkaRuntime.scanMedia` adapter configured for `similar-images`; it uses
Czkawka's native hash algorithm, maximum-difference threshold, hash size,
resize algorithm, and geometric-invariance settings. The legacy Simiu
weighted-score threshold is intentionally not converted, because it does not
share Czkawka's distance unit.

After one native scan across the eligible source directories, the extension
partitions each Czkawka result group by parent directory and applies the Simiu
directory policy: groups must meet the configured minimum size, and a
directory whose entire eligible image set forms one group is skipped. This
retains the workflow's managed-set and undo semantics without duplicating image
decoding or perceptual hashing in Node.

The boundary is a generic similarity-group planner in the Simiu module plus a
thin Czkawka result adapter in its runner. A future Czkawka upgrade therefore
needs only to preserve or update that adapter; the folder policy, operation
plan, and rollback contract remain independent.

## Validation

- Focused node unit tests cover all changed pure contracts.
- Encodeb's platform test proves a high-confidence `chardet` Big5 candidate
  is still subject to the lossless recoding gate, while clean names bypass the
  detector entirely.
- Marku's AST tests prove headings and images in fenced code remain untouched,
  while the corresponding parsed Markdown nodes still transform as requested.
- Simiu fixture tests prove that Czkawka similarity groups are partitioned by
  parent directory, enforce the all-in-one-folder skip, and retain
  operation/undo behavior. The Czkawka orchestration test proves its native
  scan receives the selected image-similarity settings without a second
  detector.
- Czkawka's added mode is exercised through its existing package tests and a
  targeted Browser Mode component test for the user-visible mode and controls.
- Package builds and Browser Mode run serially with one worker.
- The final source-size and node-architecture checks cover the changed files.
