import { createPortal } from "react-dom"
import { useEffect, useRef, useState, type ReactNode } from "react"

const PREVIEW_MAX_WIDTH = 240
const PREVIEW_MAX_HEIGHT = 320
const PREVIEW_MIN_WIDTH = 160
const PREVIEW_MIN_HEIGHT = 160
const PREVIEW_GAP = 8

export const FOLDER_HOVER_PREVIEW_DELAYS = [200, 500, 800, 1200] as const

type PreviewPosition = { left: number; top: number; width: number; height: number }

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
    const width = Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, window.innerWidth - PREVIEW_GAP * 2))
    const height = Math.min(PREVIEW_MAX_HEIGHT, Math.max(PREVIEW_MIN_HEIGHT, Math.floor(window.innerHeight * 0.65)))
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const candidates = [
      { left: rect.right + PREVIEW_GAP, top: centerY - height / 2 },
      { left: rect.left - width - PREVIEW_GAP, top: centerY - height / 2 },
      { left: centerX - width / 2, top: rect.bottom + PREVIEW_GAP },
      { left: centerX - width / 2, top: rect.top - height - PREVIEW_GAP },
    ]
    const fits = candidates.find((candidate) => (
      candidate.left >= PREVIEW_GAP
      && candidate.top >= PREVIEW_GAP
      && candidate.left + width <= window.innerWidth - PREVIEW_GAP
      && candidate.top + height <= window.innerHeight - PREVIEW_GAP
    ))
    const candidate = fits ?? candidates
      .map((value) => ({
        ...value,
        overflow: Math.max(0, PREVIEW_GAP - value.left)
          + Math.max(0, PREVIEW_GAP - value.top)
          + Math.max(0, value.left + width - window.innerWidth + PREVIEW_GAP)
          + Math.max(0, value.top + height - window.innerHeight + PREVIEW_GAP),
      }))
      .toSorted((left, right) => left.overflow - right.overflow)[0]!
    setPosition({
      left: Math.min(Math.max(PREVIEW_GAP, candidate.left), Math.max(PREVIEW_GAP, window.innerWidth - width - PREVIEW_GAP)),
      top: Math.min(Math.max(PREVIEW_GAP, candidate.top), Math.max(PREVIEW_GAP, window.innerHeight - height - PREVIEW_GAP)),
      width,
      height,
    })
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
              style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }}
            >
              <img src={thumbnailUrl} alt={`${label} preview`} loading="eager" decoding="async" className="block w-full object-contain" style={{ maxHeight: position.height - 8 }} />
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}
