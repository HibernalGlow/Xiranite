import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"
import { Grip } from "lucide-react"
import type { MelodeckFloatingSize } from "./config"
import { clampMelodeckFloatingSizeToViewport } from "./floatingPanelGeometry"

interface ResizeSession {
  pointerId: number
  startX: number
  startY: number
  size: MelodeckFloatingSize
}

interface MelodeckFloatingResizeHandleProps {
  size: MelodeckFloatingSize
  onPreview(size: MelodeckFloatingSize): void
  onCommit(size: MelodeckFloatingSize): void
}

export function MelodeckFloatingResizeHandle({ size, onPreview, onCommit }: MelodeckFloatingResizeHandleProps) {
  const sessionRef = useRef<ResizeSession | null>(null)
  const latestSizeRef = useRef(size)
  const onPreviewRef = useRef(onPreview)
  const onCommitRef = useRef(onCommit)
  latestSizeRef.current = size
  onPreviewRef.current = onPreview
  onCommitRef.current = onCommit

  useEffect(() => () => finishResize(false), [])

  function finishResize(commit = true) {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    window.removeEventListener("pointermove", handlePointerMove, true)
    window.removeEventListener("pointerup", handlePointerUp, true)
    window.removeEventListener("pointercancel", handlePointerCancel, true)
    if (commit) onCommitRef.current(latestSizeRef.current)
    else onPreviewRef.current(session.size)
  }

  function handlePointerMove(event: PointerEvent) {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const nextSize = clampMelodeckFloatingSizeToViewport({
      width: session.size.width + event.clientX - session.startX,
      height: session.size.height + event.clientY - session.startY,
    })
    latestSizeRef.current = nextSize
    onPreviewRef.current(nextSize)
  }

  function handlePointerUp(event: PointerEvent) {
    if (sessionRef.current?.pointerId === event.pointerId) finishResize()
  }

  function handlePointerCancel(event: PointerEvent) {
    if (sessionRef.current?.pointerId === event.pointerId) finishResize(false)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    finishResize(false)
    latestSizeRef.current = size
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      size,
    }
    window.addEventListener("pointermove", handlePointerMove, true)
    window.addEventListener("pointerup", handlePointerUp, true)
    window.addEventListener("pointercancel", handlePointerCancel, true)
  }

  return (
    <button
      type="button"
      data-melodeck-part="floating-resize-handle"
      aria-label="调整浮动播放器大小"
      title="调整浮动播放器大小"
      className="absolute bottom-0 right-0 z-[110] grid size-7 touch-none place-items-center rounded-tl-md text-muted-foreground/65 opacity-70 transition-opacity hover:bg-background/65 hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
      onPointerDown={handlePointerDown}
    >
      <Grip className="size-3.5 rotate-[-45deg]" />
    </button>
  )
}
