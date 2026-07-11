/* @jsxImportSource @opentui/react */
import { useState, type ReactNode } from "react"

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
  width?: number | `${number}%`
  flexGrow?: number
}) {
  const theme = useTerminalTheme()
  return (
    <box
      flexDirection="column"
      borderStyle="rounded"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
      width={width}
      flexGrow={flexGrow}
      overflow="hidden"
    >
      {title ? <box flexShrink={0}><text fg={theme.colors.primary}><b>{title}</b></text></box> : null}
      {description ? <box flexShrink={0}><text fg={theme.colors.mutedForeground}>{description}</text></box> : null}
      <box flexDirection="column" marginTop={description ? 1 : 0} flexGrow={1} overflow="hidden">
        {children}
      </box>
    </box>
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
      <box
        id={`field-${field.id}`}
        flexDirection="row"
        justifyContent="space-between"
        onMouseDown={disabled ? undefined : onFocus}
        onMouseScroll={disabled ? undefined : (event) => {
          const direction = event.scroll?.direction === "up" ? 1 : event.scroll?.direction === "down" ? -1 : 0
          if (direction) onChange(stepInteractionNumber(field, value, direction))
        }}
      >
        <text fg={focused ? theme.colors.focusRing : theme.colors.foreground}>{field.label}</text>
        <box flexDirection="row">
          <ClickTarget id={`field-${field.id}-minus`} disabled={disabled} focused={focused} onClick={() => { onFocus(); onChange(stepInteractionNumber(field, value, -1)) }}>−</ClickTarget>
          <text fg={focused ? theme.colors.focusRing : theme.colors.foreground}><b>{` ${String(value ?? 0)} `}</b></text>
          <ClickTarget id={`field-${field.id}-plus`} disabled={disabled} focused={focused} onClick={() => { onFocus(); onChange(stepInteractionNumber(field, value, 1)) }}>+</ClickTarget>
        </box>
      </box>
    )
  }
  if (field.kind === "text") {
    return (
      <box flexDirection="column" minHeight={4} onMouseDown={disabled ? undefined : onFocus}>
        <text fg={focused ? theme.colors.focusRing : theme.colors.foreground}>{field.label}</text>
        <box id={`field-${field.id}`} borderStyle="rounded" borderColor={focused ? theme.colors.focusRing : theme.colors.border} height={3} paddingLeft={1} paddingRight={1}>
          <input
            value={String(value ?? "")}
            placeholder={field.placeholder ?? ""}
            focused={focused && !disabled}
            onInput={disabled ? undefined : onChange}
          />
        </box>
        {error ? <text fg={theme.colors.error}>{error}</text> : null}
      </box>
    )
  }
  return (
    <box flexDirection="column" minHeight={3}>
      <text fg={focused ? theme.colors.focusRing : theme.colors.foreground}>{field.label}</text>
      <box flexDirection="row" flexWrap="wrap" minHeight={1}>
        {optionsForField(field, t).map((option) => (
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
      </box>
      {error ? <text fg={theme.colors.error}>{error}</text> : null}
    </box>
  )
}

export function WorkbenchButton({
  id,
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
  const [hovered, setHovered] = useState(false)
  const color = disabled
    ? theme.colors.mutedForeground
    : danger
      ? theme.colors.error
      : focused || hovered || selected
        ? theme.colors.focusRing
        : theme.colors.foreground
  return (
    <box
      id={id}
      borderStyle="rounded"
      borderColor={color}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={disabled ? undefined : onClick}
      onMouseOver={disabled ? undefined : () => setHovered(true)}
      onMouseOut={disabled ? undefined : () => setHovered(false)}
    >
      <text fg={color}>{focused || hovered || selected ? <b>{children}</b> : children}</text>
    </box>
  )
}

export function ClickTarget({
  id,
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
  const [hovered, setHovered] = useState(false)
  const active = focused || hovered || selected
  const color = disabled ? theme.colors.mutedForeground : active ? theme.colors.focusRing : theme.colors.mutedForeground
  const label = bordered ? children : `${selected ? "●" : "○"} ${children}`
  return (
    <box
      id={id}
      paddingLeft={1}
      paddingRight={1}
      borderStyle={bordered ? "rounded" : undefined}
      borderColor={bordered ? color : undefined}
      onMouseDown={disabled ? undefined : onClick}
      onMouseOver={disabled ? undefined : () => setHovered(true)}
      onMouseOut={disabled ? undefined : () => setHovered(false)}
    >
      <text fg={color}>{active ? <b>{label}</b> : label}</text>
    </box>
  )
}
