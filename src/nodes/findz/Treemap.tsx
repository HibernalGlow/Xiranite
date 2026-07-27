import { useEffect, useRef } from "react"
import { render, type WebTreemapNode } from "webtreemap-cdt/build/index.js"
import type { FindzTreemapNode } from "@xiranite/findz-native"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
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
  const { t, language } = useNodeI18n("findz")
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
          dom.dataset.testid = `findz-treemap-node-${source.id.replaceAll(/[^a-zA-Z0-9]+/g, "-")}`
          dom.setAttribute("role", "button")
          dom.tabIndex = 0
          dom.setAttribute("aria-label", source.archiveId
            ? t("workspace.treemap.openArchive", "Open archive {{name}}", { name: source.name })
            : t("workspace.treemap.drillInto", "Drill into {{name}}", { name: source.name }))
          const select = () => {
            if (source.archiveId !== undefined) onSelectArchive(source.archiveId)
          }
          const drill = () => {
            if (source.id.startsWith("folder:")) onDrill(source.id.slice("folder:".length))
          }
          dom.addEventListener("click", select)
          dom.addEventListener("dblclick", drill)
          dom.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            if (source.archiveId !== undefined) select()
            else drill()
          })
        },
      })
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(container)
    return () => observer.disconnect()
  }, [language, onDrill, onSelectArchive, projection, selectedArchiveId])

  if (!projection?.children?.length) {
    return <div data-testid="findz-treemap-empty" className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{t("workspace.treemap.empty", "No indexed archive area for this view.")}</div>
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
