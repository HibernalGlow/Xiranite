import type { SetWorkspaceStore, WorkspaceUiActions } from "./types"

export function createUiSlice(set: SetWorkspaceStore): WorkspaceUiActions {
  return {
    setTheme: (theme) => set({ theme }, false, "SET_THEME"),
    setViewMode: (mode) => set({ viewMode: mode }, false, "SET_VIEW_MODE"),
    setCardLayout: (layout) => set({ cardLayout: layout }, false, "SET_CARD_LAYOUT"),
    setOverlay: (overlay) => set({ overlay }, false, "SET_OVERLAY"),
    setGrain: (enabled) => set({ grainEnabled: enabled }, false, "SET_GRAIN"),
    setVignette: (depth) => set({ vignetteDepth: depth }, false, "SET_VIGNETTE"),
    setGrainIntensity: (intensity) => set({ grainIntensity: intensity }, false, "SET_GRAIN_INTENSITY"),
    setActionGlow: (enabled) => set({ actionGlow: enabled }, false, "SET_ACTION_GLOW"),
    setCardElevation: (enabled) => set({ cardElevation: enabled }, false, "SET_CARD_ELEVATION"),
    setBgMode: (mode) => set({ bgMode: mode }, false, "SET_BG_MODE"),
    setBgImageUrl: (url) => set({ bgImageUrl: url }, false, "SET_BG_IMAGE_URL"),
    setBgOpacity: (opacity) => set({ bgOpacity: opacity }, false, "SET_BG_OPACITY"),
    setBgBlur: (blur) => set({ bgBlur: blur }, false, "SET_BG_BLUR"),
    setBgCoverTopBar: (cover) => set({ bgCoverTopBar: cover }, false, "SET_BG_COVER_TOP_BAR"),
  }
}
