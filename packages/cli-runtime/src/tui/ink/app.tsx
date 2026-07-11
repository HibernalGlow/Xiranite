import { MouseProvider } from "@ink-tools/ink-mouse"
import { Box, Text, useInput } from "ink"
import Gradient from "ink-gradient"
import Spinner from "ink-spinner"
import { useMemo, type ReactNode } from "react"

import type { InteractionField, InteractionValue, TerminalInteractionDefinition } from "../../interaction.js"
import { createTerminalTranslator, type TerminalLanguage, type TerminalTranslator } from "../i18n.js"
import { displayInteractionValue, optionsForField, resolveInteractionView } from "../screen.js"
import { useTerminalUiSession, type TerminalUiSession } from "../session.js"
import { resolveTerminalTheme, TerminalThemeProvider, useTerminalTheme } from "../theme.js"
import { ProgressBar } from "./progress-bar.js"
import { Select } from "./select.js"
import { TextInput } from "./text-input.js"
import { MouseTarget } from "./mouse-target.js"

/**
 * Ink is a full configuration workbench, not the guided (`gd`) flow.  Mouse
 * tracking is restricted to non-nested leaf targets. One terminal click can
 * therefore resolve to exactly one field, option, or action.
 */
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
      <MouseProvider autoEnable cacheInvalidationMs={0}>
        <InkTerminalWorkbench definition={definition} onExit={onExit} t={t} />
      </MouseProvider>
    </TerminalThemeProvider>
  )
}

function InkTerminalWorkbench<Input, Result>({
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
  const controlIds = useMemo(
    () => [...session.fields.map((field) => field.id), "execute", "reset", "exit", "confirm-execute", "confirm-dismiss"],
    [session.fields],
  )
  const focusedField = session.fields.find((field) => field.id === session.focusedControlId)
  const editingText = focusedField?.kind === "text"

  useInput((input, key) => {
    if (key.escape) {
      if (session.confirming) session.dismissConfirmation()
      else if (session.phase === "running") session.cancel()
      // Escape deliberately does not exit the workbench. It only dismisses a
      // modal or cancels a running action; normal exit remains q/Ctrl+C.
      return
    }
    if ((key.ctrl && input === "c") || (input === "q" && !editingText && session.phase !== "running")) {
      onExit()
      return
    }
    if (key.tab) {
      session.moveFocus(controlIds, key.shift ? -1 : 1)
      return
    }
    if (focusedField) return
    if (key.return || input === " ") activateControl(session.focusedControlId, session, onExit)
  })

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header title={definition.schema.title} description={definition.schema.description} phase={session.phase} t={t} />
      <Box marginTop={1} gap={1} flexGrow={1}>
        <Panel title={view.sections[0]?.title ?? t("parameters")} width="33%">
          <FieldDirectory fields={session.fields} values={session.values} focusedId={session.focusedControlId} view={view} t={t} onFocus={session.focus} />
        </Panel>
        <Panel title={focusedField?.label ?? t("parameters")} flexGrow={1}>
          {session.confirming ? (
            <ConfirmPane session={session} t={t} />
          ) : (
            focusedField ? <FieldInspector field={focusedField} session={session} t={t} /> : null
          )}
        </Panel>
        <Panel title={view.dashboard.title} width="33%">
          <StatusPane session={session} display={view.dashboard.display(session.values)} t={t} />
        </Panel>
      </Box>
      {!session.confirming ? (
        <Box marginTop={1} borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
          <ExecutionPane session={session} onExit={onExit} t={t} />
        </Box>
      ) : null}
      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.colors.mutedForeground}>{"Tab 切换字段 · Enter 确认 · Esc 取消当前动作 · q 退出"}</Text>
        <Text color={session.dangerous ? theme.colors.warning : theme.colors.success}>{session.dangerous ? t("hazardNotice") : t("safeNotice")}</Text>
      </Box>
    </Box>
  )
}

function Header({ title, description, phase, t }: { title: string; description: string; phase: "ready" | "running" | "result"; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  return (
    <Box justifyContent="space-between">
      <Box gap={1} flexGrow={1} minWidth={0}>
        <Gradient colors={[theme.colors.primary, theme.colors.focusRing]}><Text bold>{title.toUpperCase()}</Text></Gradient>
        <Text color={theme.colors.mutedForeground} wrap="truncate-end">{description}</Text>
      </Box>
      <Box gap={1} flexShrink={0}>
        <Text color={theme.colors.mutedForeground}>INK</Text>
        {phase === "running" ? <Text color={theme.colors.warning}><Spinner type="dots" /></Text> : null}
        <Text bold color={phase === "running" ? theme.colors.warning : theme.colors.primary}>{phase === "running" ? t("running") : phase === "result" ? t("statusTab") : t("ready")}</Text>
      </Box>
    </Box>
  )
}

function Panel({ title, children, width, flexGrow }: { title: string; children: ReactNode; width?: number | string; flexGrow?: number }) {
  const theme = useTerminalTheme()
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.border} paddingX={1} width={width} flexGrow={flexGrow} overflow="hidden">
      <Text bold color={theme.colors.primary}>{title}</Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1} overflow="hidden">{children}</Box>
    </Box>
  )
}

function FieldDirectory({
  fields, values, focusedId, view, t, onFocus,
}: {
  fields: readonly InteractionField[]
  values: Record<string, InteractionValue>
  focusedId?: string
  view: ReturnType<typeof resolveInteractionView>
  t: TerminalTranslator
  onFocus: (fieldId: string) => void
}) {
  const theme = useTerminalTheme()
  return (
    <Box flexDirection="column">
      {fields.map((field) => {
        const section = view.sections.find((candidate) => candidate.fieldIds.includes(field.id))
        const previous = fields[fields.indexOf(field) - 1]
        const previousSection = previous ? view.sections.find((candidate) => candidate.fieldIds.includes(previous.id)) : undefined
        const active = focusedId === field.id
        return (
          <Box key={field.id} flexDirection="column">
            {section && section.id !== previousSection?.id ? <Text color={theme.colors.mutedForeground}>{`— ${section.title} —`}</Text> : null}
            <MouseTarget onClick={() => onFocus(field.id)}>
              <Text color={active ? theme.colors.focusRing : theme.colors.foreground} bold={active} wrap="truncate-end">
                {`${active ? "›" : " "} ${field.label}: ${displayInteractionValue(field, values[field.id], t)}`}
              </Text>
            </MouseTarget>
          </Box>
        )
      })}
    </Box>
  )
}

function FieldInspector({ field, session, t }: { field: InteractionField; session: TerminalUiSession<unknown>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  const value = session.values[field.id]
  const disabled = session.phase === "running"
  if (field.kind === "select" || field.kind === "boolean") {
    return (
      <Box flexDirection="column">
        {field.description ? <Text color={theme.colors.mutedForeground}>{field.description}</Text> : null}
        <Box marginTop={field.description ? 1 : 0}>
          <Select
            key={`${field.id}-${String(value)}`}
            options={optionsForField(field, t)}
            value={value}
            label={field.label}
            onSubmit={(next) => { if (!disabled) session.setField(field.id, next) }}
          />
        </Box>
        {session.fieldErrors[field.id] ? <Text color={theme.colors.error}>{session.fieldErrors[field.id]}</Text> : null}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {field.description ? <Text color={theme.colors.mutedForeground}>{field.description}</Text> : null}
      <Box marginTop={field.description ? 1 : 0}>
        <TextInput
          key={`${field.id}-${String(value)}`}
          value={value === undefined ? "" : String(value)}
          label={field.label}
          placeholder={field.placeholder ?? (field.kind === "number" ? "0" : "")}
          error={session.fieldErrors[field.id]}
          onChange={(next) => { if (!disabled) session.setField(field.id, next) }}
          onSubmit={(next) => { if (!disabled) session.setField(field.id, next) }}
        />
      </Box>
    </Box>
  )
}

function ExecutionPane({ session, onExit, t }: { session: TerminalUiSession<unknown>; onExit: () => void; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  return (
    <Box justifyContent="space-between" flexGrow={1}>
      <Text color={theme.colors.mutedForeground}>{t("executeHint")}</Text>
      <Box gap={3}>
        <ActionLine label={session.phase === "running" ? t("stopAction") : session.dangerous ? t("liveAction") : t("dryRunAction")} focused={session.focusedControlId === "execute"} danger={session.dangerous} onClick={() => session.phase === "running" ? session.cancel() : void session.requestExecute()} />
        <ActionLine label={t("resetParameters")} focused={session.focusedControlId === "reset"} onClick={session.reset} />
        <ActionLine label={t("exit")} focused={session.focusedControlId === "exit"} onClick={onExit} />
      </Box>
      {session.error ? <Text color={theme.colors.error}>{session.error}</Text> : null}
    </Box>
  )
}

function ConfirmPane({ session, t }: { session: TerminalUiSession<unknown>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.error}>{session.dangerPrompt?.title ?? t("confirmLiveTitle")}</Text>
      <Box marginTop={1}><Text color={theme.colors.error}>{session.dangerPrompt?.body ?? t("confirmLiveBody")}</Text></Box>
      <Box marginTop={1} flexDirection="column">
        <ActionLine label={session.dangerPrompt?.confirmLabel ?? t("confirmLiveAction")} focused={session.focusedControlId === "confirm-execute"} danger onClick={() => void session.confirmExecute()} />
        <ActionLine label={t("dismiss")} focused={session.focusedControlId === "confirm-dismiss"} onClick={session.dismissConfirmation} />
      </Box>
    </Box>
  )
}

function ActionLine({ label, focused, danger, onClick }: { label: string; focused?: boolean; danger?: boolean; onClick: () => void }) {
  const theme = useTerminalTheme()
  return (
    <MouseTarget onClick={onClick}>
      <Text bold={focused} color={danger ? theme.colors.error : focused ? theme.colors.focusRing : theme.colors.foreground}>{`${focused ? "›" : " "} ${label}`}</Text>
    </MouseTarget>
  )
}

function StatusPane({
  session, display, t,
}: {
  session: TerminalUiSession<unknown>
  display: { primary: string; secondary?: string; metrics?: readonly { label: string; value: string }[] }
  t: TerminalTranslator
}) {
  const theme = useTerminalTheme()
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.focusRing}>{display.primary}</Text>
      {display.secondary ? <Text color={theme.colors.mutedForeground}>{display.secondary}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {display.metrics?.map((metric) => <Text key={metric.label}>{`${metric.label}: ${metric.value}`}</Text>)}
      </Box>
      <Box marginTop={1}><ProgressBar value={session.progress} label={session.status || t("waitingForRun")} /></Box>
      {session.resultSummary ? <Text color={session.resultSummary.success ? theme.colors.success : theme.colors.error}>{session.resultSummary.message}</Text> : null}
      {session.logs.slice(-4).map((line, index) => <Text key={`${line}-${index}`} color={theme.colors.mutedForeground} wrap="truncate-end">{line}</Text>)}
    </Box>
  )
}

function activateControl<Result>(controlId: string | undefined, session: TerminalUiSession<Result>, onExit: () => void) {
  if (controlId === "execute") {
    if (session.phase === "running") session.cancel()
    else void session.requestExecute()
  }
  if (controlId === "reset") session.reset()
  if (controlId === "exit") onExit()
  if (controlId === "confirm-execute") void session.confirmExecute()
  if (controlId === "confirm-dismiss") session.dismissConfirmation()
}
