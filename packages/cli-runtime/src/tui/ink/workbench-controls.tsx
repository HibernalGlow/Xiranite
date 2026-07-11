import { useOnClick, useOnMouseEnter, useOnMouseLeave, useOnWheel } from "@ink-tools/ink-mouse"
import { Box, Text, type DOMElement } from "ink"
import { useRef, useState, type ReactNode } from "react"

import type { InteractionField, InteractionValue } from "../../interaction.js"
import type { TerminalTranslator } from "../i18n.js"
import { optionsForField, stepInteractionNumber } from "../screen.js"
import { useTerminalTheme } from "../theme.js"

export function WorkbenchPanel({
  title,
  description,
  children,
  width,
  flexGrow,
}: {
  title: string
  description?: string
  children: ReactNode
  width?: number | string
  flexGrow?: number
}) {
  const theme = useTerminalTheme()
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.border}
      paddingX={1}
      width={width}
      flexGrow={flexGrow}
      overflow="hidden"
    >
      {title ? <Text bold color={theme.colors.primary}>{title}</Text> : null}
      {description ? <Text color={theme.colors.mutedForeground} wrap="truncate-end">{description}</Text> : null}
      <Box flexDirection="column" marginTop={description ? 1 : 0} flexGrow={1} overflow="hidden">
        {children}
      </Box>
    </Box>
  )
}

export function WorkbenchField({
  field,
  value,
  error,
  focused,
  disabled,
  t,
  onFocus,
  onChange,
}: {
  field: InteractionField
  value?: InteractionValue
  error?: string
  focused: boolean
  disabled?: boolean
  t: TerminalTranslator
  onFocus: () => void
  onChange: (value: InteractionValue) => void
}) {
  const theme = useTerminalTheme()
  if (field.kind === "number") {
    return (
      <NumberField
        field={field}
        value={value}
        focused={focused}
        disabled={disabled}
        onFocus={onFocus}
        onChange={onChange}
      />
    )
  }
  if (field.kind === "text") {
    return (
      <Box flexDirection="column">
        <Text color={focused ? theme.colors.focusRing : theme.colors.foreground}>{field.label}</Text>
        <ClickTarget id={`field-${field.id}`} disabled={disabled} focused={focused} onClick={onFocus} bordered>
          {String(value || field.placeholder || "")}
        </ClickTarget>
        {error ? <Text color={theme.colors.error} wrap="truncate-end">{error}</Text> : null}
      </Box>
    )
  }
  const options = optionsForField(field, t)
  return (
    <Box flexDirection="column">
      <Text color={focused ? theme.colors.focusRing : theme.colors.foreground}>{field.label}</Text>
      <Box flexDirection="row" flexWrap="wrap">
        {options.map((option) => (
          <ClickTarget
            key={String(option.value)}
            id={`field-${field.id}-${String(option.value)}`}
            disabled={disabled || option.disabled}
            focused={focused}
            selected={option.value === value}
            onClick={() => {
              onFocus()
              onChange(option.value)
            }}
          >
            {option.label}
          </ClickTarget>
        ))}
      </Box>
      {error ? <Text color={theme.colors.error} wrap="truncate-end">{error}</Text> : null}
    </Box>
  )
}

function NumberField({
  field,
  value,
  focused,
  disabled,
  onFocus,
  onChange,
}: {
  field: InteractionField
  value?: InteractionValue
  focused: boolean
  disabled?: boolean
  onFocus: () => void
  onChange: (value: number) => void
}) {
  const theme = useTerminalTheme()
  const ref = useRef<DOMElement>(null)
  useOnClick(ref, disabled ? undefined : onFocus)
  useOnWheel(ref, disabled ? undefined : (event) => {
    const direction = event.button === "wheel-up" ? 1 : event.button === "wheel-down" ? -1 : 0
    if (direction) onChange(stepInteractionNumber(field, value, direction))
  })
  return (
    <Box ref={ref} justifyContent="space-between">
      <Text color={focused ? theme.colors.focusRing : theme.colors.foreground} wrap="truncate-end">{field.label}</Text>
      <Box>
        <ClickTarget disabled={disabled} focused={focused} onClick={() => { onFocus(); onChange(stepInteractionNumber(field, value, -1)) }}>−</ClickTarget>
        <Text bold color={focused ? theme.colors.focusRing : theme.colors.foreground}> {String(value ?? 0)} </Text>
        <ClickTarget disabled={disabled} focused={focused} onClick={() => { onFocus(); onChange(stepInteractionNumber(field, value, 1)) }}>+</ClickTarget>
      </Box>
    </Box>
  )
}

export function WorkbenchButton({
  id: _id,
  children,
  focused,
  selected,
  danger,
  disabled,
  onClick,
}: {
  id?: string
  children: string
  focused?: boolean
  selected?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const theme = useTerminalTheme()
  const ref = useRef<DOMElement>(null)
  const [hovered, setHovered] = useState(false)
  useOnClick(ref, disabled ? undefined : onClick)
  useOnMouseEnter(ref, disabled ? undefined : () => setHovered(true))
  useOnMouseLeave(ref, disabled ? undefined : () => setHovered(false))
  const color = disabled
    ? theme.colors.mutedForeground
    : danger
      ? theme.colors.error
      : focused || hovered || selected
        ? theme.colors.focusRing
        : theme.colors.foreground
  return (
    <Box ref={ref} borderStyle="round" borderColor={color} paddingX={1}>
      <Text bold={focused || hovered || selected} color={color}>{children}</Text>
    </Box>
  )
}

export function ClickTarget({
  id: _id,
  children,
  focused,
  selected,
  disabled,
  bordered,
  onClick,
}: {
  id?: string
  children: string
  focused?: boolean
  selected?: boolean
  disabled?: boolean
  bordered?: boolean
  onClick: () => void
}) {
  const theme = useTerminalTheme()
  const ref = useRef<DOMElement>(null)
  const [hovered, setHovered] = useState(false)
  useOnClick(ref, disabled ? undefined : onClick)
  useOnMouseEnter(ref, disabled ? undefined : () => setHovered(true))
  useOnMouseLeave(ref, disabled ? undefined : () => setHovered(false))
  const active = focused || hovered || selected
  const color = disabled ? theme.colors.mutedForeground : active ? theme.colors.focusRing : theme.colors.mutedForeground
  return (
    <Box ref={ref} paddingX={1} borderStyle={bordered ? "round" : undefined} borderColor={bordered ? color : undefined}>
      <Text color={color} bold={active} inverse={selected || hovered}>{bordered ? children : `${selected ? "●" : "○"} ${children}`}</Text>
    </Box>
  )
}
