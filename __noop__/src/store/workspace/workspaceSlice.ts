import type { FlowCanvasCamera, FlowCanvasSnapshot } from "@/types/workspace"
import type { WorkspaceListActions, WorkspaceStoreUpdater, WSState } from "./types"

export function createWorkspaceSlice(update: WorkspaceStoreUpdater): WorkspaceListActions {
  return {
    setActiveWorkspace: (id) => update("SET_ACTIVE_WORKSPACE", () => ({ activeWorkspaceId: id })),
    addWorkspace: () => update("ADD_WORKSPACE", addWorkspaceState),
    removeWorkspace: (id) => update("REMOVE_WORKSPACE", (state) => removeWorkspaceState(state, id)),
    renameWorkspace: (id, label) => update("RENAME_WORKSPACE", (state) => renameWorkspaceState(state, id, label)),
    setWorkspaceIcon: (id, icon) => update("SET_WORKSPACE_ICON", (state) => setWorkspaceIconState(state, id, icon)),
    setWorkspaceFlowCanvas: (id, flowCanvas) =>
      update("SET_WORKSPACE_FLOW_CANVAS", (state) => setWorkspaceFlowCanvasState(state, id, flowCanvas)),
    setWorkspaceFlowCamera: (id, flowCamera) =>
      update("SET_WORKSPACE_FLOW_CAMERA", (state) => setWorkspaceFlowCameraState(state, id, flowCamera)),
  }
}

function addWorkspaceState(state: WSState): WSState {
  const now = Date.now()
  const id = `ws-${now}`
  return {
    ...state,
    workspaces: [...state.workspaces, { id, label: `common:workspaceN:${state.workspaces.length + 1}`, createdAt: now, updatedAt: now }],
    activeWorkspaceId: id,
  }
}

function removeWorkspaceState(state: WSState, id: string): WSState {
  if (state.workspaces.length <= 1) return state
  const rest = state.workspaces.filter((workspace) => workspace.id !== id)
  return {
    ...state,
    workspaces: rest,
    activeWorkspaceId: state.activeWorkspaceId === id ? rest[0].id : state.activeWorkspaceId,
    components: state.components.filter((component) => component.workspaceId !== id),
    lanes: state.lanes.filter((lane) => lane.workspaceId !== id),
  }
}

function renameWorkspaceState(state: WSState, id: string, label: string): WSState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === id ? { ...workspace, label, updatedAt: Date.now() } : workspace,
    ),
  }
}

function setWorkspaceIconState(state: WSState, id: string, icon: string | undefined): WSState {
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === id ? { ...workspace, icon, updatedAt: Date.now() } : workspace,
    ),
  }
}

function setWorkspaceFlowCanvasState(state: WSState, id: string, flowCanvas: FlowCanvasSnapshot | undefined): WSState {
  let changed = false
  const now = Date.now()
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== id) return workspace
    if (workspace.flowCanvas === flowCanvas) return workspace
    changed = true
    return { ...workspace, flowCanvas, updatedAt: now }
  })

  return changed ? { ...state, workspaces } : state
}

function setWorkspaceFlowCameraState(state: WSState, id: string, flowCamera: FlowCanvasCamera | undefined): WSState {
  let changed = false
  const now = Date.now()
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== id) return workspace
    const current = workspace.flowCamera
    const same =
      current?.x === flowCamera?.x &&
      current?.y === flowCamera?.y &&
      current?.z === flowCamera?.z
    if (same) return workspace
    changed = true
    return { ...workspace, flowCamera, updatedAt: now }
  })

  return changed ? { ...state, workspaces } : state
}
