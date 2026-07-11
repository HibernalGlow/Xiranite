/* @jsxImportSource @opentui/react */
import { useState } from "react"

export interface NumberInputProps {
  id?: string
  value: number
  focused: boolean
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  colors: { border: string; focusRing: string; foreground: string; mutedForeground: string }
  onFocus: () => void
  onChange: (value: number) => void
}

/** termcn OpenTUI NumberInput adapted for isolated focus and mouse controls. */
export function NumberInput({ id, value, focused, disabled, min, max, step = 1, colors, onFocus, onChange }: NumberInputProps) {
  const [hovered, setHovered] = useState<"minus" | "plus" | null>(null)
  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
  const set = (next: number) => {
    if (!disabled && Number.isFinite(next)) onChange(clamp(next))
  }
  return (
    <box id={id} flexDirection="row" onMouseDown={disabled ? undefined : onFocus}>
      <box id={`${id}-minus`} borderStyle="rounded" borderColor={hovered === "minus" ? colors.focusRing : colors.border} paddingLeft={1} paddingRight={1} onMouseDown={disabled ? undefined : () => { onFocus(); set(value - step) }} onMouseOver={() => setHovered("minus")} onMouseOut={() => setHovered(null)}>
        <text fg={disabled ? colors.mutedForeground : colors.foreground}>−</text>
      </box>
      <box borderStyle="rounded" borderColor={focused ? colors.focusRing : colors.border} width={10} paddingLeft={1} paddingRight={1}>
        <input value={String(value)} focused={focused && !disabled} onInput={disabled ? undefined : (next) => set(Number(next))} />
      </box>
      <box id={`${id}-plus`} borderStyle="rounded" borderColor={hovered === "plus" ? colors.focusRing : colors.border} paddingLeft={1} paddingRight={1} onMouseDown={disabled ? undefined : () => { onFocus(); set(value + step) }} onMouseOver={() => setHovered("plus")} onMouseOut={() => setHovered(null)}>
        <text fg={disabled ? colors.mutedForeground : colors.foreground}>+</text>
      </box>
    </box>
  )
}
