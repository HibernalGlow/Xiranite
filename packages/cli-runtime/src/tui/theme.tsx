import * as React from "react"

// Adapted from terminal component-library theme-provider registry patterns.
export interface TerminalTheme {
  name: string
  colors: {
    primary: string
    foreground: string
    mutedForeground: string
    border: string
    focusRing: string
    success: string
    warning: string
    error: string
  }
}

export const defaultTerminalTheme: TerminalTheme = {
  name: "default",
  colors: {
    primary: "#7C3AED",
    foreground: "#FFFFFF",
    mutedForeground: "#9CA3AF",
    border: "#4B5563",
    focusRing: "#8B5CF6",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
  },
}

// Theme palettes are renderer-neutral and consumed by the OpenTUI composition.
export const draculaTerminalTheme: TerminalTheme = {
  name: "dracula",
  colors: {
    primary: "#BD93F9",
    foreground: "#F8F8F2",
    mutedForeground: "#6272A4",
    border: "#6272A4",
    focusRing: "#BD93F9",
    success: "#50FA7B",
    warning: "#F1FA8C",
    error: "#FF5555",
  },
}

export const highContrastTerminalTheme: TerminalTheme = {
  name: "high-contrast",
  colors: {
    primary: "#FFFFFF",
    foreground: "#FFFFFF",
    mutedForeground: "#CCCCCC",
    border: "#FFFFFF",
    focusRing: "#FFFF00",
    success: "#00FF00",
    warning: "#FFFF00",
    error: "#FF4444",
  },
}

const terminalThemes = new Map<string, TerminalTheme>([
  [defaultTerminalTheme.name, defaultTerminalTheme],
  [draculaTerminalTheme.name, draculaTerminalTheme],
  [highContrastTerminalTheme.name, highContrastTerminalTheme],
])

export function registerTerminalTheme(theme: TerminalTheme): void {
  terminalThemes.set(theme.name.toLowerCase(), theme)
}

export function resolveTerminalTheme(name?: string): TerminalTheme {
  return terminalThemes.get(name?.toLowerCase() ?? "default") ?? defaultTerminalTheme
}

export function listTerminalThemes(): readonly string[] {
  return [...terminalThemes.keys()]
}

const ThemeContext = React.createContext<TerminalTheme>(defaultTerminalTheme)

export function TerminalThemeProvider({
  children,
  theme = defaultTerminalTheme,
}: {
  children: React.ReactNode
  theme?: TerminalTheme
}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTerminalTheme(): TerminalTheme {
  return React.useContext(ThemeContext)
}
