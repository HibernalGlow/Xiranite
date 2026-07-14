import { useLayoutEffect, useState, type RefObject } from "react"

import type { ReaderViewport } from "../features/reader/presentation-url"

const RESIZE_SETTLE_MS = 120
const EMPTY_VIEWPORT: ReaderViewport = { width: 0, height: 0, dpr: 1 }

export function useReaderViewport(ref: RefObject<HTMLElement | null>): ReaderViewport {
  const [viewport, setViewport] = useState(EMPTY_VIEWPORT)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const next = {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
        dpr: Math.max(1, window.devicePixelRatio || 1),
      }
      setViewport((current) => current.width === next.width
        && current.height === next.height
        && current.dpr === next.dpr
        ? current
        : next)
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(measure, RESIZE_SETTLE_MS)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
    observer?.observe(element)
    window.addEventListener("resize", schedule)
    return () => {
      if (timer) clearTimeout(timer)
      observer?.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [ref])

  return viewport
}
