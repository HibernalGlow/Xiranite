import type { ViewMode } from "@/types/workspace"
import type { WSState } from "./types"

export const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane", "bento"]

export const INITIAL_STATE: WSState = {
  theme: "spatial",
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
  zCounter: 1,
  overlay: null,
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
}
