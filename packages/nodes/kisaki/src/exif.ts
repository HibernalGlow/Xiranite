import type { CzkawkaEntry, CzkawkaExifItem } from "./core.js"

/** Builds the selected, scan-derived EXIF cleanup input without touching files. */
export function createExifCleanupPlan(entries: readonly CzkawkaEntry[], selectedPaths: Iterable<string>): CzkawkaExifItem[] {
  const selected = new Set(selectedPaths)
  const items = new Map<string, CzkawkaExifItem>()
  for (const entry of entries) {
    if (!selected.has(entry.path) || !entry.exifTags?.length) continue
    items.set(entry.path, {
      path: entry.path,
      tags: entry.exifTags.map((tag) => ({ ...tag })),
    })
  }
  return [...items.values()]
}
