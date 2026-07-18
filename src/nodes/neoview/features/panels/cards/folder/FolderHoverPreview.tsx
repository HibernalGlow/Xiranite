import { createPortal } from "react-dom"
import { useEffect, useRef, useState, type ReactNode } from "react"

const PREVIEW_WIDTH = 240
const PREVIEW_HEIGHT = 320
const PREVIEW_GAP = 8

export const FOLDER_HOVER_PREVIEW_DELAYS = [200, 500, 800, 1200] as const

type PreviewPosition = { left: number; top: number }

export function FolderHoverPreview({
  children,
  thumbnailUrl,
  enabled,
  delayMs,
  label,
}: {
  children: ReactNode
  thumbnailUrl?: string
  enabled: boolean
  delayMs: number
  label: string
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<PreviewPosition>()

  function cancel() {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = undefined
    setVisible(false)
    setPosition(undefined)
  }

  function reveal() {
    if (!enabled || !thumbnailUrl) return
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const left = rect.right + PREVIEW_GAP + PREVIEW_WIDTH <= window.innerWidth
      ? rect.right + PREVIEW_GAP
      : Math.max(PREVIEW_GAP, rect.left - PREVIEW_WIDTH - PREVIEW_GAP)
    const top = Math.min(
      Math.max(PREVIEW_GAP, rect.top),
      Math.max(PREVIEW_GAP, window.innerHeight - PREVIEW_HEIGHT - PREVIEW_GAP),
    )
    setPosition({ left, top })
    setVisible(true)
  }

  function schedule() {
    if (!enabled || !thumbnailUrl) return
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      reveal()
    }, Math.max(0, delayMs))
  }

  useEffect(() => {
    if (!enabled || !thumbnailUrl) cancel()
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    }
  }, [enabled, thumbnailUrl, delayMs])

  useEffect(() => {
    if (!visible) return
    const dismiss = () => cancel()
    window.addEventListener("scroll", dismiss, true)
    window.addEventListener("resize", dismiss)
    return () => {
      window.removeEventListener("scroll", dismiss, true)
      window.removeEventListener("resize", dismiss)
    }
  }, [visible])

  return (
    <span
      ref={anchorRef}
      className="contents"
      onMouseEnter={schedule}
      onMouseLeave={cancel}
      onFocus={schedule}
      onBlur={cancel}
      data-folder-hover-preview-anchor="true"
    >
      {children}
      {visible && position && thumbnailUrl && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              aria-label={`${label} preview`}
              data-folder-hover-preview="true"
              className="pointer-events-none fixed z-[100] overflow-hidden rounded-md border bg-background p-1 shadow-xl"
              style={{ left: position.left, top: position.top, width: PREVIEW_WIDTH, maxHeight: PREVIEW_HEIGHT }}
            >
              <img src={thumbnailUrl} alt={`${label} preview`} loading="eager" decoding="async" className="block max-h-[312px] w-full object-contain" />
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}
