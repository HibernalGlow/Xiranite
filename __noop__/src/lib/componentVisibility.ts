import type { ComponentInstance, ViewMode } from "@/types/workspace"

export function isComponentVisibleInView(component: ComponentInstance, viewMode: ViewMode): boolean {
  if (viewMode === "flow") {
    return component.hiddenIn?.flow === false
  }

  return component.hiddenIn?.[viewMode] !== true
}
