import type {
  AppTheme,
  CardLayout,
  ComponentInstance,
  ComponentState,
  Lane,
  OverlayKind,
  ViewMode,
  WorkspaceItem,
} from "@/types/workspace"
import type { ComponentDTO, LaneDTO, WorkspaceDTO } from "@xiranite/shared"

export interface WSState {
  theme: AppTheme
  viewMode: ViewMode
  cardLayout: CardLayout
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string
  components: ComponentInstance[]
  lanes: Lane[]
  focusedComponentId: string | null
  fullscreenComponentId: string | null
  zCounter: number
  overlay: OverlayKind
  grainEnabled: boolean
  vignetteDepth: number
  grainIntensity: number
  actionGlow: boolean
  cardElevation: boolean
  backendReady: boolean
  bgMode: "grid" | "dot-grid" | "image" | "none"
  bgImageUrl: string
  bgOpacity: number
  bgBlur: number
}

export type ComponentPatch = {
  data?: Record<string, unknown>
  tags?: string[]
  state?: ComponentState
  hiddenIn?: Partial<Record<ViewMode, boolean>>
}

export interface WorkspaceUiActions {
  setTheme(theme: AppTheme): void
  setViewMode(mode: ViewMode): void
  setCardLayout(layout: CardLayout): void
  setOverlay(overlay: OverlayKind): void
  setGrain(enabled: boolean): void
  setVignette(depth: number): void
  setGrainIntensity(intensity: number): void
  setActionGlow(enabled: boolean): void
  setCardElevation(enabled: boolean): void
  setBgMode(mode: "grid" | "dot-grid" | "image" | "none"): void
  setBgImageUrl(url: string): void
  setBgOpacity(opacity: number): void
  setBgBlur(blur: number): void
}

export interface WorkspaceListActions {
  setActiveWorkspace(id: string): void
  addWorkspace(): void
  removeWorkspace(id: string): void
  renameWorkspace(id: string, label: string): void
}

export interface WorkspaceComponentActions {
  deployComponent(moduleId: string, viewMode?: ViewMode): void
  ensureComponent(component: ComponentInstance): void
  removeComponent(id: string): void
  setComponentState(id: string, state: ComponentState): void
  setComponentPosition(id: string, x: number, y: number): void
  moveComponent(id: string, x: number, y: number): void
  setComponentFlowPos(id: string, x: number, y: number): void
  setComponentFlowSize(id: string, width: number, height: number): void
  setComponentData(id: string, data: Record<string, unknown>): void
  patchComponentData(id: string, patch: Record<string, unknown>): void
  updateComponent(id: string, patch: ComponentPatch): void
  setComponentDockPanel(id: string, panelId: string): void
  setComponentVisibility(id: string, viewMode: ViewMode, visible: boolean): void
  toggleComponentVisibility(id: string, viewMode: ViewMode): void
  setComponentTags(id: string, tags: string[]): void
  focusComponent(id: string | null): void
  setFullscreen(id: string | null): void
  raiseComponent(id: string): void
  toggleCollapse(id: string): void
}

export interface WorkspaceLaneActions {
  addLane(workspaceId?: string, label?: string): void
  removeLane(id: string): void
  renameLane(id: string, label: string): void
  setLaneWidthRatio(id: string, ratio: number): void
  toggleLaneCollapse(id: string): void
  toggleLaneVisibility(id: string): void
  reorderLane(fromId: string, toId: string): void
  setLaneCardOrder(id: string, cardOrder: string[]): void
  moveComponentToLane(componentId: string, toLaneId: string, targetCardId?: string | null, insertAfter?: boolean): void
}

export interface WorkspaceBackendActions {
  setBackendReady(ready: boolean): void
  hydrate(workspaces: WorkspaceDTO[], lanes: LaneDTO[], components: ComponentDTO[]): void
}

export type WorkspaceActions =
  & WorkspaceUiActions
  & WorkspaceListActions
  & WorkspaceComponentActions
  & WorkspaceLaneActions
  & WorkspaceBackendActions

export type WSStore = WSState & WorkspaceActions

export type WorkspaceUiPreferences = Pick<
  WSState,
  | "theme"
  | "cardLayout"
  | "grainEnabled"
  | "vignetteDepth"
  | "grainIntensity"
  | "actionGlow"
  | "cardElevation"
  | "bgMode"
  | "bgImageUrl"
  | "bgOpacity"
  | "bgBlur"
>

export type SetWorkspaceStore = (
  partial: Partial<WSStore> | ((state: WSStore) => Partial<WSStore>),
  replace?: false,
  action?: string,
) => void

export type WorkspaceStoreUpdater = (action: string, updater: (state: WSStore) => Partial<WSStore>) => void
