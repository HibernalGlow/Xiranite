import { useCallback, useEffect, useState } from "react"
import { applyCustomTheme, applyFontPreset, applyThemePreset, getActiveCustomTheme, mirrorAestivusThemeStorage, resolveThemeScheme, type ThemeMode } from "@/lib/appearance"
import { installNativeRangeProgressSync, syncAllNativeRangeProgress } from "@/lib/sliderSkin"
import { applyDesignTheme, clearDesignTheme } from "@/lib/design-theme/apply"
import { readRootColorVar, readSystemAccentColor } from "@/lib/design-theme/domColor"
import { useTheme } from "@/components/use-theme"
import { useWorkspaceShallowSelector } from "@/store/workspaceStore"

/**
 * 外观落盘的唯一入口。两件事必须在这里、按固定顺序发生：
 *  1. 颜色主题（预设 + 用户导入的自定义主题）写自己的 CSS 变量；
 *  2. 高级主题（设计语言）再写它那份——它默认接管颜色，所以顺序反过来就会被颜色主题盖掉。
 * 两个维度都是往 `documentElement.style` 写同名变量（inline 优先级最高、后写赢），
 * 因此它们不能在两个组件里靠「挂载顺序」间接排序，必须在这一个 effect 链里显式排序。
 */
/**
 * `useTheme()` 在没有 ThemeProvider 的挂载点里返回 `undefined`，而
 * `resolveThemeScheme(undefined, …)` 会把 undefined 原样吐回来，于是
 * `themeSelections[undefined]` 是 undefined——崩在主题选择上而不是崩在颜色上，
 * 排查起来最费时间。兜底成 `system`，与 next-themes 自己的 defaultTheme 一致。
 */
function toThemeMode(colorMode: string | undefined): ThemeMode {
  return colorMode === "light" || colorMode === "dark" || colorMode === "system" ? colorMode : "system"
}

export function WorkspaceAppearance() {
  const { theme: colorMode } = useTheme()
  const appearance = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    themeSelections: state.themeSelections,
    customThemes: state.customThemes,
    fontPreset: state.fontPreset,
    designTheme: state.designTheme,
    tabDisplayStyle: state.tabDisplayStyle,
    switchDisplayStyle: state.switchDisplayStyle,
    scrollbarDisplayStyle: state.scrollbarDisplayStyle,
    sliderDisplayStyle: state.sliderDisplayStyle,
    choiceControlStyle: state.choiceControlStyle,
    fieldTitleStyle: state.fieldTitleStyle,
    moduleTitleStyle: state.moduleTitleStyle,
    modulePanelStyle: state.modulePanelStyle,
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
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mediaQuery?.addEventListener("change", handleChange)
    return () => mediaQuery?.removeEventListener("change", handleChange)
  }, [])

  /**
   * 颜色主题落盘。抽成带依赖的回调是因为高级主题撤走自己那批变量之后，
   * 自定义主题的 inline 变量需要有人原地重写回来（inline 变量被覆盖过就没有旧值可回了）。
   */
  const applyColorTheme = useCallback(() => {
    const mode = toThemeMode(colorMode)
    const scheme = resolveThemeScheme(mode, systemDark)
    const selection = appearance.themeSelections[scheme]
    const preset = selection.kind === "preset" ? selection.name : appearance.theme
    const activeCustomTheme = selection.kind === "custom" ? getActiveCustomTheme(appearance.customThemes, selection.name) : null
    applyThemePreset(preset)
    applyCustomTheme(activeCustomTheme, scheme)
    mirrorAestivusThemeStorage(preset, mode, appearance.customThemes, activeCustomTheme)
    return scheme
  }, [appearance.theme, appearance.themeSelections, appearance.customThemes, colorMode, systemDark])

  useEffect(() => {
    applyColorTheme()
  }, [applyColorTheme])

  useEffect(() => {
    const scheme = resolveThemeScheme(toThemeMode(colorMode), systemDark)
    const config = appearance.designTheme
    applyDesignTheme(config, {
      scheme,
      // 「跟随当前主题的主动色」这条取色路径要在颜色主题写完之后才读得到真值。
      activeThemeSeed: config.id === "md3" && config.md3.seedSource === "activeTheme" ? readRootColorVar("--primary") : null,
      systemAccentAvailable: config.id === "md3" && config.md3.seedSource === "systemAccent" ? readSystemAccentColor() !== null : true,
    }, applyColorTheme)
  }, [appearance.designTheme, applyColorTheme, colorMode, systemDark])

  // 只在真正卸载时清理；重跑靠 applyDesignTheme 自己的「先撤再写」。
  // 若在依赖变化时也清理，被我们覆盖过的自定义主题 inline 值就永久丢了。
  useEffect(() => () => clearDesignTheme(), [])

  return null
}
