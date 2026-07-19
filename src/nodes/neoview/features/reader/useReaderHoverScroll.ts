import { useEffect, type RefObject } from "react"

const BASE_VELOCITY_PX_PER_FRAME = 30
const VELOCITY_SMOOTHING = 0.12
const VELOCITY_DECAY = 0.85
const STOP_THRESHOLD = 0.05

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
    let velocityX = 0
    let velocityY = 0
    let rect = viewport.getBoundingClientRect()

    const stop = () => {
      hovering = false
      velocityX = 0
      velocityY = 0
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
      if (maxLeft <= 0 && maxTop <= 0) {
        velocityX = 0
        velocityY = 0
        return
      }

      const localX = pointerX - rect.left
      const localY = pointerY - rect.top
      const sideMargin = Math.min(50, rect.width * 0.2)
      if (localX < sideMargin || localX > rect.width - sideMargin) {
        velocityX *= VELOCITY_DECAY
        velocityY *= VELOCITY_DECAY
      } else {
        const effectiveWidth = Math.max(1, rect.width - sideMargin * 2)
        const normalizedX = (localX - sideMargin) / effectiveWidth - 0.5
        const normalizedY = localY / Math.max(1, rect.height) - 0.5
        const targetX = normalizedX * speed * BASE_VELOCITY_PX_PER_FRAME
        const targetY = normalizedY * speed * BASE_VELOCITY_PX_PER_FRAME
        velocityX += (targetX - velocityX) * VELOCITY_SMOOTHING
        velocityY += (targetY - velocityY) * VELOCITY_SMOOTHING
      }

      if (Math.abs(velocityX) < STOP_THRESHOLD) velocityX = 0
      if (Math.abs(velocityY) < STOP_THRESHOLD) velocityY = 0
      const canMoveX = maxLeft > 0 && (velocityX < 0 ? viewport.scrollLeft > 0 : velocityX > 0 && viewport.scrollLeft < maxLeft)
      const canMoveY = maxTop > 0 && (velocityY < 0 ? viewport.scrollTop > 0 : velocityY > 0 && viewport.scrollTop < maxTop)
      if (canMoveX) viewport.scrollLeft = Math.max(0, Math.min(maxLeft, viewport.scrollLeft + velocityX))
      else velocityX = 0
      if (canMoveY) viewport.scrollTop = Math.max(0, Math.min(maxTop, viewport.scrollTop + velocityY))
      else velocityY = 0

      if (canMoveX || canMoveY) schedule()
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
