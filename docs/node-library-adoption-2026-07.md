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

`@zip.js/zip.js` is already a maintained workspace dependency for NeoView and
is suitable for Coveru's ZIP listing and extraction. `chardet` is already
present in the lockfile and is used only to rank possible encodings; it does
not make an unsafe conversion authoritative. `remark` supplies an mdast parser
for structure-sensitive Markdown transforms without coupling the node's domain
contract to a UI framework. `registry-js` belongs behind the Windows adapter in
`@xiranite/shell-integration`; no shared domain contract may import it.

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
extension will own folder traversal, same-directory grouping, group-folder
naming, operation planning, and undo records. It will request image groups
through the stable `CzkawkaRuntime.scanMedia` contract with
`tool: "similar-images"` and `recursive: false` for each source directory.
The only native dependency is that established result DTO. A Czkawka upgrade
therefore changes the existing wrapper mapping in one place, rather than
requiring Simiu-specific Rust patches or a fork of Czkawka core.

The historical `phash_threshold` is mapped explicitly to Czkawka's maximum
hash-distance option and tested at the adapter boundary. The UI labels this as
the Simiu set threshold, while exposing the existing Czkawka image algorithm
controls without copying native option logic.

## Validation

- Focused node unit tests cover all changed pure contracts.
- Czkawka's added mode is exercised through its existing package tests and a
  targeted Browser Mode component test for the user-visible mode and controls.
- Package builds and Browser Mode run serially with one worker.
- The final source-size and node-architecture checks cover the changed files.
