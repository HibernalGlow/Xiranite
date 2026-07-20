export type ReaderLibraryViewMode = "compact" | "content" | "banner" | "thumbnail"

/** Minimum cell width before another column is added. */
const BANNER_MIN_CELL = 280
const THUMBNAIL_MIN_CELL = 132
const BANNER_CAPTION_RESERVE = 0
const THUMBNAIL_CAPTION_RESERVE = 36
const BANNER_ASPECT = 3 / 4 // media column prefers portrait comic covers
const THUMBNAIL_ASPECT = 3 / 4

export interface ReaderLibraryListLayout {
  itemSize: number
  columns: number
  gap: number
}

/**
 * Adaptive virtual-list geometry.
 * - compact / content stay fixed single-column row heights
 * - banner / thumbnail columns scale with the panel width
 * - row pitch grows with cell width so covers fill the panel instead of staying tiny
 */
export function readerLibraryListLayout(
  viewMode: ReaderLibraryViewMode,
  viewportWidth = 320,
): ReaderLibraryListLayout {
  const width = Math.max(0, Math.floor(viewportWidth))
  switch (viewMode) {
    case "compact":
      return { itemSize: 34, columns: 1, gap: 0 }
    case "content":
      return { itemSize: 76, columns: 1, gap: 0 }
    case "banner": {
      const gap = 8
      const columns = Math.max(1, Math.floor((width + gap) / (BANNER_MIN_CELL + gap)))
      const cellWidth = columns === 1 ? width : Math.floor((width - gap * (columns - 1)) / columns)
      // Banner media is ~42% of card width; height follows portrait cover ratio with a floor.
      const mediaWidth = Math.max(112, Math.round(cellWidth * 0.42))
      const surfaceHeight = Math.max(128, Math.round(mediaWidth / BANNER_ASPECT) + BANNER_CAPTION_RESERVE)
      return { itemSize: surfaceHeight + gap, columns, gap }
    }
    case "thumbnail": {
      const gap = 8
      const columns = Math.max(1, Math.floor((width + gap) / (THUMBNAIL_MIN_CELL + gap)))
      const cellWidth = columns === 1 ? width : Math.floor((width - gap * (columns - 1)) / columns)
      const surfaceHeight = Math.max(160, Math.round(cellWidth / THUMBNAIL_ASPECT) + THUMBNAIL_CAPTION_RESERVE)
      return { itemSize: surfaceHeight + gap, columns, gap }
    }
  }
}

export function readerLibraryMediaClassName(viewMode: ReaderLibraryViewMode): string | undefined {
  if (viewMode === "compact") return "size-7 rounded-sm"
  if (viewMode === "content") return "size-16"
  // Banner / thumbnail media fills the dedicated media cell; cover crops to the cell.
  return "size-full min-h-0 rounded-none"
}
