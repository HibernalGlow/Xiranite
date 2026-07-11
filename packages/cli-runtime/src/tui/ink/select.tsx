import { Box, Text, useInput } from "ink"
import { useState } from "react"

import type { InteractionOption, InteractionValue } from "../../interaction.js"
import { useTerminalTheme } from "../theme.js"
import { MouseTarget } from "./mouse-target.js"

// Adapted from @termcn/ink/select.
export function Select<Value extends InteractionValue>({
  options,
  value,
  label,
  onSubmit,
}: {
  options: readonly InteractionOption<Value>[]
  value?: Value
  label?: string
  onSubmit: (value: Value) => void
}) {
  const theme = useTerminalTheme()
  const [activeIndex, setActiveIndex] = useState(() => {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    return selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options)
  })

  useInput((_input, key) => {
    if (key.upArrow) setActiveIndex((current) => nextEnabledIndex(options, current, -1))
    if (key.downArrow) setActiveIndex((current) => nextEnabledIndex(options, current, 1))
    if (key.return) {
      const option = options[activeIndex]
      if (option && !option.disabled) onSubmit(option.value)
    }
  })

  return (
    <Box flexDirection="column">
      {label ? <Text bold>{label}</Text> : null}
      {options.map((option, index) => {
        const active = index === activeIndex
        const selected = option.value === value
        const row = (
          <Box gap={1}>
            <Text color={active ? theme.colors.primary : undefined}>{active ? "›" : " "}</Text>
            <Text
              bold={active || selected}
              color={option.disabled ? theme.colors.mutedForeground : active ? theme.colors.primary : theme.colors.foreground}
              dimColor={option.disabled}
            >
              {option.label}
            </Text>
            {option.hint ? <Text color={theme.colors.mutedForeground}>{option.hint}</Text> : null}
          </Box>
        )
        return option.disabled ? (
          <Box key={`${String(option.value)}-${index}`}>{row}</Box>
        ) : (
          <MouseTarget
            key={`${String(option.value)}-${index}`}
            onClick={() => {
              setActiveIndex(index)
              onSubmit(option.value)
            }}
          >
            {row}
          </MouseTarget>
        )
      })}
    </Box>
  )
}

function firstEnabledIndex<Value extends InteractionValue>(options: readonly InteractionOption<Value>[]): number {
  const index = options.findIndex((option) => !option.disabled)
  return Math.max(0, index)
}

function nextEnabledIndex<Value extends InteractionValue>(
  options: readonly InteractionOption<Value>[],
  current: number,
  direction: -1 | 1,
): number {
  let next = current + direction
  while (next >= 0 && next < options.length && options[next]?.disabled) next += direction
  return next < 0 || next >= options.length ? current : next
}
