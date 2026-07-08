/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import {
  ThemeProvider as NextThemeProvider,
  useTheme as useNextTheme,
  type ThemeProviderProps as NextThemeProviderProps,
} from "next-themes"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = Omit<NextThemeProviderProps, "attribute" | "children"> & {
  children: React.ReactNode
}

const THEME_VALUES = new Set(["dark", "light", "system"])
const AESTIVUS_THEME_MODE_STORAGE_KEY = "theme-mode"

function isTheme(value: string | null | undefined): value is Theme {
  return Boolean(value && THEME_VALUES.has(value))
}

function seedNextThemesStorage(storageKey: string) {
  if (typeof window === "undefined") return

  const storedTheme = localStorage.getItem(storageKey)
  if (isTheme(storedTheme)) return

  const aestivusThemeMode = localStorage.getItem(AESTIVUS_THEME_MODE_STORAGE_KEY)
  if (isTheme(aestivusThemeMode)) {
    localStorage.setItem(storageKey, aestivusThemeMode)
  }
}

function ThemeStorageBridge({ storageKey }: { storageKey: string }) {
  const { theme, setTheme } = useNextTheme()

  React.useEffect(() => {
    if (isTheme(theme)) {
      localStorage.setItem(AESTIVUS_THEME_MODE_STORAGE_KEY, theme)
    }
  }, [theme])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== AESTIVUS_THEME_MODE_STORAGE_KEY) return
      if (isTheme(event.newValue)) setTheme(event.newValue)
    }

    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [setTheme])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
      if (event.key.toLowerCase() !== "d") return

      const root = document.documentElement
      const nextTheme = root.classList.contains("dark") ? "light" : "dark"
      localStorage.setItem(storageKey, nextTheme)
      localStorage.setItem(AESTIVUS_THEME_MODE_STORAGE_KEY, nextTheme)
      setTheme(nextTheme)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [setTheme, storageKey])

  return null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
  enableSystem = true,
  ...props
}: ThemeProviderProps) {
  seedNextThemesStorage(storageKey)

  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      disableTransitionOnChange={disableTransitionOnChange}
      enableSystem={enableSystem}
      storageKey={storageKey}
      {...props}
    >
      <ThemeStorageBridge storageKey={storageKey} />
      {children}
    </NextThemeProvider>
  )
}

export const useTheme = useNextTheme
