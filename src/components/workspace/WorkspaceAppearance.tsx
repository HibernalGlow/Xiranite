import { useEffect, useState } from "react"
import { applyCustomTheme, applyFontPreset, applyThemePreset, getActiveCustomTheme, mirrorAestivusThemeStorage, resolveThemeScheme, type ThemeMode } from "@/lib/appearance"
import { installNativeRangeProgressSync, syncAllNativeRangeProgress } from "@/lib/sliderSkin"
import { useTheme } from "@/components/use-theme"
import { useWorkspaceShallowSelector } from "@/store/workspaceStore"

export function WorkspaceAppearance() {
  const { theme: colorMode } = useTheme()
  const appearance = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    themeSelections: state.themeSelections,
    customThemes: state.customThemes,
    fontPreset: state.fontPreset,
    tabDisplayStyle: state.tabDisplayStyle,
    switchDisplayStyle: state.switchDisplayStyle,
    scrollbarDisplayStyle: state.scrollbarDisplayStyle,
    sliderDisplayStyle: state.sliderDisplayStyle,
    choiceControlStyle: state.choiceControlStyle,
    fieldTitleStyle: state.fieldTitleStyle,
    moduleTitleStyle: state.moduleTitleStyle,
    modulePanelStyle: state.modulePanelStyle,
    moduleCardEffect: state.moduleCardEffect,
    resizableHandleStyle: state.resizableHandleStyle,
  }))
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? document.documentElement.classList.contains("dark"))

  useEffect(() => {
    applyFontPreset(appearance.fontPreset)
  }, [appearance.fontPreset])

  useEffect(() => {
    document.documentElement.dataset.tabsStyle = appearance.tabDisplayStyle
  }, [appearance.tabDisplayStyle])

  useEffect(() => {
    document.documentElement.dataset.switchStyle = appearance.switchDisplayStyle
  }, [appearance.switchDisplayStyle])

  useEffect(() => {
    document.documentElement.dataset.scrollbarStyle = appearance.scrollbarDisplayStyle
  }, [appearance.scrollbarDisplayStyle])

  useEffect(() => {
    document.documentElement.dataset.sliderStyle = appearance.sliderDisplayStyle
    // Re-sync native range fill rails after skin tokens change.
    syncAllNativeRangeProgress(document)
  }, [appearance.sliderDisplayStyle])

  useEffect(() => installNativeRangeProgressSync(), [])

  useEffect(() => {
    document.documentElement.dataset.choiceControlStyle = appearance.choiceControlStyle
    document.documentElement.dataset.fieldTitleStyle = appearance.fieldTitleStyle
    delete document.documentElement.dataset.choiceControlLabelStyle
  }, [appearance.fieldTitleStyle, appearance.choiceControlStyle])

  useEffect(() => {
    document.documentElement.dataset.moduleTitleStyle = appearance.moduleTitleStyle
    document.documentElement.dataset.modulePanelStyle = appearance.modulePanelStyle
    document.documentElement.dataset.moduleCardEffect = appearance.moduleCardEffect
    document.documentElement.dataset.resizableHandleStyle = appearance.resizableHandleStyle
  }, [appearance.moduleCardEffect, appearance.moduleTitleStyle, appearance.modulePanelStyle, appearance.resizableHandleStyle])

  useEffect(() => {
    const root = document.documentElement
    delete root.dataset.liquidGlass
    root.removeAttribute("rt-liquid-glass")
    root.removeAttribute("rt-liquid-glass-disable-firefox")
    root.removeAttribute("rt-liquid-glass-transition-ms")
    root.removeAttribute("rt-liquid-glass-base-bg")
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mediaQuery?.addEventListener("change", handleChange)
    return () => mediaQuery?.removeEventListener("change", handleChange)
  }, [])

  useEffect(() => {
    const mode = colorMode as ThemeMode
    const scheme = resolveThemeScheme(mode, systemDark)
    const selection = appearance.themeSelections[scheme]
    const preset = selection.kind === "preset" ? selection.name : appearance.theme
    const activeCustomTheme = selection.kind === "custom" ? getActiveCustomTheme(appearance.customThemes, selection.name) : null
    applyThemePreset(preset)
    applyCustomTheme(activeCustomTheme, scheme)
    mirrorAestivusThemeStorage(preset, mode, appearance.customThemes, activeCustomTheme)
  }, [appearance.theme, appearance.themeSelections, appearance.customThemes, colorMode, systemDark])

  return null
}
