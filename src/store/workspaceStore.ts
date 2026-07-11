import { create } from "zustand"
import { createJSONStorage, devtools, persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { ComponentInstance } from "@/types/workspace"
import { sanitizePersistedBackgroundImageUrl } from "@/lib/backgroundImage"
import { createWorkspaceActions } from "@/store/workspace/actions"
import { INITIAL_STATE } from "@/store/workspace/constants"
import type { WorkspaceActions, WorkspaceUiPreferences, WSState, WSStore } from "@/store/workspace/types"

const EMPTY_COMPONENT_DATA = {} as Record<string, unknown>

function selectWorkspaceUiPreferences(state: WSStore): WorkspaceUiPreferences {
  return {
    theme: state.theme,
    customThemes: state.customThemes,
    activeCustomThemeName: state.activeCustomThemeName,
    fontPreset: state.fontPreset,
    cardLayout: state.cardLayout,
    overlayMode: state.overlayMode,
    overlayWidth: state.overlayWidth,
    overlayFloatingMetrics: state.overlayFloatingMetrics,
    grainEnabled: state.grainEnabled,
    vignetteDepth: state.vignetteDepth,
    grainIntensity: state.grainIntensity,
    actionGlow: state.actionGlow,
    cardElevation: state.cardElevation,
    bgMode: state.bgMode,
    bgImageUrl: sanitizePersistedBackgroundImageUrl(state.bgImageUrl),
    bgOpacity: state.bgOpacity,
    bgBlur: state.bgBlur,
    bgCoverTopBar: state.bgCoverTopBar,
    liquidGlassEnabled: state.liquidGlassEnabled,
    liquidGlassOpacity: state.liquidGlassOpacity,
    liquidGlassBlur: state.liquidGlassBlur,
    liquidGlassDisplacement: state.liquidGlassDisplacement,
    chromeVisible: state.chromeVisible,
    chromePosition: state.chromePosition,
    chromeStyle: state.chromeStyle,
    chromeIslandScale: state.chromeIslandScale,
    chromeIslandMotion: state.chromeIslandMotion,
    chromeIslandDelay: state.chromeIslandDelay,
    chromeIslandIdleOffset: state.chromeIslandIdleOffset,
    alphabetIndexVisible: state.alphabetIndexVisible,
    alphabetIndexOpacity: state.alphabetIndexOpacity,
    alphabetIndexStyle: state.alphabetIndexStyle,
    alphabetIndexWaveIntensity: state.alphabetIndexWaveIntensity,
    cardClickAction: state.cardClickAction,
    cardDoubleClickAction: state.cardDoubleClickAction,
    tabDisplayStyle: state.tabDisplayStyle,
    switchDisplayStyle: state.switchDisplayStyle,
    hazardMode: state.hazardMode,
  }
}

export const useWorkspaceStore = create<WSStore>()(
  devtools(
    persist(
      (set) => ({
        ...INITIAL_STATE,
        ...createWorkspaceActions(set),
      }),
      {
        name: "xiranite-workspace-ui",
        version: 1,
        storage: createJSONStorage(() => localStorage),
        partialize: selectWorkspaceUiPreferences,
      },
    ),
    { name: "xiranite-workspace" },
  ),
)

export function useWorkspaceSelector<T>(selector: (state: WSState) => T): T {
  return useWorkspaceStore((store) => selector(store))
}

export function useWorkspaceShallowSelector<T>(selector: (state: WSState) => T): T {
  return useWorkspaceStore(useShallow((store) => selector(store)))
}

export function useWorkspaceVisibleComponents(): ComponentInstance[] {
  return useWorkspaceStore(useShallow((state) =>
    state.components.filter((component) => component.workspaceId === state.activeWorkspaceId),
  ))
}

export function useWorkspaceComponent(compId: string): ComponentInstance | undefined {
  return useWorkspaceStore((state) => state.components.find((component) => component.id === compId))
}

export function useWorkspaceComponentData<T extends object>(compId: string): T {
  return useWorkspaceStore((state) =>
    (state.components.find((component) => component.id === compId)?.data ?? EMPTY_COMPONENT_DATA) as T,
  )
}

export function getWorkspaceState(): WSState {
  return selectWorkspaceState(useWorkspaceStore.getState())
}

export function useWorkspaceActions(): WorkspaceActions {
  return useWorkspaceStore(useShallow(selectWorkspaceActions))
}

function selectWorkspaceState(store: WSStore): WSState {
  return {
    theme: store.theme,
    customThemes: store.customThemes,
    activeCustomThemeName: store.activeCustomThemeName,
    fontPreset: store.fontPreset,
    viewMode: store.viewMode,
    cardLayout: store.cardLayout,
    workspaces: store.workspaces,
    activeWorkspaceId: store.activeWorkspaceId,
    components: store.components,
    lanes: store.lanes,
    focusedComponentId: store.focusedComponentId,
    fullscreenComponentId: store.fullscreenComponentId,
    selectedComponentIds: store.selectedComponentIds,
    zCounter: store.zCounter,
    overlay: store.overlay,
    overlayMode: store.overlayMode,
    overlayWidth: store.overlayWidth,
    overlayFloatingMetrics: store.overlayFloatingMetrics,
    grainEnabled: store.grainEnabled,
    vignetteDepth: store.vignetteDepth,
    grainIntensity: store.grainIntensity,
    actionGlow: store.actionGlow,
    cardElevation: store.cardElevation,
    backendReady: store.backendReady,
    bgMode: store.bgMode,
    bgImageUrl: store.bgImageUrl,
    bgOpacity: store.bgOpacity,
    bgBlur: store.bgBlur,
    bgCoverTopBar: store.bgCoverTopBar,
    liquidGlassEnabled: store.liquidGlassEnabled,
    liquidGlassOpacity: store.liquidGlassOpacity,
    liquidGlassBlur: store.liquidGlassBlur,
    liquidGlassDisplacement: store.liquidGlassDisplacement,
    chromeVisible: store.chromeVisible,
    chromePosition: store.chromePosition,
    chromeStyle: store.chromeStyle,
    chromeIslandScale: store.chromeIslandScale,
    chromeIslandMotion: store.chromeIslandMotion,
    chromeIslandDelay: store.chromeIslandDelay,
    chromeIslandIdleOffset: store.chromeIslandIdleOffset,
    cardClickAction: store.cardClickAction,
    cardDoubleClickAction: store.cardDoubleClickAction,
    tabDisplayStyle: store.tabDisplayStyle,
    switchDisplayStyle: store.switchDisplayStyle,
    hazardMode: store.hazardMode,
  }
}

function selectWorkspaceActions(store: WSStore): WorkspaceActions {
  return {
    setTheme: store.setTheme,
    hydrateUiPreferences: store.hydrateUiPreferences,
    setCustomThemes: store.setCustomThemes,
    setActiveCustomThemeName: store.setActiveCustomThemeName,
    setFontPreset: store.setFontPreset,
    setViewMode: store.setViewMode,
    setCardLayout: store.setCardLayout,
    setActiveWorkspace: store.setActiveWorkspace,
    addWorkspace: store.addWorkspace,
    removeWorkspace: store.removeWorkspace,
    renameWorkspace: store.renameWorkspace,
    setWorkspaceIcon: store.setWorkspaceIcon,
    setWorkspaceFlowCanvas: store.setWorkspaceFlowCanvas,
    deployComponent: store.deployComponent,
    ensureComponent: store.ensureComponent,
    removeComponent: store.removeComponent,
    removeComponentsByModule: store.removeComponentsByModule,
    setComponentState: store.setComponentState,
    setComponentPosition: store.setComponentPosition,
    moveComponent: store.moveComponent,
    setComponentFlowPos: store.setComponentFlowPos,
    setComponentFlowSize: store.setComponentFlowSize,
    setComponentBentoLayout: store.setComponentBentoLayout,
    setComponentLaneSize: store.setComponentLaneSize,
    setComponentData: store.setComponentData,
    patchComponentData: store.patchComponentData,
    updateComponent: store.updateComponent,
    setComponentDockPanel: store.setComponentDockPanel,
    setComponentVisibility: store.setComponentVisibility,
    toggleComponentVisibility: store.toggleComponentVisibility,
    setComponentTags: store.setComponentTags,
    focusComponent: store.focusComponent,
    setFullscreen: store.setFullscreen,
    raiseComponent: store.raiseComponent,
    toggleCollapse: store.toggleCollapse,
    duplicateComponent: store.duplicateComponent,
    setSelection: store.setSelection,
    toggleSelection: store.toggleSelection,
    addToSelection: store.addToSelection,
    clearSelection: store.clearSelection,
    removeComponents: store.removeComponents,
    duplicateComponents: store.duplicateComponents,
    toggleCollapseComponents: store.toggleCollapseComponents,
    setComponentsVisibility: store.setComponentsVisibility,
    setOverlay: store.setOverlay,
    setOverlayMode: store.setOverlayMode,
    setOverlayWidth: store.setOverlayWidth,
    setOverlayFloatingMetrics: store.setOverlayFloatingMetrics,
    setGrain: store.setGrain,
    setVignette: store.setVignette,
    setGrainIntensity: store.setGrainIntensity,
    setActionGlow: store.setActionGlow,
    setCardElevation: store.setCardElevation,
    setBgMode: store.setBgMode,
    setBgImageUrl: store.setBgImageUrl,
    setBgOpacity: store.setBgOpacity,
    setBgBlur: store.setBgBlur,
    setBgCoverTopBar: store.setBgCoverTopBar,
    setLiquidGlassEnabled: store.setLiquidGlassEnabled,
    setLiquidGlassOpacity: store.setLiquidGlassOpacity,
    setLiquidGlassBlur: store.setLiquidGlassBlur,
    setLiquidGlassDisplacement: store.setLiquidGlassDisplacement,
    setChromeVisible: store.setChromeVisible,
    setChromePosition: store.setChromePosition,
    setChromeStyle: store.setChromeStyle,
    setChromeIslandScale: store.setChromeIslandScale,
    setChromeIslandMotion: store.setChromeIslandMotion,
    setChromeIslandDelay: store.setChromeIslandDelay,
    setChromeIslandIdleOffset: store.setChromeIslandIdleOffset,
    setCardClickAction: store.setCardClickAction,
    setCardDoubleClickAction: store.setCardDoubleClickAction,
    setTabDisplayStyle: store.setTabDisplayStyle,
    setSwitchDisplayStyle: store.setSwitchDisplayStyle,
    setHazardMode: store.setHazardMode,
    addLane: store.addLane,
    removeLane: store.removeLane,
    renameLane: store.renameLane,
    setLaneWidthRatio: store.setLaneWidthRatio,
    toggleLaneCollapse: store.toggleLaneCollapse,
    toggleLaneVisibility: store.toggleLaneVisibility,
    reorderLane: store.reorderLane,
    setLaneCardOrder: store.setLaneCardOrder,
    setLaneBoardLayout: store.setLaneBoardLayout,
    moveComponentToLane: store.moveComponentToLane,
    setBackendReady: store.setBackendReady,
    hydrate: store.hydrate,
  }
}
