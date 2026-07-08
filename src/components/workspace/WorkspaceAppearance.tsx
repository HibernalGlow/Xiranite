import { useEffect } from "react"
import { applyFontPreset, applyThemePreset, mirrorAestivusThemeStorage, type ThemeMode } from "@/lib/appearance"
import { useTheme } from "@/components/theme-provider"
import { useWorkspaceShallowSelector } from "@/store/workspaceContext"

export function WorkspaceAppearance() {
  const { theme: colorMode } = useTheme()
  const appearance = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    fontPreset: state.fontPreset,
  }))

  useEffect(() => {
    applyFontPreset(appearance.fontPreset)
  }, [appearance.fontPreset])

  useEffect(() => {
    applyThemePreset(appearance.theme)
  }, [appearance.theme])

  useEffect(() => {
    mirrorAestivusThemeStorage(appearance.theme, colorMode as ThemeMode)
  }, [appearance.theme, colorMode])

  return null
}
