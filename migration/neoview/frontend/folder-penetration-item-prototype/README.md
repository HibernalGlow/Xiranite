# Folder penetration item prototype

Generated with `@xiranite/svelte-migrate` from legacy revision
`f4f8f02d88acdf4f639749f185c83abb91a1aa86`.

Reviewed source prototypes:

- `FileItemCard.tsx`: delayed direct-child lookup, archive filtering, extension removal, and `penetrateInfoList` derivation.
- `FileItemListView.tsx`: `Package` icon, wrapping original names, translated-title row, and dashed separators.
- `FileItemGridView.tsx`: confirms the legacy grid did not render `penetrateInfoList` as an item subtitle.

Production React code must not import this directory.
