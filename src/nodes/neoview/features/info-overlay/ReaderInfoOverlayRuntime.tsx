import { Film, Image as ImageIcon } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react"

import type { ReaderSessionDto } from "../../adapters/reader-http-client"
import type { ReaderInfoOverlayPort } from "./ReaderInfoOverlayStore"

export function ReaderInfoOverlayRuntime({ port, session, sourcePath }: {
  port: ReaderInfoOverlayPort
  session?: ReaderSessionDto
  sourcePath: string
}) {
  const settings = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number }>()
  const page = session?.visiblePages[0]

  useEffect(() => {
    if (!session) setOffset({ x: 0, y: 0 })
  }, [session?.sessionId])

  if (!settings?.enabled || !session || !page) return null

  const isVideo = page.mediaKind === "video" || page.mimeType?.startsWith("video/")
  const width = settings.width ? `${settings.width}px` : undefined
  const height = settings.height ? `${settings.height}px` : undefined

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset({ x: drag.offsetX + event.clientX - drag.startX, y: drag.offsetY + event.clientY - drag.startY })
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-4 z-[75] flex justify-center"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      data-reader-info-overlay-layer="true"
    >
      <div
        className={`pointer-events-auto max-w-[70vw] rounded-md bg-background/95 text-xs shadow-lg ${settings.showBorder ? "border border-border/60" : ""}`}
        style={{ opacity: settings.opacity, width, height }}
        data-reader-info-overlay="true"
      >
        <div
          className="flex min-h-8 cursor-move select-none flex-col justify-center gap-0.5 overflow-hidden px-3 py-2"
          role="button"
          tabIndex={0}
          aria-label="拖动以移动信息条"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="flex min-w-0 items-center gap-2">
            {isVideo ? <Film className="size-3.5 shrink-0" aria-hidden="true" /> : <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />}
            <span className="max-w-[32vw] truncate font-mono text-[11px] font-semibold" title={page.name}>{page.name}</span>
            {page.dimensions ? <span className="shrink-0 text-[11px] text-muted-foreground">{page.dimensions.width}×{page.dimensions.height}</span> : null}
          </div>
          <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            <span>{sourcePath}</span>
            {page.byteLength !== undefined ? <span>{formatBytes(page.byteLength)}</span> : null}
            <span>第 {page.index + 1} / {session.book.pageCount} 页</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KiB`
  return `${(value / 1_024 ** 2).toFixed(1)} MiB`
}
