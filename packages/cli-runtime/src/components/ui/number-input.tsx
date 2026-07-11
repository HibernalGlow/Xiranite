/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"

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
  const [buffer, setBuffer] = useState(String(value))
  const bufferRef = useRef(buffer)
  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
  const set = (next: number) => {
    if (!disabled && Number.isFinite(next)) onChange(clamp(next))
  }
  const updateBuffer = (next: string) => { bufferRef.current = next; setBuffer(next) }
  useEffect(() => { updateBuffer(String(value)) }, [value])
  useKeyboard((key) => {
    if (!focused || disabled) return
    if (key.name === "backspace" || key.name === "delete") {
      const next = bufferRef.current.slice(0, -1)
      updateBuffer(next)
      if (next && next !== "-") onChange(Number(next))
      return
    }
    const character = key.sequence?.length === 1 ? key.sequence : key.name?.length === 1 ? key.name : ""
    if (!/^[\d.-]$/.test(character)) return
    if (character === "-" && bufferRef.current.length > 0) return
    if (character === "." && bufferRef.current.includes(".")) return
    const next = bufferRef.current + character
    updateBuffer(next)
    onChange(Number(next))
  })
  return (
    <box flexDirection="row">
      <box id={`${id}-minus`} borderStyle="rounded" borderColor={hovered === "minus" ? colors.focusRing : colors.border} paddingLeft={1} paddingRight={1} onMouseDown={disabled ? undefined : () => { onFocus(); set(value - step) }} onMouseOver={() => setHovered("minus")} onMouseOut={() => setHovered(null)}>
        <text fg={disabled ? colors.mutedForeground : colors.foreground}>−</text>
      </box>
      <box id={id} borderStyle="rounded" borderColor={focused ? colors.focusRing : colors.border} width={10} paddingLeft={1} paddingRight={1} onMouseDown={disabled ? undefined : () => { updateBuffer(""); onFocus() }}>
        <text fg={colors.foreground}>{buffer || " "}</text>{focused ? <text fg={colors.focusRing}>█</text> : null}
      </box>
      <box id={`${id}-plus`} borderStyle="rounded" borderColor={hovered === "plus" ? colors.focusRing : colors.border} paddingLeft={1} paddingRight={1} onMouseDown={disabled ? undefined : () => { onFocus(); set(value + step) }} onMouseOver={() => setHovered("plus")} onMouseOut={() => setHovered(null)}>
        <text fg={disabled ? colors.mutedForeground : colors.foreground}>+</text>
      </box>
    </box>
  )
}
