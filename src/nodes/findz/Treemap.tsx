import { useEffect, useRef } from "react"
import { render, type WebTreemapNode } from "webtreemap-cdt/build/index.js"
import type { FindzTreemapNode } from "@xiranite/findz-native"
import "./treemap.css"

interface RenderNode extends WebTreemapNode {
  source: FindzTreemapNode
  children?: RenderNode[]
}

export function FindzTreemap({ projection, selectedArchiveId, onSelectArchive, onDrill }: {
  projection?: FindzTreemapNode
  selectedArchiveId?: number
  onSelectArchive(archiveId: number): void
  onDrill(pathPrefix: string): void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !projection || !container.clientWidth || !container.clientHeight) return
    const paint = () => {
      container.replaceChildren()
      const root = toRenderNode(projection)
      render(container, root, {
        padding: [18, 2, 2, 2],
        caption: (node) => (node as RenderNode).source.name,
        applyMutations: (node) => {
          const rendered = node as RenderNode
          if (!rendered.dom) return
          const { source, dom } = rendered
          dom.dataset.findzNodeId = source.id
          dom.dataset.findzSelected = String(source.archiveId === selectedArchiveId)
          dom.dataset.findzAnomaly = anomalyBand(source.color)
          dom.addEventListener("click", () => {
            if (source.archiveId) onSelectArchive(source.archiveId)
          })
          dom.addEventListener("dblclick", () => {
            if (source.id.startsWith("folder:")) onDrill(source.id.slice("folder:".length))
          })
        },
      })
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(container)
    return () => observer.disconnect()
  }, [onDrill, onSelectArchive, projection, selectedArchiveId])

  if (!projection?.children?.length) {
    return <div data-testid="findz-treemap-empty" className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No indexed archive area for this view.</div>
  }
  return <div ref={containerRef} data-testid="findz-treemap" className="findz-treemap relative min-h-56 flex-1 overflow-hidden" />
}

function toRenderNode(node: FindzTreemapNode): RenderNode {
  return {
    id: node.id,
    size: Math.max(node.value, 1),
    source: node,
    children: node.children?.map(toRenderNode),
  }
}

function anomalyBand(value: number): "none" | "medium" | "high" {
  if (value >= 0.2) return "high"
  if (value > 0) return "medium"
  return "none"
}
