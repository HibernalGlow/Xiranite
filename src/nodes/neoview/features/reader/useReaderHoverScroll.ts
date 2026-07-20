import { useEffect, type RefObject } from "react"

const BASE_SMOOTHING = 0.12
const STOP_THRESHOLD_PX = 0.5
const EDGE_SATURATION_RATIO = 0.2

export interface ReaderHoverScrollOptions {
  enabled: boolean
  speed: number
  pageKey: string | number
}

/**
 * Drives native viewport scrolling without putting pointer or animation state in React.
 * The listener is scoped to the Reader viewport and the RAF exists only while movement
 * is possible, so the navigation, preload and media render paths remain untouched.
 */
export function useReaderHoverScroll(
  viewportRef: RefObject<HTMLElement | null>,
  { enabled, speed, pageKey }: ReaderHoverScrollOptions,
): void {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !enabled) return

    let frameId: number | undefined
    let hovering = false
    let pointerX = 0
    let pointerY = 0
    let rect = viewport.getBoundingClientRect()

    const stop = () => {
      hovering = false
      if (frameId !== undefined) cancelAnimationFrame(frameId)
      frameId = undefined
    }

    const schedule = () => {
      if (frameId === undefined && hovering) frameId = requestAnimationFrame(step)
    }

    const step = () => {
      frameId = undefined
      if (!hovering) return

      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (maxLeft <= 0 && maxTop <= 0) return

      const ratioX = hoverTargetRatio(pointerX - rect.left, rect.width)
      const ratioY = hoverTargetRatio(pointerY - rect.top, rect.height)
      const smoothing = 1 - Math.pow(1 - BASE_SMOOTHING, Math.max(0.25, speed / 2))
      const currentLeft = logicalScrollLeft(viewport)
      const targetLeft = maxLeft * (isRtl(viewport) ? 1 - ratioX : ratioX)
      const targetTop = maxTop * ratioY
      const deltaX = maxLeft > 0 ? targetLeft - currentLeft : 0
      const deltaY = maxTop > 0 ? targetTop - viewport.scrollTop : 0

      if (maxLeft > 0) setLogicalScrollLeft(viewport, Math.abs(deltaX) <= STOP_THRESHOLD_PX ? targetLeft : currentLeft + deltaX * smoothing)
      if (maxTop > 0) viewport.scrollTop = Math.abs(deltaY) <= STOP_THRESHOLD_PX ? targetTop : viewport.scrollTop + deltaY * smoothing
      if (Math.abs(deltaX) > STOP_THRESHOLD_PX || Math.abs(deltaY) > STOP_THRESHOLD_PX) schedule()
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX
      pointerY = event.clientY
      const inBounds = pointerX >= rect.left && pointerX <= rect.right && pointerY >= rect.top && pointerY <= rect.bottom
      if (!inBounds) {
        stop()
        return
      }
      hovering = true
      schedule()
    }
    const onPointerLeave = () => stop()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      rect = viewport.getBoundingClientRect()
      schedule()
    })

    viewport.addEventListener("pointermove", onPointerMove, { passive: true })
    viewport.addEventListener("pointerleave", onPointerLeave, { passive: true })
    observer?.observe(viewport)
    return () => {
      viewport.removeEventListener("pointermove", onPointerMove)
      viewport.removeEventListener("pointerleave", onPointerLeave)
      observer?.disconnect()
      stop()
    }
  }, [enabled, pageKey, speed, viewportRef])
}

function logicalScrollLeft(viewport: HTMLElement): number {
  return isRtl(viewport) ? -viewport.scrollLeft : viewport.scrollLeft
}

function setLogicalScrollLeft(viewport: HTMLElement, value: number): void {
  viewport.scrollLeft = isRtl(viewport) ? -value : value
}

function isRtl(viewport: HTMLElement): boolean {
  return getComputedStyle(viewport).direction === "rtl"
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hoverTargetRatio(pointer: number, length: number): number {
  const ratio = pointer / Math.max(1, length)
  return clamp((ratio - EDGE_SATURATION_RATIO) / (1 - EDGE_SATURATION_RATIO * 2), 0, 1)
}
