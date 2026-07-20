# Folder delete mode prototype

Generated with `@xiranite/svelte-migrate` from legacy revision
`f4f8f02d88acdf4f639749f185c83abb91a1aa86`.

Reviewed source prototypes:

- `FolderListItem.tsx`: delete-mode conditionals, leading/corner placement, event propagation, and `Trash2` semantics.
- `FolderToolbar/ActionButtons.tsx`: left-click mode toggle and right-click `trash`/`permanent` strategy switch.
- `FolderContextMenu.tsx`: `Undo2` entry and `onUndoDelete` callback.

Known generator gaps are preserved in the generated headers. The production
React code does not import this directory.

Legacy 1920x1080 characterization was captured at
`output/playwright/neoview-legacy-folder-delete-mode-1920x1080.png`. The
web-only legacy shell remained in its loading state, so control geometry is
frozen by the reviewed AST prototypes rather than inferred from that image.
