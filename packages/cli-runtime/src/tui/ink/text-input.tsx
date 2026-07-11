import { Box, Text, useFocus, useInput } from "ink"
import { useEffect, useState } from "react"

import { useTerminalTheme } from "../theme.js"

// Adapted from @termcn/ink/text-input.
export function TextInput({
  value,
  label,
  placeholder = "",
  error,
  onChange,
  onSubmit,
}: {
  value: string
  label?: string
  placeholder?: string
  error?: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}) {
  const theme = useTerminalTheme()
  const { isFocused } = useFocus({ autoFocus: true })
  const [cursorOffset, setCursorOffset] = useState(value.length)

  useEffect(() => {
    setCursorOffset((current) => Math.min(current, value.length))
  }, [value.length])

  useInput((input, key) => {
    if (!isFocused || key.upArrow || key.downArrow || key.tab || key.escape || (key.ctrl && input === "c")) return
    if (key.return) {
      onSubmit(value)
      return
    }
    if (key.leftArrow) {
      setCursorOffset((current) => Math.max(0, current - 1))
      return
    }
    if (key.rightArrow) {
      setCursorOffset((current) => Math.min(value.length, current + 1))
      return
    }
    if (key.backspace || key.delete) {
      if (cursorOffset <= 0) return
      onChange(value.slice(0, cursorOffset - 1) + value.slice(cursorOffset))
      setCursorOffset((current) => Math.max(0, current - 1))
      return
    }
    if (!input) return
    onChange(value.slice(0, cursorOffset) + input + value.slice(cursorOffset))
    setCursorOffset((current) => current + input.length)
  })

  const content = value || placeholder
  const muted = !value
  const before = content.slice(0, cursorOffset)
  const cursor = content[cursorOffset] ?? " "
  const after = content.slice(cursorOffset + 1)

  return (
    <Box flexDirection="column">
      {label ? <Text bold>{label}</Text> : null}
      <Box borderStyle="round" borderColor={error ? theme.colors.error : theme.colors.focusRing} paddingX={1} width={48}>
        <Text color={muted ? theme.colors.mutedForeground : theme.colors.foreground}>
          {before}<Text inverse>{cursor}</Text>{after}
        </Text>
      </Box>
      {error ? <Text color={theme.colors.error}>{error}</Text> : null}
    </Box>
  )
}
