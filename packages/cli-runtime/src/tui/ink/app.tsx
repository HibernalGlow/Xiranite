import { MouseProvider } from "@ink-tools/ink-mouse"
import { Box, Text, useInput, useStdout } from "ink"
import { useEffect, useMemo, useState } from "react"

import type { InteractionField, InteractionValue, TerminalInteractionDefinition } from "../../interaction.js"
import { createTerminalTranslator, type TerminalLanguage, type TerminalTranslator } from "../i18n.js"
import {
  fieldsForWorkbenchPanel,
  nextInteractionValue,
  resolveWorkbenchLayout,
  stepInteractionNumber,
} from "../screen.js"
import { useTerminalUiSession } from "../session.js"
import { resolveTerminalTheme, TerminalThemeProvider, useTerminalTheme } from "../theme.js"
import { ProgressBar } from "./progress-bar.js"
import { ClickTarget, WorkbenchButton, WorkbenchField, WorkbenchPanel } from "./workbench-controls.js"

export function InkTerminalApp<Input, Result>({
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
      <MouseProvider autoEnable cacheInvalidationMs={16}>
        <InkTerminalScreen definition={definition} onExit={onExit} t={t} />
      </MouseProvider>
    </TerminalThemeProvider>
  )
}

function InkTerminalScreen<Input, Result>({
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
  const { columns, rows } = useTerminalSize()
  const layout = resolveWorkbenchLayout(definition.schema, session.values, t)
  const leftFields = fieldsForWorkbenchPanel(session.fields, layout.left.fieldIds)
  const rightFields = fieldsForWorkbenchPanel(session.fields, layout.right.fieldIds)
  const display = layout.center.display(session.values)
  const controlIds = useMemo(
    () => [...session.fields.map((field) => field.id), "execute", "reset", "tab-status", "tab-logs", "exit"],
    [session.fields],
  )

  useInput((input, key) => {
    const focusedField = session.fields.find((field) => field.id === session.focusedControlId)
    const editingText = focusedField?.kind === "text"
    if (key.escape) {
      if (session.confirming) session.dismissConfirmation()
      else if (session.phase === "running") session.cancel()
      else onExit()
      return
    }
    if (key.tab) {
      session.moveFocus(controlIds, key.shift ? -1 : 1)
      return
    }
    if (input === "q" && !editingText && session.phase !== "running") {
      onExit()
      return
    }
    if (focusedField) {
      handleFieldKeyboard(focusedField, session.values[focusedField.id], input, key, t, session.setField)
      return
    }
    if (key.return || input === " ") {
      activateControl(session.focusedControlId, session, onExit)
    }
  })

  const bottomHeight = Math.max(6, Math.min(8, Math.floor(rows * 0.3)))
  return (
    <Box width={columns} height={Math.max(1, rows - 2)} flexDirection="column" paddingX={1} overflow="hidden">
      <Box justifyContent="space-between" height={2}>
        <Box gap={1}>
          <Text bold color={theme.colors.primary}>{definition.schema.title}</Text>
          <Text color={phaseColor(session.phase, theme)}>{phaseLabel(session.phase, t)}</Text>
        </Box>
        <Text color={theme.colors.mutedForeground}>{`Ink · ${t("mouseHelp")}`}</Text>
      </Box>
      <Box flexGrow={1} minHeight={0} gap={1}>
        <WorkbenchPanel title={layout.left.title} width="34%">
          <FieldList fields={leftFields} session={session} t={t} />
        </WorkbenchPanel>

        <WorkbenchPanel title={layout.center.title} width="36%">
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text bold color={theme.colors.primary}>{display.primary}</Text>
            {display.secondary ? <Text color={theme.colors.mutedForeground}>{display.secondary}</Text> : null}
          </Box>
          <Box justifyContent="space-between" flexWrap="wrap">
            {display.metrics?.map((metric) => (
              <Box key={metric.label} flexDirection="column" alignItems="center" paddingX={1}>
                <Text color={theme.colors.mutedForeground}>{metric.label}</Text>
                <Text bold>{metric.value}</Text>
              </Box>
            ))}
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {session.preview.slice(0, 3).map((line, index) => (
              <Text key={`${line}-${index}`} color={theme.colors.mutedForeground} wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        </WorkbenchPanel>

        <WorkbenchPanel title={layout.right.title} width="28%">
          {session.confirming ? (
            <Confirmation session={session} t={t} />
          ) : (
            <>
              <FieldList fields={rightFields} session={session} t={t} />
              <Box flexDirection="column" marginTop={1}>
                <WorkbenchButton
                  id="execute"
                  focused={session.focusedControlId === "execute"}
                  danger={session.dangerous}
                  onClick={() => session.phase === "running" ? session.cancel() : void session.requestExecute()}
                >
                  {executeLabel(session, t)}
                </WorkbenchButton>
                <Box gap={1} marginTop={1}>
                  <ClickTarget id="reset" focused={session.focusedControlId === "reset"} onClick={session.reset}>{t("resetParameters")}</ClickTarget>
                  <ClickTarget id="exit" focused={session.focusedControlId === "exit"} onClick={onExit}>{t("exit")}</ClickTarget>
                </Box>
              </Box>
            </>
          )}
        </WorkbenchPanel>
      </Box>

      <Box height={bottomHeight} marginTop={1}>
        <WorkbenchPanel title="" flexGrow={1}>
          <Box gap={1}>
            <ClickTarget id="tab-status" focused={session.focusedControlId === "tab-status"} selected={session.resultTab === "status"} onClick={() => session.selectResultTab("status")}>{t("statusTab")}</ClickTarget>
            <ClickTarget id="tab-logs" focused={session.focusedControlId === "tab-logs"} selected={session.resultTab === "logs"} onClick={() => session.selectResultTab("logs")}>{`${t("logsTab")} (${session.logs.length})`}</ClickTarget>
          </Box>
          {session.resultTab === "logs" ? (
            <Box flexDirection="column" marginTop={1}>
              {session.logs.length
                ? session.logs.slice(-3).map((line, index) => <Text key={`${line}-${index}`} color={theme.colors.mutedForeground} wrap="truncate-end">{line}</Text>)
                : <Text color={theme.colors.mutedForeground}>{t("emptyLogs")}</Text>}
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <ProgressBar value={session.progress} label={session.status || t("waitingForRun")} />
              {session.error ? <Text color={theme.colors.error}>{session.error}</Text> : null}
              {session.resultSummary ? <Text color={session.resultSummary.success ? theme.colors.success : theme.colors.error}>{session.resultSummary.message}</Text> : null}
              {session.resultSummary?.lines.slice(0, 2).map((line, index) => <Text key={`${line}-${index}`}>{line}</Text>)}
            </Box>
          )}
        </WorkbenchPanel>
      </Box>
    </Box>
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
    <Box flexDirection="column">
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
    </Box>
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
    <Box flexDirection="column">
      <Text bold color={theme.colors.error}>{t("confirmLiveTitle")}</Text>
      <Text color={theme.colors.error} wrap="wrap">{t("confirmLiveBody")}</Text>
      <Box flexDirection="column" marginTop={1}>
        <WorkbenchButton id="confirm-execute" danger focused={session.focusedControlId === "confirm-execute"} onClick={() => void session.confirmExecute()}>{t("confirmLiveAction")}</WorkbenchButton>
        <Box marginTop={1}>
          <ClickTarget id="confirm-dismiss" onClick={session.dismissConfirmation}>{t("dismiss")}</ClickTarget>
        </Box>
      </Box>
    </Box>
  )
}

function handleFieldKeyboard(
  field: InteractionField,
  value: InteractionValue | undefined,
  input: string,
  key: { leftArrow: boolean; rightArrow: boolean; upArrow: boolean; downArrow: boolean; return: boolean; backspace: boolean; delete: boolean },
  t: TerminalTranslator,
  setField: (fieldId: string, value: InteractionValue) => void,
) {
  if (field.kind === "select" || field.kind === "boolean") {
    const direction = key.leftArrow || key.upArrow ? -1 : key.rightArrow || key.downArrow || key.return || input === " " ? 1 : 0
    if (direction) {
      const next = nextInteractionValue(field, value, direction, t)
      if (next !== undefined) setField(field.id, next)
    }
    return
  }
  if (field.kind === "number") {
    const direction = key.upArrow || key.rightArrow ? 1 : key.downArrow || key.leftArrow ? -1 : 0
    if (direction) setField(field.id, stepInteractionNumber(field, value, direction))
    return
  }
  if (key.backspace || key.delete) {
    setField(field.id, String(value ?? "").slice(0, -1))
  } else if (input && !key.return && !key.leftArrow && !key.rightArrow && !key.upArrow && !key.downArrow) {
    setField(field.id, `${String(value ?? "")}${input}`)
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

function executeLabel(
  session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>,
  t: TerminalTranslator,
): string {
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

function useTerminalSize() {
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 24 }))
  useEffect(() => {
    const update = () => setSize({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 24 })
    stdout.on?.("resize", update)
    return () => {
      stdout.off?.("resize", update)
    }
  }, [stdout])
  return size
}
