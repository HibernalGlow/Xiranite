import type { CzkawkaEntry, CzkawkaVideoOptimizerItem, CzkawkaVideoOptimizerMode } from "./core.js"

/** Builds an operation plan only from selected entries produced by the optimizer scan. */
export function createVideoOptimizationPlan(entries: readonly CzkawkaEntry[], selectedPaths: Iterable<string>, mode: CzkawkaVideoOptimizerMode): CzkawkaVideoOptimizerItem[] {
  const selected = new Set(selectedPaths)
  const items = new Map<string, CzkawkaVideoOptimizerItem>()
  for (const entry of entries) {
    if (!selected.has(entry.path) || !entry.codec) continue
    const cropRect = entry.videoCropRect
    if (mode === "crop" && !cropRect) continue
    items.set(entry.path, {
      path: entry.path,
      codec: entry.codec,
      ...(cropRect ? { cropRect: { ...cropRect } } : {}),
    })
  }
  return [...items.values()]
}
