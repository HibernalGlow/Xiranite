import { useEffect, useRef, type RefObject } from "react"
import type { VirtuosoGridHandle, VirtuosoHandle } from "react-virtuoso"

import { viewUsesFixedGrid, viewUsesMosaicGrid, viewUsesVirtuosoList } from "./DirectoryCatalog"
import type { SavedDirectoryState } from "./FolderBrowserState"

export function useFolderViewportRestorer({
  viewMode,
  listRef,
  listScrollerRef,
  gridRef,
  mosaicRef,
  listHostRef,
}: {
  viewMode: SavedDirectoryState["viewMode"]
  listRef: RefObject<VirtuosoHandle | null>
  listScrollerRef: RefObject<HTMLElement | null>
  gridRef: RefObject<VirtuosoGridHandle | null>
  mosaicRef: RefObject<VirtuosoHandle | null>
  listHostRef: RefObject<HTMLDivElement | null>
}) {
  const restoreFramesRef = useRef<readonly number[]>([])

  useEffect(() => () => {
    for (const frame of restoreFramesRef.current) cancelAnimationFrame(frame)
  }, [])

  return (state: SavedDirectoryState | undefined): void => {
    const scrollTop = listScrollerRef.current?.scrollTop ?? savedScrollTop(state, viewMode)
    if (scrollTop === undefined) return
    for (const frame of restoreFramesRef.current) cancelAnimationFrame(frame)
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (viewUsesVirtuosoList(viewMode)) listRef.current?.scrollTo({ top: scrollTop })
        else if (viewUsesFixedGrid(viewMode)) gridRef.current?.scrollTo({ top: scrollTop })
        else if (viewUsesMosaicGrid(viewMode)) mosaicRef.current?.scrollTo({ top: scrollTop })
        else listHostRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]')?.scrollTo({ top: scrollTop })
        restoreFramesRef.current = []
      })
      restoreFramesRef.current = [secondFrame]
    })
    restoreFramesRef.current = [firstFrame]
  }
}

function savedScrollTop(state: SavedDirectoryState | undefined, viewMode: SavedDirectoryState["viewMode"]): number | undefined {
  if (!state || state.viewMode !== viewMode) return undefined
  if (viewUsesVirtuosoList(viewMode)) return state.listSnapshot?.scrollTop
  if (viewUsesFixedGrid(viewMode)) return state.gridSnapshot?.scrollTop ?? state.gridScrollTop
  if (viewUsesMosaicGrid(viewMode)) return state.mosaicSnapshot?.scrollTop ?? state.mosaicScrollTop
  return state.detailsScrollTop
}
