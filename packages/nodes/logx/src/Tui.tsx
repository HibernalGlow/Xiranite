/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionLauncher, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { LogxInput, LogxResult } from "./core.js"

export function LogxTui(props: TerminalUiScreenProps<LogxInput, LogxResult>): import('react').ReactNode {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><Workbench {...props} /></TerminalThemeProvider>
}

function Workbench({ definition, language, onExit }: TerminalUiScreenProps<LogxInput, LogxResult>) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const data = session.result?.data
  const [selectedIndex, setSelectedIndex] = useState(0)
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => {
    if (key.name === "escape") onExit()
    if (key.name === "up") setSelectedIndex((value) => Math.max(0, value - 1))
    if (key.name === "down") setSelectedIndex((value) => Math.min(Math.max(0, (data?.events.length ?? 1) - 1), value + 1))
  })
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const Field = ({ id }: { id: string }) => <WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} />
  const selected = data?.events[selectedIndex]
  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} LOGX // STRUCTURED LOG WORKBENCH`}</b></text><text fg={theme.colors.mutedForeground}>JSONL · sessions · resources · errors · query core</text></box>
      <box alignItems="flex-end"><text fg={data?.issues.length ? theme.colors.warning : theme.colors.success}>{data ? `${data.matchedCount} MATCHED` : "READY"}</text><text fg={theme.colors.mutedForeground}>{data?.directory ?? "default log directory"}</text></box>
    </box>
    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between"><ActionLauncher id="logx-action" field={field("action")} session={session} />{session.confirming || session.phase === "running" ? <ExecutionActions session={session} /> : <text fg={theme.colors.mutedForeground}>{`files ${data?.files.length ?? 0} · sessions ${data?.sessions.length ?? 0} · issues ${data?.issues.length ?? 0}`}</text>}</box>
    <box height={10} flexShrink={0} marginTop={1} flexDirection="row" gap={1}>
      <WorkbenchPanel title="SOURCE & SEVERITY" description="Directory and ordered query" width="36%"><box height={4}><Field id="directory" /></box><box flexDirection="row" gap={1}><box width="50%"><Field id="minimumSeverity" /></box><box flexGrow={1}><Field id="order" /></box></box></WorkbenchPanel>
      <WorkbenchPanel title="STRUCTURED FILTERS" description="Scope, event, session, and text" flexGrow={1}><box flexDirection="row" gap={1}><box width="30%"><Field id="scope" /></box><box width="30%"><Field id="eventName" /></box><box flexGrow={1}><Field id="sessionId" /></box></box><box flexDirection="row" gap={1}><box flexGrow={1}><Field id="search" /></box><box width="18%"><Field id="limit" /></box></box></WorkbenchPanel>
    </box>
    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <WorkbenchPanel title={`EVENT STREAM · ${data?.returnedCount ?? 0}/${data?.matchedCount ?? 0}`} description="Use arrow keys to inspect" width="62%">
        <box height={2} flexShrink={0} flexDirection="row"><box width="16%"><text fg={theme.colors.mutedForeground}>TIME</text></box><box width="10%"><text fg={theme.colors.mutedForeground}>LEVEL</text></box><box width="28%"><text fg={theme.colors.mutedForeground}>SCOPE</text></box><text fg={theme.colors.mutedForeground}>EVENT</text></box>
        <scrollbox flexGrow={1}>{data?.events.length ? data.events.map((event, index) => <box key={event.id} height={1} flexShrink={0} flexDirection="row"><box width="16%"><text fg={index === selectedIndex ? theme.colors.focusRing : theme.colors.mutedForeground}>{`${index === selectedIndex ? ">" : " "}${event.timestamp.slice(11, 19)}`}</text></box><box width="10%"><text fg={severityColor(event.severityText, theme)}>{event.severityText.toUpperCase()}</text></box><box width="28%"><text>{event.scope.name}</text></box><text>{event.eventName}</text></box>) : <text fg={theme.colors.mutedForeground}>Run a query to load structured events.</text>}</scrollbox>
      </WorkbenchPanel>
      <box flexGrow={1} minWidth={0} flexDirection="column" gap={1}>
        <WorkbenchPanel title="EVENT DETAIL" description={selected?.id ?? "No event selected"} flexGrow={1}><scrollbox flexGrow={1}>{selected ? <><text fg={theme.colors.primary}><b>{selected.eventName}</b></text><text fg={theme.colors.mutedForeground}>{`${selected.timestamp} · ${selected.scope.name}`}</text><text>{selected.body ?? "(no body)"}</text>{selected.error ? <text fg={theme.colors.error}>{`${selected.error.name}: ${selected.error.message}\n${selected.error.stack ?? ""}`}</text> : null}<text fg={theme.colors.mutedForeground}>{JSON.stringify(selected.attributes, null, 2)}</text></> : <text fg={theme.colors.mutedForeground}>Select an event to inspect its envelope.</text>}</scrollbox></WorkbenchPanel>
        <box height={9} flexShrink={0}><WorkbenchPanel title="STORM / ANOMALY" description="Shared telemetry model" flexGrow={1}><text fg={theme.colors.primary}><b>{`${formatRate(data?.telemetry.eventsPerSecond ?? 0)} EVENTS/S`}</b></text><text>{anomalyBar(data?.telemetry.anomalyCells.map((cell) => cell.intensity) ?? [])}</text><text fg={theme.colors.warning}>{`warn ${data?.aggregate.bySeverity.warn ?? 0} · error ${data?.aggregate.bySeverity.error ?? 0} · fatal ${data?.aggregate.bySeverity.fatal ?? 0}`}</text><ProgressBar value={session.progress} label={session.status || "LOGX READY"} /></WorkbenchPanel></box>
      </box>
    </box>
  </box>
}

function formatRate(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function anomalyBar(values: readonly number[]): string {
  const levels = ["·", "░", "▒", "▓", "█"]
  return `ANOMALY ${values.map((value) => levels[Math.min(4, Math.ceil(value * 4))]).join("") || "················"}`
}

function severityColor(severity: string, theme: ReturnType<typeof useTerminalTheme>): string {
  if (severity === "error" || severity === "fatal") return theme.colors.error
  if (severity === "warn") return theme.colors.warning
  if (severity === "debug" || severity === "trace") return theme.colors.mutedForeground
  return theme.colors.primary
}
