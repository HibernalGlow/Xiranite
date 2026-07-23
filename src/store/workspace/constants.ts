/**
 * 工作区 Store 的常量与初始状态。
 *
 * - VIEW_MODES / COMPONENT_VIEW_MODES 列出全部视图模式；
 *   dashboard 不承载组件实例，仅作为概览页，故 ComponentViewMode 排除它。
 * - INITIAL_STATE 是首次启动（无 localStorage、无后端快照）时的默认值，
 *   会被 persist 中间件与 hydrate() 覆盖。
 */
import type { ViewMode } from "@/types/workspace"
import type { WSState } from "./types"

/** 组件可参与的视图模式（排除 dashboard，因为 dashboard 不承载组件实例）。 */
export type ComponentViewMode = Exclude<ViewMode, "dashboard">

export const VIEW_MODES: ViewMode[] = ["dashboard", "cards", "dockview", "flow", "lane", "bento"]
export const COMPONENT_VIEW_MODES: ComponentViewMode[] = ["cards", "dockview", "flow", "lane", "bento"]

/** Store 首次启动默认状态。 */
export const INITIAL_STATE: WSState = {
  theme: "spatial",
  themeSelections: {
    light: { kind: "preset", name: "spatial" },
    dark: { kind: "preset", name: "spatial" },
  },
  customThemes: [],
  activeCustomThemeName: null,
  fontPreset: "xiranite",
  viewMode: "cards",
  cardLayout: "grid",
  workspaces: [
    { id: "ws-alpha", label: "topbar:workspace.defaults.alpha" },
    { id: "ws-grid", label: "topbar:workspace.defaults.grid" },
    { id: "ws-kern", label: "topbar:workspace.defaults.kern" },
    { id: "ws-net", label: "topbar:workspace.defaults.net" },
    { id: "ws-arch", label: "topbar:workspace.defaults.arch" },
  ],
  activeWorkspaceId: "ws-alpha",
  components: [],
  lanes: [],
  focusedComponentId: null,
  fullscreenComponentId: null,
  selectedComponentIds: [],
  zCounter: 1,
  overlay: null,
  overlayMode: "docked",
  overlayWidth: 440,
  overlayFloatingMetrics: {
    widthRatio: 0.34,
    heightRatio: 0.58,
    xRatio: 0.66,
    yRatio: 0.1,
  },
  grainEnabled: true,
  vignetteDepth: 40,
  grainIntensity: 15,
  actionGlow: true,
  cardElevation: false,
  backendReady: false,
  bgMode: "dot-grid",
  bgImageUrl: "",
  bgOpacity: 30,
  bgBlur: 5,
  bgCoverTopBar: false,
  liquidGlassEnabled: false,
  liquidGlassOpacity: 24,
  liquidGlassBlur: 1,
  liquidGlassDisplacement: 110,
  chromeVisible: true,
  chromePosition: "right",
  chromeStyle: "default",
  chromeIslandScale: 90,
  chromeIslandMotion: 110,
  chromeIslandDelay: 45,
  chromeIslandIdleOffset: -3,
  alphabetIndexVisible: true,
  alphabetIndexOpacity: 92,
  alphabetIndexStyle: "glass",
  alphabetIndexWaveIntensity: 70,
  cardClickAction: "none",
  cardDoubleClickAction: "focus",
  tabDisplayStyle: "underline",
  switchDisplayStyle: "outlined",
  scrollbarDisplayStyle: "soft",
  sliderDisplayStyle: "solid",
  choiceControlStyle: "segmented",
  fieldTitleStyle: "legend",
  moduleTitleStyle: "legend",
  modulePanelStyle: "soft",
  resizableHandleStyle: "grip",
  hazardMode: false,
  restoreWorkspaceComponents: false,
  laneWorkspacePreferences: {},
}
