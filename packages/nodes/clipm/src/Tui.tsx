/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useMemo, useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import {
  ActionTabs,
  ClickTarget,
  ExecutionActions,
  ProgressBar,
  TerminalTaskQueueScreen,
  TerminalThemeProvider,
  WorkbenchField,
  WorkbenchPanel,
  resolveTerminalTheme,
  terminalIcon,
  useTerminalChromeActions,
  useTerminalTheme,
  useTerminalUiSession,
} from "@xiranite/cli-runtime/terminal/opentui"
import type { ClipmInput, ClipmResult } from "./core.js"

export function ClipmTui(props: TerminalUiScreenProps<ClipmInput, ClipmResult>): import("react").ReactNode {
  const [previewTheme, setPreviewTheme] = useState(props.theme ?? props.preferences?.current.theme ?? "inherit")
  return <TerminalThemeProvider theme={resolveTerminalTheme(previewTheme === "inherit" ? "nord" : previewTheme)}><ClipmWorkbench {...props} onThemePreview={setPreviewTheme} /></TerminalThemeProvider>
}

function ClipmWorkbench({ definition, language, preferences, taskQueue, onExit, onThemePreview }: TerminalUiScreenProps<ClipmInput, ClipmResult> & { onThemePreview: (theme: string) => void }) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const sections = visibleSections(definition.schema.view?.sections ?? [], session.fields)
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? "")
  const [showTasks, setShowTasks] = useState(false)
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]
  const tableRows = session.resultSummary?.table?.rows ?? []
  const controlIds = useMemo(() => ["section-tabs", ...(activeSection?.fields.map((field) => field.id) ?? []), "execute", "reset", "tasks", "exit"], [activeSection])

  useTerminalChromeActions({ onReset: session.reset, onExit, resetLabel: `${terminalIcon("result")} RESET`, exitLabel: "X EXIT" })
  useKeyboard((key) => {
    if (key.name === "escape") {
      if (showTasks) setShowTasks(false)
      else if (session.confirming) session.dismissConfirmation()
      else if (session.phase === "running" || session.phase === "paused") void session.cancel()
      else onExit()
      return
    }
    if (key.name === "f6") {
      setShowTasks(true)
      return
    }
    if (key.name === "tab") {
      session.moveFocus(controlIds, key.shift ? -1 : 1)
    }
  })

  if (showTasks && taskQueue) return <TerminalTaskQueueScreen controller={taskQueue} nodeId="clipm" onBack={() => setShowTasks(false)} />

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
      <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column">
          <text fg={theme.colors.primary}><b>{`${terminalIcon("status")} CLIPM // PREFERENCE CONTROL PLANE`}</b></text>
          <text fg={theme.colors.mutedForeground}>{definition.schema.description}</text>
        </box>
        <box flexDirection="column" alignItems="flex-end">
          <text fg={phaseColor(session.phase, theme)}><b>{session.phase.toUpperCase()}</b></text>
          <box flexDirection="row" gap={1}>
            {taskQueue ? <ClickTarget id="clipm-tasks" selected={showTasks} onClick={() => setShowTasks(true)}>{`${terminalIcon("status")} TASKS F6`}</ClickTarget> : null}
            {preferences ? <ClickTarget id="clipm-settings" onClick={() => onThemePreview(preferences.current.theme)}>{`${terminalIcon("settings")} CONFIG`}</ClickTarget> : null}
          </box>
        </box>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
        <WorkbenchPanel title="Parameters" width="42%">
          <ActionTabs id="section-tabs" options={sections.map((section) => ({ value: section.id, label: section.title, hint: section.description }))} value={activeSection?.id} focused={session.focusedControlId === "section-tabs"} disabled={session.phase === "running" || session.phase === "paused"} onFocus={() => session.focus("section-tabs")} onChange={(value) => setActiveSectionId(String(value))} />
          <scrollbox flexGrow={1} minHeight={0} focused={activeSection?.fields.some((field) => field.id === session.focusedControlId)}>
            {activeSection?.fields.map((field) => <WorkbenchField key={field.id} field={field} value={session.values[field.id]} error={session.fieldErrors[field.id]} focused={session.focusedControlId === field.id} disabled={session.phase === "running" || session.phase === "paused"} t={t} onFocus={() => session.focus(field.id)} onChange={(value) => session.setField(field.id, value)} />)}
          </scrollbox>
        </WorkbenchPanel>

        <WorkbenchPanel title="Result" description="Latest ClipM result and streamed progress" flexGrow={1}>
          <box flexDirection="column" flexGrow={1} minHeight={0}>
            <text fg={theme.colors.primary}><b>{String(session.values.action ?? "score")}</b></text>
            <text fg={theme.colors.mutedForeground}>{session.preview[0] ?? "Ready"}</text>
            <scrollbox flexGrow={1} minHeight={4} marginTop={1}>
              {session.resultSummary ? session.resultSummary.lines.map((line, index) => <text key={`${line}-${index}`}>{line}</text>) : null}
              {tableRows.slice(0, 40).map((row, index) => <text key={`row-${index}`} fg={theme.colors.mutedForeground}>{Object.values(row).join(" | ")}</text>)}
              {!session.resultSummary && !tableRows.length ? session.preview.map((line, index) => <text key={`${line}-${index}`} fg={index === 0 ? theme.colors.foreground : theme.colors.mutedForeground}>{`${index === 0 ? "$" : "-"} ${line}`}</text>) : null}
              {session.resultSummary?.message ? <text fg={session.resultSummary.success ? theme.colors.success : theme.colors.error}>{session.resultSummary.message}</text> : null}
            </scrollbox>
            <ProgressBar value={session.progress} label={session.status || "READY"} />
          </box>
        </WorkbenchPanel>
      </box>

      <box height={9} flexShrink={0} marginTop={1} flexDirection="row" gap={1}>
        <WorkbenchPanel title={session.confirming ? session.dangerPrompt?.title ?? "Confirm" : "Execution"} width="42%">
          {session.confirming ? <box flexDirection="column"><text fg={theme.colors.error}>{session.dangerPrompt?.body}</text><ExecutionActions session={session} confirmLabel="CONFIRM" /></box> : <box flexDirection="column" justifyContent="flex-end" flexGrow={1}><text fg={session.dangerous ? theme.colors.error : theme.colors.mutedForeground}>{session.dangerous ? "This action writes state." : session.preview[0] ?? "Ready"}</text><ExecutionActions session={session} executeLabel="RUN" confirmLabel="CONFIRM" /></box>}
        </WorkbenchPanel>
        <WorkbenchPanel title={`Logs (${session.logs.length})`} flexGrow={1}>
          <scrollbox flexGrow={1}>{session.logs.length ? session.logs.slice(-12).map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${line}`}</text>) : <text fg={theme.colors.mutedForeground}>No events yet.</text>}</scrollbox>
        </WorkbenchPanel>
      </box>
    </box>
  )
}

function visibleSections(sections: readonly { id: string; title: string; description?: string; fieldIds: readonly string[] }[], fields: readonly import("@xiranite/cli-runtime/interaction").InteractionField[]) {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const assigned = new Set<string>()
  const visible = sections.flatMap((section) => {
    const sectionFields = section.fieldIds.flatMap((id) => {
      const field = byId.get(id)
      if (!field) return []
      assigned.add(id)
      return [field]
    })
    return sectionFields.length ? [{ ...section, fields: sectionFields }] : []
  })
  const remaining = fields.filter((field) => !assigned.has(field.id))
  return remaining.length ? [...visible, { id: "other", title: "Other", fields: remaining, fieldIds: remaining.map((field) => field.id) }] : visible
}

function phaseColor(phase: ReturnType<typeof useTerminalUiSession<unknown, unknown>>["phase"], theme: ReturnType<typeof useTerminalTheme>) {
  return phase === "running" ? theme.colors.warning : phase === "result" ? theme.colors.success : theme.colors.mutedForeground
}
