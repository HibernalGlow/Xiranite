import { THEME_DESIGN_RECIPES } from "@/lib/appearance"
import type { SetWorkspaceStore, WorkspaceUiActions, WorkspaceUiPreferences } from "./types"

export function createUiSlice(set: SetWorkspaceStore): WorkspaceUiActions {
  return {
    setTheme: (theme) => {
      const recipe = THEME_DESIGN_RECIPES[theme]
      set({
        theme,
        activeCustomThemeName: null,
        fontPreset: recipe.fontPreset,
      }, false, "SET_THEME")
    },
    hydrateUiPreferences: (preferences) => set(
      sanitizeUiPreferences(preferences),
      false,
      "HYDRATE_UI_PREFERENCES",
    ),
    setCustomThemes: (customThemes) => set((state) => ({
      customThemes,
      // A preset explicitly clears the active custom theme. Do not revive the
      // first imported theme while rehydrating the list on startup.
      activeCustomThemeName: state.activeCustomThemeName && customThemes.some((theme) => theme.name === state.activeCustomThemeName)
        ? state.activeCustomThemeName
        : null,
    }), false, "SET_CUSTOM_THEMES"),
    setActiveCustomThemeName: (activeCustomThemeName) => set({ activeCustomThemeName }, false, "SET_ACTIVE_CUSTOM_THEME"),
    setFontPreset: (fontPreset) => set({ fontPreset }, false, "SET_FONT_PRESET"),
    setViewMode: (mode) => set({ viewMode: mode }, false, "SET_VIEW_MODE"),
    setCardLayout: (layout) => set({ cardLayout: layout }, false, "SET_CARD_LAYOUT"),
    setOverlay: (overlay) => set({ overlay }, false, "SET_OVERLAY"),
    setOverlayMode: (overlayMode) => set({ overlayMode }, false, "SET_OVERLAY_MODE"),
    setOverlayWidth: (overlayWidth) => set({ overlayWidth }, false, "SET_OVERLAY_WIDTH"),
    setOverlayFloatingMetrics: (metrics) => set((state) => ({
      overlayFloatingMetrics: {
        ...state.overlayFloatingMetrics,
        ...metrics,
      },
    }), false, "SET_OVERLAY_FLOATING_METRICS"),
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
    setChromeIslandScale: (chromeIslandScale) => set({ chromeIslandScale }, false, "SET_CHROME_ISLAND_SCALE"),
    setChromeIslandMotion: (chromeIslandMotion) => set({ chromeIslandMotion }, false, "SET_CHROME_ISLAND_MOTION"),
    setChromeIslandDelay: (chromeIslandDelay) => set({ chromeIslandDelay }, false, "SET_CHROME_ISLAND_DELAY"),
    setChromeIslandIdleOffset: (chromeIslandIdleOffset) => set({ chromeIslandIdleOffset }, false, "SET_CHROME_ISLAND_IDLE_OFFSET"),
    setCardClickAction: (cardClickAction) => set({ cardClickAction }, false, "SET_CARD_CLICK_ACTION"),
    setCardDoubleClickAction: (cardDoubleClickAction) => set({ cardDoubleClickAction }, false, "SET_CARD_DOUBLE_CLICK_ACTION"),
    setTabDisplayStyle: (tabDisplayStyle) => set({ tabDisplayStyle }, false, "SET_TAB_DISPLAY_STYLE"),
    setSwitchDisplayStyle: (switchDisplayStyle) => set({ switchDisplayStyle }, false, "SET_SWITCH_DISPLAY_STYLE"),
  }
}

function sanitizeUiPreferences(preferences: Partial<WorkspaceUiPreferences>): Partial<WorkspaceUiPreferences> {
  return Object.fromEntries(
    Object.entries(preferences).filter(([, value]) => value !== undefined),
  ) as Partial<WorkspaceUiPreferences>
}
