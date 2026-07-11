/* @jsxImportSource @opentui/react */
import type { TerminalViewTable } from "../../interaction.js"
import { useTerminalTheme } from "../theme.js"

export function PreviewTable({ table, maxRows = 8 }: { table: TerminalViewTable; maxRows?: number }) {
  const theme = useTerminalTheme()
  const rows = table.rows.slice(0, maxRows)
  return (
    <box flexDirection="column" minHeight={0} flexGrow={1}>
      <box flexDirection="row" borderStyle="single" borderColor={theme.colors.border}>
        {table.columns.map((column) => (
          <box key={column.id} width={column.width} flexGrow={column.width ? 0 : 1} minWidth={0} paddingLeft={1} paddingRight={1}>
            <text fg={theme.colors.primary}><b>{column.label}</b></text>
          </box>
        ))}
      </box>
      {rows.length ? rows.map((row, rowIndex) => (
        <box key={rowIndex} flexDirection="row" borderColor={theme.colors.border}>
          {table.columns.map((column) => (
            <box key={column.id} width={column.width} flexGrow={column.width ? 0 : 1} minWidth={0} paddingLeft={1} paddingRight={1}>
              <text fg={rowIndex === 0 ? theme.colors.foreground : theme.colors.mutedForeground}>{row[column.id] ?? ""}</text>
            </box>
          ))}
        </box>
      )) : <text fg={theme.colors.mutedForeground}>{table.emptyMessage ?? "—"}</text>}
      {table.rows.length > rows.length ? <text fg={theme.colors.mutedForeground}>{`… +${table.rows.length - rows.length}`}</text> : null}
    </box>
  )
}
