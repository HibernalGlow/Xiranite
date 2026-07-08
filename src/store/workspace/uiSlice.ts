import type { SetWorkspaceStore, WorkspaceUiActions } from "./types"

export function createUiSlice(set: SetWorkspaceStore): WorkspaceUiActions {
  return {
    setTheme: (theme) => set({ theme, activeCustomThemeName: null }, false, "SET_THEME"),
    setCustomThemes: (customThemes) => set((state) => ({
      customThemes,
      activeCustomThemeName: customThemes.some((theme) => theme.name === state.activeCustomThemeName)
        ? state.activeCustomThemeName
        : (customThemes[0]?.name ?? null),
    }), false, "SET_CUSTOM_THEMES"),
    setActiveCustomThemeName: (activeCustomThemeName) => set({ activeCustomThemeName }, false, "SET_ACTIVE_CUSTOM_THEME"),
    setFontPreset: (fontPreset) => set({ fontPreset }, false, "SET_FONT_PRESET"),
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
    setLiquidGlassEnabled: (enabled) => set({ liquidGlassEnabled: enabled }, false, "SET_LIQUID_GLASS_ENABLED"),
    setLiquidGlassOpacity: (opacity) => set({ liquidGlassOpacity: opacity }, false, "SET_LIQUID_GLASS_OPACITY"),
    setLiquidGlassBlur: (blur) => set({ liquidGlassBlur: blur }, false, "SET_LIQUID_GLASS_BLUR"),
    setLiquidGlassDisplacement: (displacement) => set({ liquidGlassDisplacement: displacement }, false, "SET_LIQUID_GLASS_DISPLACEMENT"),
    setChromeVisible: (visible) => set({ chromeVisible: visible }, false, "SET_CHROME_VISIBLE"),
    setChromePosition: (position) => set({ chromePosition: position }, false, "SET_CHROME_POSITION"),
    setChromeStyle: (style) => set({ chromeStyle: style }, false, "SET_CHROME_STYLE"),
  }
}
