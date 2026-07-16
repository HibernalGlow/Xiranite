import { PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react"
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ReaderFolderTreeLayout, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderTreePanel from "./FolderTreePanel"

const MIN_TREE_SIZE = 100
const MAX_TREE_SIZE = 500

interface FolderTreeWorkspaceProps {
  client: ReaderHttpClient
  sessionId: string
  currentPath: string
  disabled: boolean
  layout: ReaderFolderTreeLayout
  size: number
  pinnedPaths: readonly string[]
  onNavigate(path: string): void
  onLayoutChange(layout: ReaderFolderTreeLayout): void
  onSizeChange(size: number): void
  onPinnedPathsChange(paths: string[]): void
}

export default function FolderTreeWorkspace({
  client,
  sessionId,
  currentPath,
  disabled,
  layout,
  size,
  pinnedPaths,
  onNavigate,
  onLayoutChange,
  onSizeChange,
  onPinnedPathsChange,
}: FolderTreeWorkspaceProps) {
  const gestureRef = useRef<TreeResizeGesture | undefined>(undefined)

  return (
    <div
      className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded border bg-background/60"
      style={{ order: layout === "left" || layout === "top" ? 0 : 1 }}
      data-neoview-folder-tree-pane="true"
    >
      <ToggleGroup
        type="single"
        size="sm"
        value={layout}
        className="justify-start border-b px-1 py-0.5"
        aria-label="文件树位置"
        onValueChange={(value) => { if (value) onLayoutChange(value as ReaderFolderTreeLayout) }}
      >
        <ToggleGroupItem value="left" aria-label="文件树位于左侧" title="左侧"><PanelLeft /></ToggleGroupItem>
        <ToggleGroupItem value="right" aria-label="文件树位于右侧" title="右侧"><PanelRight /></ToggleGroupItem>
        <ToggleGroupItem value="top" aria-label="文件树位于顶部" title="顶部"><PanelTop /></ToggleGroupItem>
        <ToggleGroupItem value="bottom" aria-label="文件树位于底部" title="底部"><PanelBottom /></ToggleGroupItem>
      </ToggleGroup>
      <div className="min-h-0">
        <FolderTreePanel
          client={client}
          sessionId={sessionId}
          currentPath={currentPath}
          disabled={disabled}
          pinnedPaths={pinnedPaths}
          onNavigate={onNavigate}
          onPinnedPathsChange={onPinnedPathsChange}
        />
      </div>
      <button
        type="button"
        className={resizeHandleClass(layout)}
        role="separator"
        aria-label="调整文件树大小"
        aria-orientation={layout === "left" || layout === "right" ? "vertical" : "horizontal"}
        aria-valuemin={MIN_TREE_SIZE}
        aria-valuemax={MAX_TREE_SIZE}
        aria-valuenow={size}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
        onKeyDown={handleResizeKeyDown}
      />
    </div>
  )

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const pane = event.currentTarget.parentElement
    if (!pane) return
    const horizontal = layout === "left" || layout === "right"
    const renderedSize = horizontal ? pane.getBoundingClientRect().width : pane.getBoundingClientRect().height
    gestureRef.current = {
      pointerId: event.pointerId,
      layout,
      startPosition: horizontal ? event.clientX : event.clientY,
      startSize: renderedSize || size,
      latestSize: renderedSize || size,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic/test pointers are not registered as active by every WebView.
    }
    event.preventDefault()
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current
    const host = event.currentTarget.parentElement?.parentElement
    if (!gesture || gesture.pointerId !== event.pointerId || !host) return
    const horizontal = gesture.layout === "left" || gesture.layout === "right"
    const position = horizontal ? event.clientX : event.clientY
    const direction = gesture.layout === "right" || gesture.layout === "bottom" ? -1 : 1
    const available = horizontal ? host.clientWidth - MIN_TREE_SIZE : MAX_TREE_SIZE
    const maximum = Math.max(MIN_TREE_SIZE, Math.min(MAX_TREE_SIZE, available > 0 ? available : MAX_TREE_SIZE))
    gesture.latestSize = clamp(Math.round(gesture.startSize + direction * (position - gesture.startPosition)), MIN_TREE_SIZE, maximum)
    gesture.moved = true
    host.style.setProperty("--folder-tree-size", `${gesture.latestSize}px`)
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (gesture.moved) onSizeChange(gesture.latestSize)
  }

  function cancelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.parentElement?.parentElement?.style.setProperty("--folder-tree-size", `${size}px`)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    let next = size
    if (event.key === "Home") next = MIN_TREE_SIZE
    else if (event.key === "End") next = MAX_TREE_SIZE
    else if (event.key === "ArrowRight" && layout === "left") next += 10
    else if (event.key === "ArrowLeft" && layout === "left") next -= 10
    else if (event.key === "ArrowLeft" && layout === "right") next += 10
    else if (event.key === "ArrowRight" && layout === "right") next -= 10
    else if (event.key === "ArrowDown" && layout === "top") next += 10
    else if (event.key === "ArrowUp" && layout === "top") next -= 10
    else if (event.key === "ArrowUp" && layout === "bottom") next += 10
    else if (event.key === "ArrowDown" && layout === "bottom") next -= 10
    else return
    event.preventDefault()
    event.stopPropagation()
    next = clamp(next, MIN_TREE_SIZE, MAX_TREE_SIZE)
    if (next !== size) onSizeChange(next)
  }
}

interface TreeResizeGesture {
  pointerId: number
  layout: ReaderFolderTreeLayout
  startPosition: number
  startSize: number
  latestSize: number
  moved: boolean
}

function resizeHandleClass(layout: ReaderFolderTreeLayout): string {
  const base = "absolute z-10 touch-none bg-transparent transition-colors hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none"
  if (layout === "left") return `${base} inset-y-0 right-0 w-2 cursor-ew-resize`
  if (layout === "right") return `${base} inset-y-0 left-0 w-2 cursor-ew-resize`
  if (layout === "top") return `${base} inset-x-0 bottom-0 h-2 cursor-ns-resize`
  return `${base} inset-x-0 top-0 h-2 cursor-ns-resize`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
