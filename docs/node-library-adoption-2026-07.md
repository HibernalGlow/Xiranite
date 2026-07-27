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
| Czkawka Simiu mode | `sharp` + `sharp-phash` | feature weighting, clustering, directory policy, operations, and undo |

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
`sharp-phash` is MIT, has a narrow 64-bit pHash API, and declares `sharp` as
a peer dependency. It is used only at the Czkawka node's Node runtime boundary
to calculate Simiu's pHash feature; it does not change the existing Czkawka
native scanner or its upgrade path.

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
operation planning, and undo records. Its detector is deliberately independent
of `CzkawkaRuntime.scanMedia`: upstream Czkawka exposes Mean/Gradient-family
hashes and a maximum-distance option, while the source algorithm has a
different, weighted score.

The Czkawka node exposes an internal `SimiuFeatureExtractor` boundary. Its
Node adapter decodes each supported image through `sharp`, derives the 64-bit
pHash through `sharp-phash`, and returns width, height, RGB mean from a 32x32
thumbnail, and filesystem byte length. A pure Simiu scorer then preserves the
source score equation: `0.68` normalized pHash distance, `0.14` capped aspect
ratio distance, `0.10` normalized RGB distance, and `0.08` file-size distance.
It applies the source's `0.20` aspect-ratio pruning and union-find clustering
before the existing set planner receives groups. The pHash implementation is
validated at the grouping level rather than claimed as a byte-for-byte OpenCV
hash replacement.

This keeps Czkawka as the user-facing workbench and file-operation host, while
making the detector an explicit adapter that neither depends on Czkawka's
native result DTO nor leaks its image-hash controls into Simiu. A future
Czkawka upgrade can therefore retain this mode unchanged unless its host or
operation contracts change.

## Validation

- Focused node unit tests cover all changed pure contracts.
- Encodeb's platform test proves a high-confidence `chardet` Big5 candidate
  is still subject to the lossless recoding gate, while clean names bypass the
  detector entirely.
- Marku's AST tests prove headings and images in fenced code remain untouched,
  while the corresponding parsed Markdown nodes still transform as requested.
- Simiu fixture tests prove the four weighted feature terms, ratio pruning,
  transitive union-find grouping, all-in-one-folder skip, and operation/undo
  behavior. They also prove that changing Czkawka's native image settings does
  not change Simiu groups.
- Czkawka's added mode is exercised through its existing package tests and a
  targeted Browser Mode component test for the user-visible mode and controls.
- Package builds and Browser Mode run serially with one worker.
- The final source-size and node-architecture checks cover the changed files.
