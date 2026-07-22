/**
 * @migrated-from src/lib/stackview/layers/BackgroundLayer.svelte
 * @source-hash sha256:a96d7370186667696c08d45249253a7c9c375693b9092b6c4dd0d4dc3a6e49d4
 * @migration-status adapted
 */
import type { CSSProperties } from "react"

import type { ReaderBackgroundConfigDto } from "../../adapters/reader-http-client"
import "./ReaderBackgroundLayer.css"

export function ReaderBackgroundLayer({ config, imageSrc }: { config: ReaderBackgroundConfigDto; imageSrc?: string }) {
  const imageStyle = imageSrc ? { "--reader-background-image": `url(${JSON.stringify(imageSrc)})` } as CSSProperties : undefined
  const commonStyle = {
    ...imageStyle,
    "--reader-background-color": config.color,
    "--reader-ambient-speed": `${config.ambient.speed}s`,
    "--reader-ambient-blur": `${config.ambient.blur}px`,
    "--reader-ambient-opacity": config.ambient.opacity,
    "--reader-spotlight-color": config.spotlight.color,
  } as CSSProperties

  return <div
    aria-hidden="true"
    className="reader-background-layer"
    data-reader-background-mode={config.mode}
    data-reader-background-style={config.ambient.style}
    style={commonStyle}
  >
    {(config.mode === "auto" || config.mode === "ambient") && imageSrc ? <div className="reader-background-image" /> : null}
    {config.mode === "ambient" ? <div className="reader-background-ambient"><span /><span /><span /><span />{config.ambient.style === "dynamic" ? <><span /><span /></> : null}</div> : null}
    {config.mode === "aurora" ? <div className={config.aurora.showRadialGradient ? "reader-background-aurora is-masked" : "reader-background-aurora"} /> : null}
    {config.mode === "spotlight" ? <div className="reader-background-spotlight" /> : null}
  </div>
}
