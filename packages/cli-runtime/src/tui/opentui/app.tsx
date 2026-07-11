/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useMemo } from "react"

import type { InteractionField, InteractionValue, TerminalInteractionDefinition } from "../../interaction.js"
import { createTerminalTranslator, type TerminalLanguage, type TerminalTranslator } from "../i18n.js"
import {
  fieldsForViewSection,
  nextInteractionValue,
  resolveInteractionView,
  stepInteractionNumber,
} from "../screen.js"
import { useTerminalUiSession } from "../session.js"
import { resolveTerminalTheme, TerminalThemeProvider, useTerminalTheme } from "../theme.js"
import { ProgressBar } from "./progress-bar.js"
import { ClickTarget, WorkbenchButton, WorkbenchField, WorkbenchPanel } from "./workbench-controls.js"

export function OpenTuiTerminalApp<Input, Result>({
  definition,
  language,
  theme,
  onExit,
}: {
  definition: TerminalInteractionDefinition<Input, Result>
  language: TerminalLanguage
  theme?: string
  onExit: () => void
}) {
  const t = createTerminalTranslator(language)
  return (
    <TerminalThemeProvider theme={resolveTerminalTheme(theme)}>
      <OpenTuiTerminalScreen definition={definition} onExit={onExit} t={t} />
    </TerminalThemeProvider>
  )
}

function OpenTuiTerminalScreen<Input, Result>({
  definition,
  onExit,
  t,
}: {
  definition: TerminalInteractionDefinition<Input, Result>
  onExit: () => void
  t: TerminalTranslator
}) {
  const theme = useTerminalTheme()
  const session = useTerminalUiSession(definition)
  const view = resolveInteractionView(definition.schema, session.values, t)
  const primarySection = view.sections[0]
  const executionSection = view.sections[1]
  const primaryFields = fieldsForViewSection(session.fields, primarySection?.fieldIds ?? [])
  const executionFields = fieldsForViewSection(session.fields, executionSection?.fieldIds ?? [])
  const display = view.dashboard.display(session.values)
  const controlIds = useMemo(
    () => [...session.fields.map((field) => field.id), "execute", "reset", "tab-status", "tab-logs", "exit"],
    [session.fields],
  )

  useKeyboard((key) => {
    const focusedField = session.fields.find((field) => field.id === session.focusedControlId)
    const editingText = focusedField?.kind === "text"
    if (key.name === "escape") {
      if (session.confirming) session.dismissConfirmation()
      else if (session.phase === "running") session.cancel()
      else onExit()
      return
    }
    if (key.name === "tab") {
      session.moveFocus(controlIds, key.shift ? -1 : 1)
      return
    }
    if (key.name === "q" && !editingText && session.phase !== "running") {
      onExit()
      return
    }
    if (focusedField) {
      if (focusedField.kind === "text") return
      handleFieldKeyboard(focusedField, session.values[focusedField.id], key, t, session.setField)
      return
    }
    if (key.name === "return" || key.name === "space" || key.sequence === " ") {
      activateControl(session.focusedControlId, session, onExit)
    }
  })

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
      <box flexDirection="row" justifyContent="space-between" height={4} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1}>
        <box flexDirection="column">
          <text fg={theme.colors.primary}><b>{`${definition.schema.title.toUpperCase()} // NATIVE CONTROL PLANE`}</b></text>
          <text fg={theme.colors.mutedForeground}>{definition.schema.description}</text>
        </box>
        <box flexDirection="column" alignItems="flex-end">
          <text fg={phaseColor(session.phase, theme)}><b>{phaseLabel(session.phase, t).toUpperCase()}</b></text>
          <text fg={theme.colors.mutedForeground}>OpenTUI · native widgets · buffered</text>
        </box>
      </box>
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
        <WorkbenchPanel title={primarySection?.title ?? t("parameters")} description={primarySection?.description} width="34%">
          <FieldList fields={primaryFields} session={session} t={t} />
        </WorkbenchPanel>

        <box flexDirection="column" flexGrow={1} minWidth={0} gap={1}>
          <WorkbenchPanel title={view.dashboard.title} description={view.dashboard.description} flexGrow={1}>
            <box flexDirection="row" flexGrow={1} minHeight={0}>
              <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} minWidth={0}>
                {/^[0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(display.primary)
                  ? <ascii-font text={display.primary} font="grid" color={[theme.colors.primary, theme.colors.focusRing]} />
                  : <text fg={theme.colors.primary}><b>{display.primary}</b></text>}
                {display.secondary ? <text fg={theme.colors.mutedForeground}>{`[ ${display.secondary} ]`}</text> : null}
              </box>
              <box flexDirection="column" width="42%" justifyContent="center">
                {display.metrics?.map((metric) => (
                  <box key={metric.label} flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.colors.mutedForeground}>{metric.label}</text>
                    <text fg={theme.colors.foreground}><b>{metric.value}</b></text>
                  </box>
                ))}
              </box>
            </box>
            <box flexDirection="row" gap={1}>
              {session.preview.slice(0, 3).map((line, index) => <text key={`${line}-${index}`} fg={index === 0 ? theme.colors.foreground : theme.colors.mutedForeground}>{`${index === 0 ? "›" : "·"} ${line}`}</text>)}
            </box>
          </WorkbenchPanel>

          <box flexDirection="row" height={12} gap={1}>
            <WorkbenchPanel title={session.confirming ? session.dangerPrompt?.title ?? t("confirmLiveTitle") : executionSection?.title ?? t("execution")} width="42%">
              {session.confirming ? (
                <Confirmation session={session} t={t} />
              ) : (
                <>
                  <FieldList fields={executionFields} session={session} t={t} />
                  <box flexDirection="column" marginTop={1}>
                    <WorkbenchButton
                      id="execute"
                      focused={session.focusedControlId === "execute"}
                      danger={session.dangerous}
                      onClick={() => session.phase === "running" ? session.cancel() : void session.requestExecute()}
                    >
                      {executeLabel(session, t)}
                    </WorkbenchButton>
                    <box flexDirection="row" gap={1}>
                      <ClickTarget id="reset" focused={session.focusedControlId === "reset"} onClick={session.reset}>{t("resetParameters")}</ClickTarget>
                      <ClickTarget id="exit" focused={session.focusedControlId === "exit"} onClick={onExit}>{t("exit")}</ClickTarget>
                    </box>
                  </box>
                </>
              )}
            </WorkbenchPanel>

            <WorkbenchPanel title="" flexGrow={1}>
              <box flexDirection="row" justifyContent="space-between">
                <box flexDirection="row" gap={1}>
                  <ClickTarget id="tab-status" focused={session.focusedControlId === "tab-status"} selected={session.resultTab === "status"} onClick={() => session.selectResultTab("status")}>{t("statusTab")}</ClickTarget>
                  <ClickTarget id="tab-logs" focused={session.focusedControlId === "tab-logs"} selected={session.resultTab === "logs"} onClick={() => session.selectResultTab("logs")}>{`${t("logsTab")} (${session.logs.length})`}</ClickTarget>
                </box>
                <text fg={theme.colors.mutedForeground}>{session.phase === "running" ? "ESC = STOP" : "TAB / MOUSE"}</text>
              </box>
              {session.resultTab === "logs" ? (
                <scrollbox focused={session.focusedControlId === "tab-logs"} flexGrow={1} marginTop={1} scrollbarOptions={{ trackOptions: { foregroundColor: theme.colors.primary, backgroundColor: theme.colors.border } }}>
                  {session.logs.length
                    ? session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")}  ${line}`}</text>)
                    : <text fg={theme.colors.mutedForeground}>{t("emptyLogs")}</text>}
                </scrollbox>
              ) : (
                <box flexDirection="column" marginTop={1}>
                  <ProgressBar value={session.progress} label={session.status || t("waitingForRun")} />
                  {session.error ? <text fg={theme.colors.error}>{session.error}</text> : null}
                  {session.resultSummary ? <text fg={session.resultSummary.success ? theme.colors.success : theme.colors.error}>{session.resultSummary.message}</text> : null}
                  {session.resultSummary?.lines.slice(0, 2).map((line, index) => <text key={`${line}-${index}`}>{line}</text>)}
                </box>
              )}
            </WorkbenchPanel>
          </box>
        </box>
      </box>
    </box>
  )
}

function FieldList({
  fields,
  session,
  t,
}: {
  fields: readonly InteractionField[]
  session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>
  t: TerminalTranslator
}) {
  return (
    <box flexDirection="column">
      {fields.map((field) => (
        <WorkbenchField
          key={field.id}
          field={field}
          value={session.values[field.id]}
          error={session.fieldErrors[field.id]}
          focused={session.focusedControlId === field.id}
          disabled={session.phase === "running"}
          t={t}
          onFocus={() => session.focus(field.id)}
          onChange={(value) => session.setField(field.id, value)}
        />
      ))}
    </box>
  )
}

function Confirmation({
  session,
  t,
}: {
  session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>
  t: TerminalTranslator
}) {
  const theme = useTerminalTheme()
  return (
    <box flexDirection="column">
      <text fg={theme.colors.error}>{session.dangerPrompt?.body ?? t("confirmLiveBody")}</text>
      <box flexDirection="column" marginTop={1}>
        <WorkbenchButton id="confirm-execute" danger focused={session.focusedControlId === "confirm-execute"} onClick={() => void session.confirmExecute()}>{session.dangerPrompt?.confirmLabel ?? t("confirmLiveAction")}</WorkbenchButton>
        <box>
          <ClickTarget id="confirm-dismiss" onClick={session.dismissConfirmation}>{t("dismiss")}</ClickTarget>
        </box>
      </box>
    </box>
  )
}

function handleFieldKeyboard(
  field: InteractionField,
  value: InteractionValue | undefined,
  key: { name: string; sequence: string },
  t: TerminalTranslator,
  setField: (fieldId: string, value: InteractionValue) => void,
) {
  if (field.kind === "select" || field.kind === "boolean") {
    const direction = key.name === "left" || key.name === "up" ? -1 : key.name === "right" || key.name === "down" || key.name === "return" || key.name === "space" || key.sequence === " " ? 1 : 0
    if (direction) {
      const next = nextInteractionValue(field, value, direction, t)
      if (next !== undefined) setField(field.id, next)
    }
    return
  }
  if (field.kind === "number") {
    const direction = key.name === "up" || key.name === "right" ? 1 : key.name === "down" || key.name === "left" ? -1 : 0
    if (direction) setField(field.id, stepInteractionNumber(field, value, direction))
    return
  }
  if (key.name === "backspace" || key.name === "delete") {
    setField(field.id, String(value ?? "").slice(0, -1))
  } else if (key.sequence && key.sequence.length === 1 && key.name !== "return") {
    setField(field.id, `${String(value ?? "")}${key.sequence}`)
  }
}

function activateControl<Result>(
  controlId: string | undefined,
  session: ReturnType<typeof useTerminalUiSession<unknown, Result>>,
  onExit: () => void,
) {
  if (controlId === "execute") void session.requestExecute()
  if (controlId === "reset") session.reset()
  if (controlId === "tab-status") session.selectResultTab("status")
  if (controlId === "tab-logs") session.selectResultTab("logs")
  if (controlId === "exit") onExit()
  if (controlId === "confirm-execute") void session.confirmExecute()
}

function executeLabel(session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>, t: TerminalTranslator): string {
  if (session.phase === "running") return t("stopAction")
  const dryRunField = session.fields.find((field) => field.kind === "boolean" && /dry/i.test(field.id))
  if (dryRunField && session.values[dryRunField.id] === true) return t("dryRunAction")
  return session.dangerous ? t("liveAction") : t("run")
}

function phaseLabel(phase: ReturnType<typeof useTerminalUiSession<unknown, unknown>>["phase"], t: TerminalTranslator) {
  if (phase === "running") return t("running")
  if (phase === "result") return t("statusTab")
  return t("ready")
}

function phaseColor(phase: ReturnType<typeof useTerminalUiSession<unknown, unknown>>["phase"], theme: ReturnType<typeof useTerminalTheme>) {
  if (phase === "running") return theme.colors.warning
  if (phase === "result") return theme.colors.success
  return theme.colors.mutedForeground
}
