import type {
  AppTheme,
  AppFontPreset,
  AppCustomTheme,
  CardLayout,
  ComponentInstance,
  ComponentState,
  DeployComponentOptions,
  Lane,
  OverlayKind,
  ViewMode,
  WorkspaceItem,
} from "@/types/workspace"
import type { ComponentDTO, LaneDTO, WorkspaceDTO } from "@xiranite/shared"

export interface WSState {
  theme: AppTheme
  customThemes: AppCustomTheme[]
  activeCustomThemeName: string | null
  fontPreset: AppFontPreset
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
  bgCoverTopBar: boolean
  chromeVisible: boolean
  chromePosition: "left" | "right"
  chromeStyle: "default" | "traffic-light"
}

export type ComponentPatch = {
  data?: Record<string, unknown>
  tags?: string[]
  state?: ComponentState
  hiddenIn?: Partial<Record<ViewMode, boolean>>
}

export interface WorkspaceUiActions {
  setTheme(theme: AppTheme): void
  setCustomThemes(themes: AppCustomTheme[]): void
  setActiveCustomThemeName(name: string | null): void
  setFontPreset(fontPreset: AppFontPreset): void
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
  setBgCoverTopBar(cover: boolean): void
  setChromeVisible(visible: boolean): void
  setChromePosition(position: "left" | "right"): void
  setChromeStyle(style: "default" | "traffic-light"): void
}

export interface WorkspaceListActions {
  setActiveWorkspace(id: string): void
  addWorkspace(): void
  removeWorkspace(id: string): void
  renameWorkspace(id: string, label: string): void
  setWorkspaceIcon(id: string, icon: string | undefined): void
}

export interface WorkspaceComponentActions {
  deployComponent(moduleId: string, viewModeOrOptions?: ViewMode | DeployComponentOptions): void
  ensureComponent(component: ComponentInstance): void
  removeComponent(id: string): void
  setComponentState(id: string, state: ComponentState): void
  setComponentPosition(id: string, x: number, y: number): void
  moveComponent(id: string, x: number, y: number): void
  setComponentFlowPos(id: string, x: number, y: number): void
  setComponentFlowSize(id: string, width: number, height: number): void
  setComponentBentoLayout(id: string, layout: { x: number; y: number; w: number; h: number }): void
  setComponentLaneSize(id: string, size: { height: number }): void
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
  duplicateComponent(id: string): void
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
  setLaneBoardLayout(workspaceId: string | undefined, laneOrder: string[], cardOrderByLane: Record<string, string[]>): void
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
  | "customThemes"
  | "activeCustomThemeName"
  | "fontPreset"
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
  | "bgCoverTopBar"
  | "chromeVisible"
  | "chromePosition"
  | "chromeStyle"
>

export type SetWorkspaceStore = (
  partial: Partial<WSStore> | ((state: WSStore) => Partial<WSStore>),
  replace?: false,
  action?: string,
) => void

export type WorkspaceStoreUpdater = (action: string, updater: (state: WSStore) => Partial<WSStore>) => void
