import { useEffect, useState } from "react"
import { buildFoliaDualTheme, DEFAULT_FOLIA_DUAL_THEME } from "@hibernalglow/folia-player"

// Resolves Xiranite CSS theme tokens into concrete sRGB colors accepted by Folia shaders.

export function useFoliaHostTheme(): ReturnType<typeof buildFoliaDualTheme> {
  const [theme, setTheme] = useState(readFoliaHostTheme)

  useEffect(() => {
    const root = document.documentElement
    const update = () => setTheme(readFoliaHostTheme())
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true })
    return () => observer.disconnect()
  }, [])

  return theme
}

export function resolveFoliaCssColor(cssValue: string, fallback: string): string {
  if (typeof document === "undefined" || !document.body) return fallback

  const probe = document.createElement("span")
  probe.style.color = cssValue
  probe.style.display = "none"
  document.body.append(probe)
  const computedColor = getComputedStyle(probe).color
  probe.remove()

  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context || !computedColor) return fallback

  context.clearRect(0, 0, 1, 1)
  context.fillStyle = computedColor
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
}

function readFoliaHostTheme(): ReturnType<typeof buildFoliaDualTheme> {
  if (typeof document === "undefined" || !document.body) return DEFAULT_FOLIA_DUAL_THEME

  const fallback = DEFAULT_FOLIA_DUAL_THEME.dark
  const probe = document.createElement("span")
  probe.style.fontFamily = "var(--font-app-sans)"
  probe.style.display = "none"
  document.body.append(probe)
  const fontFamily = getComputedStyle(probe).fontFamily || fallback.fontFamily
  probe.remove()

  const tokens = {
    background: resolveFoliaCssColor("var(--background)", fallback.backgroundColor),
    foreground: resolveFoliaCssColor("var(--foreground)", fallback.primaryColor),
    accent: resolveFoliaCssColor("var(--primary)", fallback.accentColor),
    secondary: resolveFoliaCssColor("var(--muted-foreground)", fallback.secondaryColor),
    fontFamily,
  }
  return buildFoliaDualTheme(tokens, tokens)
}
