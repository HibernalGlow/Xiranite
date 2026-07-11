import { Box, Text } from "ink"

import { useTerminalTheme } from "../theme.js"

// Adapted from @termcn/ink/progress-bar.
export function ProgressBar({ value, width = 30, label }: { value: number; width?: number; label?: string }) {
  const theme = useTerminalTheme()
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  const filled = Math.round((percent / 100) * width)
  return (
    <Box flexDirection="column">
      {label ? <Text>{label}</Text> : null}
      <Box gap={1}>
        <Text color={theme.colors.primary}>{"█".repeat(filled)}{"░".repeat(width - filled)}</Text>
        <Text color={theme.colors.mutedForeground}>{percent}%</Text>
      </Box>
    </Box>
  )
}
