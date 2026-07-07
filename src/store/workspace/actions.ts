import { createBackendSlice } from "./backendSlice"
import { createComponentSlice } from "./componentSlice"
import { createLaneSlice } from "./laneSlice"
import type { SetWorkspaceStore, WorkspaceActions, WSStore } from "./types"
import { createUiSlice } from "./uiSlice"
import { createWorkspaceSlice } from "./workspaceSlice"

export function createWorkspaceActions(set: SetWorkspaceStore): WorkspaceActions {
  const update = (action: string, updater: (state: WSStore) => Partial<WSStore>) => set(updater, false, action)

  return {
    ...createUiSlice(set),
    ...createWorkspaceSlice(update),
    ...createComponentSlice(update),
    ...createLaneSlice(update),
    ...createBackendSlice(update),
  }
}
