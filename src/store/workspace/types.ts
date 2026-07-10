import type {
  AppTheme,
  AppFontPreset,
  AppCustomTheme,
  CardClickAction,
  CardLayout,
  ComponentInstance,
  ComponentState,
  DeployComponentOptions,
  FlowCanvasSnapshot,
  Lane,
  OverlayKind,
  OverlayMode,
  ViewMode,
  WorkspaceItem,
} from "@/types/workspace"
import type { ComponentDTO, LaneDTO, WorkspaceDTO } from "@xiranite/shared"
import type { TabDisplayStyle } from "@/components/ui/tabs-variants"
import type { SwitchDisplayStyle } from "@/components/ui/switch-variants"

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
  selectedComponentIds: string[]
  zCounter: number
  overlay: OverlayKind
  overlayMode: OverlayMode
  overlayWidth: number
  overlayFloatingMetrics: OverlayFloatingMetrics
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
  liquidGlassEnabled: boolean
  liquidGlassOpacity: number
  liquidGlassBlur: number
  liquidGlassDisplacement: number
  chromeVisible: boolean
  chromePosition: "left" | "right" | "island"
  chromeStyle: "default" | "traffic-light"
  chromeIslandScale: number
  chromeIslandMotion: number
  chromeIslandDelay: number
  chromeIslandIdleOffset: number
  cardClickAction: CardClickAction
  cardDoubleClickAction: CardClickAction
  tabDisplayStyle: TabDisplayStyle
  switchDisplayStyle: SwitchDisplayStyle
  hazardMode: boolean
}

export type ComponentPatch = {
  data?: Record<string, unknown>
  tags?: string[]
  state?: ComponentState
  hiddenIn?: Partial<Record<ViewMode, boolean>>
}

export interface OverlayFloatingMetrics {
  widthRatio: number
  heightRatio: number
  xRatio: number
  yRatio: number
}

export interface WorkspaceUiActions {
  setTheme(theme: AppTheme): void
  hydrateUiPreferences(preferences: Partial<WorkspaceUiPreferences>): void
  setCustomThemes(themes: AppCustomTheme[]): void
  setActiveCustomThemeName(name: string | null): void
  setFontPreset(fontPreset: AppFontPreset): void
  setViewMode(mode: ViewMode): void
  setCardLayout(layout: CardLayout): void
  setOverlay(overlay: OverlayKind): void
  setOverlayMode(mode: OverlayMode): void
  setOverlayWidth(width: number): void
  setOverlayFloatingMetrics(metrics: Partial<OverlayFloatingMetrics>): void
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
  setLiquidGlassEnabled(enabled: boolean): void
  setLiquidGlassOpacity(opacity: number): void
  setLiquidGlassBlur(blur: number): void
  setLiquidGlassDisplacement(displacement: number): void
  setChromeVisible(visible: boolean): void
  setChromePosition(position: "left" | "right" | "island"): void
  setChromeStyle(style: "default" | "traffic-light"): void
  setChromeIslandScale(scale: number): void
  setChromeIslandMotion(motion: number): void
  setChromeIslandDelay(delay: number): void
  setChromeIslandIdleOffset(offset: number): void
  setCardClickAction(action: CardClickAction): void
  setCardDoubleClickAction(action: CardClickAction): void
  setTabDisplayStyle(style: TabDisplayStyle): void
  setSwitchDisplayStyle(style: SwitchDisplayStyle): void
  setHazardMode(enabled: boolean): void
}

export interface WorkspaceListActions {
  setActiveWorkspace(id: string): void
  addWorkspace(): void
  removeWorkspace(id: string): void
  renameWorkspace(id: string, label: string): void
  setWorkspaceIcon(id: string, icon: string | undefined): void
  setWorkspaceFlowCanvas(id: string, flowCanvas: FlowCanvasSnapshot | undefined): void
}

export interface WorkspaceComponentActions {
  deployComponent(moduleId: string, viewModeOrOptions?: ViewMode | DeployComponentOptions): void
  ensureComponent(component: ComponentInstance): void
  removeComponent(id: string): void
  removeComponentsByModule(moduleId: string): void
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
  setSelection(ids: string[]): void
  toggleSelection(id: string): void
  addToSelection(ids: string[]): void
  clearSelection(): void
  removeComponents(ids: string[]): void
  duplicateComponents(ids: string[]): void
  toggleCollapseComponents(ids: string[]): void
  setComponentsVisibility(ids: string[], viewMode: ViewMode, visible: boolean): void
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
  | "overlayMode"
  | "overlayWidth"
  | "overlayFloatingMetrics"
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
  | "liquidGlassEnabled"
  | "liquidGlassOpacity"
  | "liquidGlassBlur"
  | "liquidGlassDisplacement"
  | "chromeVisible"
  | "chromePosition"
  | "chromeStyle"
  | "chromeIslandScale"
  | "chromeIslandMotion"
  | "chromeIslandDelay"
  | "chromeIslandIdleOffset"
  | "cardClickAction"
  | "cardDoubleClickAction"
  | "tabDisplayStyle"
  | "switchDisplayStyle"
  | "hazardMode"
>

export type SetWorkspaceStore = (
  partial: Partial<WSStore> | ((state: WSStore) => Partial<WSStore>),
  replace?: false,
  action?: string,
) => void

export type WorkspaceStoreUpdater = (action: string, updater: (state: WSStore) => Partial<WSStore>) => void
