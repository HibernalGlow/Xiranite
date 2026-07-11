/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"

import type { InteractionField, InteractionValue, TerminalInteractionDefinition } from "../../interaction.js"
import { createTerminalTranslator, type TerminalLanguage, type TerminalTranslator } from "../i18n.js"
import { dangerConfirmationOptions, displayInteractionValue, optionsForField, resultOptions, safeConfirmationOptions } from "../screen.js"
import { useTerminalUiSession } from "../session.js"
import { resolveTerminalTheme, TerminalThemeProvider, useTerminalTheme } from "../theme.js"
import { ProgressBar } from "./progress-bar.js"
import { Select } from "./select.js"
import { TextInput } from "./text-input.js"

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

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (session.phase === "running") {
        session.cancel()
      } else if (!session.back()) {
        onExit()
      }
      return
    }
    const editingText = session.phase === "editing" && (session.field?.kind === "text" || session.field?.kind === "number")
    if (key.name === "q" && !editingText && session.phase !== "running") onExit()
  })

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box justifyContent="space-between">
        <text fg={theme.colors.primary}><b>{definition.schema.title}</b></text>
        <text fg={theme.colors.mutedForeground}>{t("rendererHelp", { renderer: "OpenTUI" })}</text>
      </box>
      <text fg={theme.colors.mutedForeground}>{definition.schema.description}</text>
      <box marginTop={1} flexDirection="column">
        {session.phase === "editing" ? (
          <EditingScreen session={session} t={t} />
        ) : session.phase === "preview" ? (
          <PreviewScreen session={session} t={t} />
        ) : session.phase === "running" ? (
          <RunningScreen session={session} t={t} />
        ) : (
          <ResultScreen session={session} onExit={onExit} t={t} />
        )}
      </box>
    </box>
  )
}

function EditingScreen({ session, t }: { session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  const field = session.field
  if (!field) return <text fg={theme.colors.error}>{t("noFields")}</text>
  const completed = session.fields.slice(0, session.fieldIndex).slice(-4)
  return (
    <box flexDirection="column">
      <text fg={theme.colors.mutedForeground}>{t("step", { current: session.fieldIndex + 1, total: session.fields.length })}</text>
      {completed.map((item) => (
        <text key={item.id} fg={theme.colors.mutedForeground}>
          {item.label}: {displayInteractionValue(item, session.values[item.id])}
        </text>
      ))}
      {field.description ? <text fg={theme.colors.mutedForeground}>{field.description}</text> : null}
      <FieldEditor key={field.id} field={field} value={session.fieldValue} error={session.error} onChange={session.changeValue} onSubmit={session.submitValue} t={t} />
    </box>
  )
}

function FieldEditor({
  field,
  value,
  error,
  onChange,
  onSubmit,
  t,
}: {
  field: InteractionField
  value?: InteractionValue
  error?: string
  onChange: (value: InteractionValue) => void
  onSubmit: (value: InteractionValue) => void
  t: TerminalTranslator
}) {
  if (field.kind === "select" || field.kind === "boolean") {
    return <Select options={optionsForField(field, t)} value={value} label={field.label} onSubmit={onSubmit} />
  }
  return (
    <TextInput
      value={value === undefined ? "" : String(value)}
      label={field.label}
      placeholder={field.placeholder}
      error={error}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  )
}

function PreviewScreen({ session, t }: { session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  const options = session.dangerous ? dangerConfirmationOptions(t) : safeConfirmationOptions(t)
  return (
    <box flexDirection="column">
      <text><b>{t("preview")}</b></text>
      {session.preview.map((line, index) => <text key={`${line}-${index}`}>{line}</text>)}
      <text fg={session.dangerous ? theme.colors.error : theme.colors.success}>
        <b>{session.dangerous ? t("hazardNotice") : t("safeNotice")}</b>
      </text>
      {session.error ? <text fg={theme.colors.error}>{session.error}</text> : null}
      <Select options={options} onSubmit={(choice) => choice === "execute" ? void session.execute() : session.back()} />
    </box>
  )
}

function RunningScreen({ session, t }: { session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  return (
    <box flexDirection="column">
      <text><b>{t("running")}</b></text>
      <ProgressBar value={session.progress} label={session.status} />
      {session.logs.slice(-5).map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{line}</text>)}
      <text fg={theme.colors.mutedForeground}>{t("cancelHint")}</text>
    </box>
  )
}

function ResultScreen({
  session,
  onExit,
  t,
}: {
  session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>
  onExit: () => void
  t: TerminalTranslator
}) {
  const theme = useTerminalTheme()
  const summary = session.resultSummary
  return (
    <box flexDirection="column">
      <text fg={summary?.success ? theme.colors.success : theme.colors.error}><b>{summary?.message ?? session.status}</b></text>
      {summary?.lines.map((line, index) => <text key={`${line}-${index}`}>{line}</text>)}
      <Select options={resultOptions(t)} onSubmit={(choice) => choice === "again" ? session.reset() : onExit()} />
    </box>
  )
}
