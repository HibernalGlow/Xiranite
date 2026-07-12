import { useEffect } from "react"
import { applyCustomTheme, applyFontPreset, applyThemePreset, getActiveCustomTheme, mirrorAestivusThemeStorage, type ThemeMode } from "@/lib/appearance"
import { useTheme } from "@/components/use-theme"
import { useWorkspaceShallowSelector } from "@/store/workspaceStore"

export function WorkspaceAppearance() {
  const { theme: colorMode } = useTheme()
  const appearance = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    customThemes: state.customThemes,
    activeCustomThemeName: state.activeCustomThemeName,
    fontPreset: state.fontPreset,
    tabDisplayStyle: state.tabDisplayStyle,
    switchDisplayStyle: state.switchDisplayStyle,
    moduleTitleStyle: state.moduleTitleStyle,
    modulePanelStyle: state.modulePanelStyle,
    resizableHandleStyle: state.resizableHandleStyle,
  }))

  useEffect(() => {
    applyFontPreset(appearance.fontPreset)
  }, [appearance.fontPreset])

  useEffect(() => {
    applyThemePreset(appearance.theme)
  }, [appearance.theme])

  useEffect(() => {
    document.documentElement.dataset.tabsStyle = appearance.tabDisplayStyle
  }, [appearance.tabDisplayStyle])

  useEffect(() => {
    document.documentElement.dataset.switchStyle = appearance.switchDisplayStyle
  }, [appearance.switchDisplayStyle])

  useEffect(() => {
    document.documentElement.dataset.moduleTitleStyle = appearance.moduleTitleStyle
    document.documentElement.dataset.modulePanelStyle = appearance.modulePanelStyle
    document.documentElement.dataset.resizableHandleStyle = appearance.resizableHandleStyle
  }, [appearance.moduleTitleStyle, appearance.modulePanelStyle, appearance.resizableHandleStyle])

  useEffect(() => {
    const root = document.documentElement
    delete root.dataset.liquidGlass
    root.removeAttribute("rt-liquid-glass")
    root.removeAttribute("rt-liquid-glass-disable-firefox")
    root.removeAttribute("rt-liquid-glass-transition-ms")
    root.removeAttribute("rt-liquid-glass-base-bg")
  }, [])

  useEffect(() => {
    const mode = colorMode as ThemeMode
    const activeCustomTheme = getActiveCustomTheme(appearance.customThemes, appearance.activeCustomThemeName)
    applyCustomTheme(activeCustomTheme, mode)
    mirrorAestivusThemeStorage(appearance.theme, mode, appearance.customThemes, activeCustomTheme)

    if (mode !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)")
    const handleChange = () => applyCustomTheme(activeCustomTheme, mode)
    mediaQuery?.addEventListener("change", handleChange)

    return () => {
      mediaQuery?.removeEventListener("change", handleChange)
    }
  }, [appearance.theme, appearance.customThemes, appearance.activeCustomThemeName, colorMode])

  return null
}
