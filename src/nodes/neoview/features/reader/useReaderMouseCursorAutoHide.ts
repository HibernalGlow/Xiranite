import { useEffect, type RefObject } from "react"
import type { ReaderMouseCursorSettings } from "@xiranite/node-neoview/ui-core"

/**
 * Keeps high-frequency pointer state outside React while reproducing NeoView's
 * cursor policy on the reading viewport only. Leaving the viewport always
 * restores the system cursor, so surrounding Reader controls remain usable.
 */
export function useReaderMouseCursorAutoHide(
  viewportRef: RefObject<HTMLElement | null>,
  settings: ReaderMouseCursorSettings,
): void {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !settings.autoHide) return

    let hideTimer: number | undefined
    let cursorHidden = false
    let pointerInside = false
    let lastPointer: { x: number; y: number } | undefined
    let hiddenAt: { x: number; y: number } | undefined

    const cancelHide = () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer)
      hideTimer = undefined
    }
    const show = () => {
      cancelHide()
      if (!cursorHidden) return
      cursorHidden = false
      hiddenAt = undefined
      delete viewport.dataset.readerCursorHidden
      viewport.style.removeProperty("cursor")
    }
    const hide = () => {
      hideTimer = undefined
      if (!pointerInside || cursorHidden) return
      cursorHidden = true
      hiddenAt = lastPointer
      viewport.dataset.readerCursorHidden = "true"
      viewport.style.cursor = "none"
    }
    const scheduleHide = () => {
      cancelHide()
      hideTimer = window.setTimeout(hide, settings.hideDelay * 1_000)
    }
    const wake = (x: number, y: number) => {
      show()
      lastPointer = { x, y }
      scheduleHide()
    }
    const onPointerEnter = (event: PointerEvent) => {
      pointerInside = true
      lastPointer = { x: event.clientX, y: event.clientY }
      scheduleHide()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerInside) onPointerEnter(event)
      const current = { x: event.clientX, y: event.clientY }
      if (cursorHidden && hiddenAt && Math.hypot(current.x - hiddenAt.x, current.y - hiddenAt.y) >= settings.showMovementThreshold) {
        wake(current.x, current.y)
        return
      }
      if (!cursorHidden) {
        lastPointer = current
        scheduleHide()
      }
    }
    const onPointerLeave = () => {
      pointerInside = false
      lastPointer = undefined
      hiddenAt = undefined
      show()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (settings.showOnButtonClick) wake(event.clientX, event.clientY)
    }
    const onWheel = (event: WheelEvent) => {
      if (settings.showOnWheel) wake(event.clientX, event.clientY)
    }
    const onKeyDown = () => {
      if (pointerInside && settings.showOnKeyDown) {
        show()
        scheduleHide()
      }
    }

    viewport.addEventListener("pointerenter", onPointerEnter, { passive: true })
    viewport.addEventListener("pointermove", onPointerMove, { passive: true })
    viewport.addEventListener("pointerleave", onPointerLeave, { passive: true })
    viewport.addEventListener("pointerdown", onPointerDown, { passive: true })
    viewport.addEventListener("wheel", onWheel, { passive: true })
    window.addEventListener("keydown", onKeyDown)
    if (viewport.matches(":hover")) {
      pointerInside = true
      scheduleHide()
    }
    return () => {
      viewport.removeEventListener("pointerenter", onPointerEnter)
      viewport.removeEventListener("pointermove", onPointerMove)
      viewport.removeEventListener("pointerleave", onPointerLeave)
      viewport.removeEventListener("pointerdown", onPointerDown)
      viewport.removeEventListener("wheel", onWheel)
      window.removeEventListener("keydown", onKeyDown)
      pointerInside = false
      show()
    }
  }, [settings.autoHide, settings.hideDelay, settings.showMovementThreshold, settings.showOnButtonClick, settings.showOnKeyDown, settings.showOnWheel, viewportRef])
}
