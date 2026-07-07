import type { WorkspaceListActions, WorkspaceStoreUpdater, WSState } from "./types"

export function createWorkspaceSlice(update: WorkspaceStoreUpdater): WorkspaceListActions {
  return {
    setActiveWorkspace: (id) => update("SET_ACTIVE_WORKSPACE", () => ({ activeWorkspaceId: id })),
    addWorkspace: () => update("ADD_WORKSPACE", addWorkspaceState),
    removeWorkspace: (id) => update("REMOVE_WORKSPACE", (state) => removeWorkspaceState(state, id)),
    renameWorkspace: (id, label) => update("RENAME_WORKSPACE", (state) => renameWorkspaceState(state, id, label)),
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
