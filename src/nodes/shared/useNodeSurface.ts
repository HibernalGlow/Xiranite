import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"

export type NodeSurfaceMode = "collapsed" | "compact" | "regular" | "expanded" | "workspace"

export interface NodeSurface {
  ref: RefObject<HTMLDivElement | null>
  width: number
  height: number
  mode: NodeSurfaceMode
  density: "tight" | "normal" | "roomy"
}

export function useNodeSurface(): NodeSurface {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const mode = useMemo<NodeSurfaceMode>(() => {
    if (size.width >= 1040 && size.height >= 680) return "workspace"
    if (size.width >= 860 && size.height >= 520) return "expanded"
    if (size.width >= 520 && size.height >= 360) return "regular"
    if (size.width >= 220 && size.height >= 96) return "compact"
    return "collapsed"
  }, [size.height, size.width])

  const density = mode === "collapsed" || mode === "compact"
    ? "tight"
    : mode === "workspace" || mode === "expanded"
      ? "roomy"
      : "normal"

  return { ref, width: size.width, height: size.height, mode, density }
}
