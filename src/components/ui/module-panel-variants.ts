export const MODULE_TITLE_STYLES = ["legend", "inline", "bar", "minimal"] as const
export const MODULE_PANEL_STYLES = ["soft", "solid", "outline", "flat"] as const
export const MODULE_CARD_EFFECTS = ["magic", "plain"] as const
export const RESIZABLE_HANDLE_STYLES = ["grip", "dots", "line", "minimal"] as const

export type ModuleTitleStyle = (typeof MODULE_TITLE_STYLES)[number]
export type ModulePanelStyle = (typeof MODULE_PANEL_STYLES)[number]
export type ModuleCardEffect = (typeof MODULE_CARD_EFFECTS)[number]
export type ResizableHandleStyle = (typeof RESIZABLE_HANDLE_STYLES)[number]

export interface ModuleMagicCardAppearance {
  radius: number
  opacity: number
  colorStrength: number
  followThemeColor: boolean
  color: string
}

export const DEFAULT_MODULE_MAGIC_CARD_APPEARANCE: ModuleMagicCardAppearance = {
  radius: 120,
  opacity: 50,
  colorStrength: 40,
  followThemeColor: true,
  color: "#22c55e",
}

export function moduleMagicCardProps(appearance: ModuleMagicCardAppearance) {
  const color = appearance.followThemeColor ? "var(--primary)" : appearance.color
  return {
    gradientSize: appearance.radius,
    gradientOpacity: appearance.opacity / 100,
    gradientColor: `color-mix(in oklch, ${color} ${appearance.colorStrength}%, transparent)`,
  }
}
