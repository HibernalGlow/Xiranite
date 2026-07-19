import { useEffect, useRef, type RefObject } from "react"

export function ReaderMagnifierLayer({ viewportRef, enabled, zoom, size, pageKey }: {
  viewportRef: RefObject<HTMLElement | null>
  enabled: boolean
  zoom: number
  size: number
  pageKey: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const replicaRef = useRef<HTMLDivElement>(null)
  const borderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const root = rootRef.current
    const scene = sceneRef.current
    const replicaBox = boxRef.current
    const replica = replicaRef.current
    const border = borderRef.current
    if (!viewport || !root || !scene || !replicaBox || !replica || !border || !enabled) return

    let frameId: number | undefined
    let pointerX = 0
    let pointerY = 0
    let visible = false
    let image: HTMLImageElement | undefined

    const hide = () => {
      visible = false
      root.style.display = "none"
      border.style.display = "none"
      image = undefined
      if (frameId !== undefined) cancelAnimationFrame(frameId)
      frameId = undefined
    }
    const schedule = () => {
      if (visible && frameId === undefined) frameId = requestAnimationFrame(update)
    }
    const update = () => {
      frameId = undefined
      if (!visible || !image?.isConnected) {
        hide()
        return
      }
      const pageBox = image.closest<HTMLElement>("[data-reader-page-box]")
      const source = image.currentSrc || image.src
      const imageRect = image.getBoundingClientRect()
      const boxRect = pageBox?.getBoundingClientRect()
      const width = image.offsetWidth || imageRect.width
      const height = image.offsetHeight || imageRect.height
      if (!source || !pageBox || !boxRect || width <= 0 || height <= 0 || boxRect.width <= 0 || boxRect.height <= 0) {
        hide()
        return
      }

      const computed = getComputedStyle(image)
      const transform = computed.transform === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : computed.transform
      const origin = parseTransformOrigin(computed.transformOrigin, width, height)
      const bounds = transformedBounds(width, height, transform, origin.x, origin.y)
      const baseLeft = imageRect.left - bounds.left
      const baseTop = imageRect.top - bounds.top

      root.style.display = "block"
      root.style.clipPath = `circle(${size / 2}px at ${pointerX}px ${pointerY}px)`
      scene.style.transformOrigin = `${pointerX}px ${pointerY}px`
      scene.style.transform = `scale(${zoom})`
      replicaBox.style.left = `${boxRect.left}px`
      replicaBox.style.top = `${boxRect.top}px`
      replicaBox.style.width = `${boxRect.width}px`
      replicaBox.style.height = `${boxRect.height}px`
      replica.style.left = `${baseLeft - boxRect.left}px`
      replica.style.top = `${baseTop - boxRect.top}px`
      replica.style.width = `${width}px`
      replica.style.height = `${height}px`
      replica.style.transformOrigin = computed.transformOrigin
      replica.style.transform = transform
      replica.style.backgroundImage = `url(${JSON.stringify(source)})`
      replica.style.backgroundSize = "100% 100%"
      replica.style.backgroundRepeat = "no-repeat"
      replica.style.filter = computed.filter === "none" ? "" : computed.filter
      replica.style.clipPath = computed.clipPath === "none" ? "" : computed.clipPath
      border.style.display = "block"
      border.style.width = `${size}px`
      border.style.height = `${size}px`
      border.style.left = `${pointerX - size / 2}px`
      border.style.top = `${pointerY - size / 2}px`
    }

    const resolveImage = (target: EventTarget | null): HTMLImageElement | undefined => {
      if (!(target instanceof Element)) return undefined
      if (target instanceof HTMLImageElement && target.hasAttribute("data-reader-page-image")) return target
      return target.closest("[data-reader-page-box]")?.querySelector<HTMLImageElement>("[data-reader-page-image]") ?? undefined
    }
    const onPointerMove = (event: PointerEvent) => {
      const nextImage = resolveImage(event.target)
      if (!nextImage) {
        hide()
        return
      }
      image = nextImage
      pointerX = event.clientX
      pointerY = event.clientY
      visible = true
      schedule()
    }
    const onLayoutChange = () => schedule()

    viewport.addEventListener("pointermove", onPointerMove, { passive: true })
    viewport.addEventListener("pointerleave", hide, { passive: true })
    viewport.addEventListener("scroll", onLayoutChange, { passive: true })
    viewport.addEventListener("load", onLayoutChange, true)
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(onLayoutChange)
    observer?.observe(viewport)
    return () => {
      viewport.removeEventListener("pointermove", onPointerMove)
      viewport.removeEventListener("pointerleave", hide)
      viewport.removeEventListener("scroll", onLayoutChange)
      viewport.removeEventListener("load", onLayoutChange, true)
      observer?.disconnect()
      hide()
    }
  }, [enabled, pageKey, size, viewportRef, zoom])

  if (!enabled) return null
  return <>
    <div ref={rootRef} className="pointer-events-none fixed inset-0 z-[70] hidden" data-reader-magnifier="true" aria-hidden="true">
      <div ref={sceneRef} className="fixed inset-0 will-change-transform" data-reader-magnifier-scene="true">
        <div ref={boxRef} className="fixed overflow-hidden" data-reader-magnifier-box="true">
          <div ref={replicaRef} className="absolute will-change-transform" data-reader-magnifier-replica="true" />
        </div>
      </div>
    </div>
    <div ref={borderRef} className="pointer-events-none fixed z-[71] hidden rounded-full border-2 border-white/50 bg-transparent shadow-[0_4px_8px_rgb(0_0_0/0.3),inset_0_0_20px_rgb(0_0_0/0.1)]" data-reader-magnifier-border="true" aria-hidden="true" />
  </>
}

function parseTransformOrigin(value: string, width: number, height: number): { x: number; y: number } {
  const [rawX, rawY] = value.split(/\s+/)
  return {
    x: finiteCssPixels(rawX, width / 2),
    y: finiteCssPixels(rawY, height / 2),
  }
}

function finiteCssPixels(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : fallback
}

function transformedBounds(width: number, height: number, transform: string, originX: number, originY: number): { left: number; top: number } {
  if (typeof DOMMatrixReadOnly === "undefined") return { left: 0, top: 0 }
  const matrix = new DOMMatrixReadOnly(transform)
  const points = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({
    x: originX + matrix.a * (x! - originX) + matrix.c * (y! - originY) + matrix.e,
    y: originY + matrix.b * (x! - originX) + matrix.d * (y! - originY) + matrix.f,
  }))
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
  }
}
