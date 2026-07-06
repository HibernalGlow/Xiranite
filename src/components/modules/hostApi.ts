import { useMemo } from "react"
import type { HostComponentRef, NodeHostApi } from "@xiranite/contract"
import { getBackend } from "@/backend/client"
import { actions, useWorkspace, useWSDispatch } from "@/store/workspaceContext"
import type { ComponentInstance, ComponentState, ViewMode } from "@/types/workspace"

const componentStates = new Set<ComponentState>(["docked", "floating", "focused", "fullscreen", "compact"])
const viewModes = new Set<ViewMode>(["cards", "dockview", "flow", "lane"])

export function useNodeHostApi(): NodeHostApi {
  const { state, visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()

  return useMemo(() => ({
    getData: <T,>(compId: string) => state.components.find((component) => component.id === compId)?.data as T | undefined,
    patchData: (compId: string, patch: Record<string, unknown>) => {
      dispatch(actions.patchComponentData(compId, patch))
    },
    listComponents: () => visibleComponents.map(toHostRef),
    updateComponent: (id: string, patch: Partial<HostComponentRef>) => {
      if (patch.data) {
        dispatch(actions.patchComponentData(id, patch.data))
      }
      if (patch.tags) {
        dispatch(actions.setComponentTags(id, patch.tags))
      }
      if (patch.state && componentStates.has(patch.state as ComponentState)) {
        dispatch(actions.setComponentState(id, patch.state as ComponentState))
      }
      if (patch.hiddenIn) {
        for (const [mode, hidden] of Object.entries(patch.hiddenIn)) {
          if (viewModes.has(mode as ViewMode)) {
            dispatch(actions.setComponentVisibility(id, mode as ViewMode, !hidden))
          }
        }
      }
    },
    actions: {
      run: async (nodeId, input, onEvent) => {
        const backend = await getBackend()
        return await backend.nodes.runNode(nodeId, input, onEvent)
      },
    },
    clipboard: {
      readText: () => navigator.clipboard.readText(),
      writeText: (text: string) => navigator.clipboard.writeText(text),
    },
    downloadText: (filename: string, content: string) => {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    },
    env: {
      theme: "light",
      platform: "web",
    },
  }), [dispatch, state.components, visibleComponents])
}

function toHostRef(component: ComponentInstance): HostComponentRef {
  return {
    id: component.id,
    moduleId: component.moduleId,
    state: component.state,
    tags: component.tags,
    hiddenIn: component.hiddenIn,
    data: component.data,
  }
}
