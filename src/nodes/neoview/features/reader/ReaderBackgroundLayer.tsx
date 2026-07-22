/**
 * @migrated-from src/lib/stackview/layers/BackgroundLayer.svelte
 * @source-hash sha256:a96d7370186667696c08d45249253a7c9c375693b9092b6c4dd0d4dc3a6e49d4
 * @migration-status adapted
 */
import { useEffect, useState, type CSSProperties } from "react"

import type { ReaderBackgroundConfigDto } from "../../adapters/reader-http-client"
import {
  computeEdgeMatchPresentation,
  getCachedEdgeMatchPresentation,
  type EdgeMatchPresentation,
} from "./edgeMatchBackground"
import "./ReaderBackgroundLayer.css"

export function ReaderBackgroundLayer({ config, imageSrc }: { config: ReaderBackgroundConfigDto; imageSrc?: string }) {
  const edge = useSimpleEdgeMatch(config.mode === "edge" ? imageSrc : undefined)
  const imageStyle = imageSrc ? { "--reader-background-image": `url(${JSON.stringify(imageSrc)})` } as CSSProperties : undefined
  const edgeStyle = edge
    ? {
        "--reader-edge-match-css": edge.css,
        "--reader-edge-match-average": edge.average,
      } as CSSProperties
    : undefined

  return <div
    aria-hidden="true"
    className="reader-background-layer"
    data-reader-background-mode={config.mode}
    data-reader-background-style={config.ambient.style}
    data-reader-edge-ready={config.mode === "edge" && edge ? "true" : "false"}
    style={{
      ...imageStyle,
      ...edgeStyle,
      "--reader-background-color": edge?.average ?? config.color,
      "--reader-ambient-speed": `${config.ambient.speed}s`,
      "--reader-ambient-blur": `${config.ambient.blur}px`,
      "--reader-ambient-opacity": config.ambient.opacity,
      "--reader-spotlight-color": config.spotlight.color,
    } as CSSProperties}
  >
    {(config.mode === "auto" || config.mode === "ambient") && imageSrc ? <div className="reader-background-image" /> : null}
    {config.mode === "edge" && edge ? <div className="reader-background-edge" data-testid="reader-background-edge" /> : null}
    {config.mode === "ambient" ? <div className="reader-background-ambient"><span /><span /><span /><span />{config.ambient.style === "dynamic" ? <><span /><span /></> : null}</div> : null}
    {config.mode === "aurora" ? <div className={config.aurora.showRadialGradient ? "reader-background-aurora is-masked" : "reader-background-aurora"} /> : null}
    {config.mode === "spotlight" ? <div className="reader-background-spotlight" /> : null}
  </div>
}

/** Current page only. Cache hit is sync; otherwise sample once (prefer decoded page image). */
function useSimpleEdgeMatch(imageSrc: string | undefined): EdgeMatchPresentation | undefined {
  const [edge, setEdge] = useState<EdgeMatchPresentation | undefined>(() =>
    imageSrc ? getCachedEdgeMatchPresentation(imageSrc) : undefined,
  )

  useEffect(() => {
    if (!imageSrc) {
      setEdge(undefined)
      return
    }

    const cached = getCachedEdgeMatchPresentation(imageSrc)
    if (cached) {
      setEdge(cached)
      return
    }

    const controller = new AbortController()
    let active = true
    void computeEdgeMatchPresentation(imageSrc, controller.signal)
      .then((next) => {
        if (active) setEdge(next)
      })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof DOMException && error.name === "AbortError") return
        setEdge(undefined)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [imageSrc])

  if (imageSrc) {
    const cached = getCachedEdgeMatchPresentation(imageSrc)
    if (cached) return cached
  }
  return edge
}
