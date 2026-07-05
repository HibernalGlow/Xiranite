/**
 * niko-table — created by Semir N. (Semkoo, https://github.com/Semkoo) with AI assistance.
 *
 * Shared scroll-listener factory used by every body.
 * Copied from upstream src/components/niko-table/lib/create-scroll-handler.ts
 *
 * Note: ScrollEvent type is defined locally here (upstream imports it from
 * data-table-virtualized-structure, which we haven't installed) — semantically
 * identical to the upstream type.
 */

export interface ScrollEvent {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  isTop: boolean
  isBottom: boolean
  percentage: number
}

export function createScrollHandler({
  onScroll,
  onScrolledTop,
  onScrolledBottom,
  scrollThreshold = 50,
}: {
  onScroll?: (event: ScrollEvent) => void
  onScrolledTop?: () => void
  onScrolledBottom?: () => void
  scrollThreshold?: number
}): (event: Event) => void {
  let prevAtTop = false
  let prevAtBottom = false

  return (event: Event) => {
    const element = event.currentTarget as HTMLDivElement | null
    if (!element) return

    const { scrollHeight, scrollTop, clientHeight } = element

    const isTop = scrollTop === 0
    const isBottom = scrollHeight - scrollTop - clientHeight < scrollThreshold
    const percentage =
      scrollHeight - clientHeight > 0
        ? (scrollTop / (scrollHeight - clientHeight)) * 100
        : 0

    onScroll?.({
      scrollTop,
      scrollHeight,
      clientHeight,
      isTop,
      isBottom,
      percentage,
    })

    if (isTop && !prevAtTop) onScrolledTop?.()
    if (isBottom && !prevAtBottom) onScrolledBottom?.()

    prevAtTop = isTop
    prevAtBottom = isBottom
  }
}
