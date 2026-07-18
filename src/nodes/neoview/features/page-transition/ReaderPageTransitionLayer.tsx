/**
 * @migrated-from src/lib/stackview/layers/CurrentFrameLayer.svelte
 * @source-hash sha256:81373076d98ecf897ed2fb03cbbafcdf4e16136b72bd3593c194777fd7f93aab
 * @features page-transition
 * @migration-status adapted
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
import { projectReaderPageTransitionCss } from "@xiranite/node-neoview/page-transition"

import type { ReaderPageTransitionPort } from "./ReaderPageTransitionStore"

export function ReaderPageTransitionLayer({ children, pageIndex, store }: {
  children: ReactNode
  pageIndex?: number
  store?: ReaderPageTransitionPort
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const lastPageIndexRef = useRef<number>()
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const settings = useSyncExternalStore(
    store?.subscribe ?? subscribeNoop,
    store?.getSnapshot ?? getUndefinedSnapshot,
    store?.getSnapshot ?? getUndefinedSnapshot,
  )

  useEffect(() => {
    const element = elementRef.current
    const previousIndex = lastPageIndexRef.current
    lastPageIndexRef.current = pageIndex
    if (!element || pageIndex === undefined || previousIndex === undefined || pageIndex === previousIndex || !settings) return
    if (prefersReducedMotion()) {
      clearAnimation(element, cleanupTimerRef)
      return
    }

    const direction = pageIndex > previousIndex ? "next" : "prev"
    const projected = projectReaderPageTransitionCss(settings, direction)
    if (!projected.enabled) {
      clearAnimation(element, cleanupTimerRef)
      return
    }

    clearTimer(cleanupTimerRef)
    element.dataset.readerPageTransitionDirection = direction
    element.dataset.readerPageTransitionType = settings.type
    element.style.willChange = "transform, opacity"
    element.style.transition = "none"
    applyCompositorStyle(element, projected.from)
    void element.offsetWidth
    element.style.transition = projected.transition
    applyCompositorStyle(element, projected.to)
    cleanupTimerRef.current = setTimeout(() => {
      clearAnimation(element, cleanupTimerRef)
    }, settings.duration + 50)
  }, [pageIndex, settings])

  useEffect(() => () => {
    const element = elementRef.current
    if (element) clearAnimation(element, cleanupTimerRef)
    else clearTimer(cleanupTimerRef)
  }, [])

  return (
    <div ref={elementRef} className="shrink-0" data-reader-page-transition-layer="true">
      {children}
    </div>
  )
}

function subscribeNoop(): () => void {
  return () => undefined
}

function getUndefinedSnapshot(): undefined {
  return undefined
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function applyCompositorStyle(element: HTMLElement, style: CSSProperties): void {
  element.style.transform = typeof style.transform === "string" ? style.transform : ""
  element.style.opacity = style.opacity === undefined ? "" : String(style.opacity)
}

function clearAnimation(
  element: HTMLElement,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>,
): void {
  clearTimer(timerRef)
  element.style.removeProperty("transition")
  element.style.removeProperty("transform")
  element.style.removeProperty("opacity")
  element.style.removeProperty("will-change")
  delete element.dataset.readerPageTransitionDirection
  delete element.dataset.readerPageTransitionType
}

function clearTimer(timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>): void {
  if (timerRef.current === undefined) return
  clearTimeout(timerRef.current)
  timerRef.current = undefined
}
