/**
 * @migrated-from src/lib/stackview/layers/CurrentFrameLayer.svelte
 * @source-hash sha256:81373076d98ecf897ed2fb03cbbafcdf4e16136b72bd3593c194777fd7f93aab
 * @features page-transition
 * @migration-status adapted
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
import { projectReaderPageTransitionCss } from "@xiranite/node-neoview/page-transition"

import type { ReaderPageTransitionPort } from "./ReaderPageTransitionStore"

export function ReaderPageTransitionLayer({ children, pageIndex, store, slideshowFade = false, slideshowTarget, fill = false }: {
  children: ReactNode
  pageIndex?: number
  store?: ReaderPageTransitionPort
  slideshowFade?: boolean
  slideshowTarget?: string
  fill?: boolean
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
    if (!element || pageIndex === undefined || previousIndex === undefined || pageIndex === previousIndex) return
    clearAnimation(element, cleanupTimerRef)
    if (prefersReducedMotion()) {
      return
    }

    const direction = pageIndex > previousIndex ? "next" : "prev"
    const startAnimation = () => {
      const projected = slideshowFade
        ? { enabled: true as const, from: { opacity: 0 }, to: { opacity: 1 }, transition: `opacity ${SLIDESHOW_FADE_DURATION_MS}ms ease-out` }
        : settings
          ? projectReaderPageTransitionCss(settings, direction)
          : undefined
      if (!projected?.enabled) return

      element.dataset.readerPageTransitionDirection = direction
      element.dataset.readerPageTransitionType = slideshowFade ? "slideshow-fade" : settings!.type
      if (slideshowFade) element.dataset.readerPageTransitionSource = "slideshow"
      element.style.willChange = slideshowFade ? "opacity" : "transform, opacity"
      element.style.transition = "none"
      applyCompositorStyle(element, projected.from)
      void element.offsetWidth
      element.style.transition = projected.transition
      applyCompositorStyle(element, projected.to)
      cleanupTimerRef.current = setTimeout(() => {
        clearAnimation(element, cleanupTimerRef)
      }, (slideshowFade ? SLIDESHOW_FADE_DURATION_MS : settings!.duration) + 50)
    }

    if (!slideshowFade || !slideshowTarget || hasCommittedSlideshowTarget(element, slideshowTarget)) {
      startAnimation()
      return
    }
    const observer = new MutationObserver(() => {
      if (!hasCommittedSlideshowTarget(element, slideshowTarget)) return
      observer.disconnect()
      startAnimation()
    })
    observer.observe(element, { attributes: true, subtree: true, attributeFilter: ["data-reader-page-image"] })
    return () => observer.disconnect()
  }, [pageIndex, settings, slideshowFade, slideshowTarget])

  useEffect(() => () => {
    const element = elementRef.current
    if (element) clearAnimation(element, cleanupTimerRef)
    else clearTimer(cleanupTimerRef)
  }, [])

  return (
    <div ref={elementRef} className={fill ? "h-full min-h-0 w-full shrink-0" : "shrink-0"} data-reader-page-transition-layer="true">
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
  delete element.dataset.readerPageTransitionSource
}

function clearTimer(timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>): void {
  if (timerRef.current === undefined) return
  clearTimeout(timerRef.current)
  timerRef.current = undefined
}

const SLIDESHOW_FADE_DURATION_MS = 180

function hasCommittedSlideshowTarget(element: HTMLElement, target: string): boolean {
  const expected = target.split("\0")
  const committed = new Set(Array.from(
    element.querySelectorAll<HTMLElement>("[data-reader-page-image]"),
    (image) => image.dataset.readerPageImage,
  ))
  return expected.every((pageId) => committed.has(pageId))
}
