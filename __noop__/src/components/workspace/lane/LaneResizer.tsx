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

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    startXRef.current = event.clientX
    pointerIdRef.current = event.pointerId
    try {
      btnRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (pointerIdRef.current !== moveEvent.pointerId) return
      const delta = moveEvent.clientX - startXRef.current
      startXRef.current = moveEvent.clientX
      onResize?.(delta / 320)
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
        "lane-resizer w-1 cursor-ew-resize bg-transparent transition-colors hover:bg-primary/40",
        className,
      )}
    />
  )
}
