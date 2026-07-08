/**
 * LaneResizer — 泳道右侧拖拽手柄，调整泳道宽度比例。
 *
 * 从 Xlchemy LaneResizer.svelte 移植为 React。
 * 用 PointerEvent + setPointerCapture 实现，拖拽时实时调用 onResize(deltaPx)。
 */
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface Props {
  onResize?: (deltaRatio: number) => void
  onResizeEnd?: () => void
  className?: string
}

export function LaneResizer({ onResize, onResizeEnd, className }: Props) {
  const { t } = useTranslation()
  const startXRef = useRef(0)
  const pointerIdRef = useRef<number | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX
    pointerIdRef.current = e.pointerId
    try {
      btnRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (pointerIdRef.current !== moveEvent.pointerId) return
      const delta = moveEvent.clientX - startXRef.current
      startXRef.current = moveEvent.clientX
      // 把 px 转成 ratio 增量（16px ≈ 0.1 ratio）
      onResize?.(delta / 160)
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (pointerIdRef.current !== upEvent.pointerId) return
      pointerIdRef.current = null
      try {
        btnRef.current?.releasePointerCapture(upEvent.pointerId)
      } catch {
        // The pointer may already be released by the browser.
      }
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
      onResizeEnd?.()
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={t("common:resizeLane")}
      onPointerDown={handlePointerDown}
      className={cn(
        "lane-resizer w-1 cursor-ew-resize bg-transparent hover:bg-primary/40 transition-colors flex-shrink-0",
        className,
      )}
    />
  )
}
