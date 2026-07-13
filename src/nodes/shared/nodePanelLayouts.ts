export type NodePanelLayout = Record<string, number>
export type NodePanelLayouts = Record<string, NodePanelLayout>

export function readNodePanelLayout(layouts: NodePanelLayouts | undefined, key: string, panelIds: readonly string[]): NodePanelLayout | undefined {
  const stored = layouts?.[key]
  if (!stored) return undefined

  const layout: NodePanelLayout = {}
  let total = 0
  for (const panelId of panelIds) {
    const size = stored[panelId]
    if (!Number.isFinite(size) || size <= 0 || size > 100) return undefined
    layout[panelId] = size
    total += size
  }

  return Math.abs(total - 100) <= 0.1 ? layout : undefined
}

export function updateNodePanelLayout(layouts: NodePanelLayouts | undefined, key: string, layout: NodePanelLayout): NodePanelLayouts {
  return { ...layouts, [key]: layout }
}
