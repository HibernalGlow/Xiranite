import type { ComponentInstance, Lane, WorkspaceItem } from "@/types/workspace"
import type { ComponentDTO, LaneDTO, WorkspaceDTO } from "@xiranite/shared"
import { INITIAL_STATE } from "./constants"
import type { WorkspaceBackendActions, WorkspaceStoreUpdater, WSState } from "./types"

export function createBackendSlice(update: WorkspaceStoreUpdater): WorkspaceBackendActions {
  return {
    setBackendReady: (ready) => update("BACKEND_READY", () => ({ backendReady: ready })),
    hydrate: (workspaces, lanes, components) => update("HYDRATE", (state) => hydrateState(state, workspaces, lanes, components)),
  }
}

function hydrateState(state: WSState, workspaces: WorkspaceDTO[], lanes: LaneDTO[], components: ComponentDTO[]): WSState {
  const nextWorkspaces: WorkspaceItem[] = workspaces.length
    ? workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      icon: workspace.icon,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }))
    : INITIAL_STATE.workspaces

  const nextComponents: ComponentInstance[] = components.map((component) => ({
    id: component.id,
    moduleId: component.moduleId,
    state: "docked",
    workspaceId: component.workspaceId,
    data: component.data,
    flowPosition: component.flowPosition,
    flowSize: component.flowSize,
    bentoLayout: component.bentoLayout,
    dockPanel: component.dockPanel,
    laneId: component.laneId,
    hiddenIn: component.hiddenIn,
    tags: component.tags,
    z: component.z,
    collapsed: component.collapsed,
    position: { x: 20, y: 20 },
    size: { w: 340, h: 280 },
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  }))

  const nextLanes: Lane[] = lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    workspaceId: lane.workspaceId,
    widthRatio: lane.widthRatio,
    collapsed: lane.collapsed,
    hidden: lane.hidden,
    cardOrder: lane.cardOrder,
    createdAt: lane.createdAt,
    updatedAt: lane.updatedAt,
  }))

  return {
    ...state,
    workspaces: nextWorkspaces,
    lanes: nextLanes,
    components: nextComponents,
    activeWorkspaceId: nextWorkspaces[0]?.id ?? state.activeWorkspaceId,
    zCounter: Math.max(state.zCounter, ...nextComponents.map((component) => component.z ?? 0)),
  }
}
