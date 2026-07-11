import { Box, Text, useInput } from "ink"

import type { InteractionField, InteractionValue, TerminalInteractionDefinition } from "../../interaction.js"
import { createTerminalTranslator, type TerminalLanguage, type TerminalTranslator } from "../i18n.js"
import { dangerConfirmationOptions, displayInteractionValue, optionsForField, resultOptions, safeConfirmationOptions } from "../screen.js"
import { useTerminalUiSession } from "../session.js"
import { resolveTerminalTheme, TerminalThemeProvider, useTerminalTheme } from "../theme.js"
import { ProgressBar } from "./progress-bar.js"
import { Select } from "./select.js"
import { TextInput } from "./text-input.js"

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
      <InkTerminalScreen definition={definition} onExit={onExit} t={t} />
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

  useInput((input, key) => {
    if (key.escape) {
      if (session.phase === "running") {
        session.cancel()
      } else if (!session.back()) {
        onExit()
      }
      return
    }
    const editingText = session.phase === "editing" && (session.field?.kind === "text" || session.field?.kind === "number")
    if (input === "q" && !editingText && session.phase !== "running") onExit()
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={theme.colors.primary}>{definition.schema.title}</Text>
        <Text color={theme.colors.mutedForeground}>{t("rendererHelp", { renderer: "Ink" })}</Text>
      </Box>
      <Text color={theme.colors.mutedForeground}>{definition.schema.description}</Text>
      <Box marginTop={1} flexDirection="column">
        {session.phase === "editing" ? (
          <EditingScreen session={session} t={t} />
        ) : session.phase === "preview" ? (
          <PreviewScreen session={session} t={t} />
        ) : session.phase === "running" ? (
          <RunningScreen session={session} t={t} />
        ) : (
          <ResultScreen session={session} onExit={onExit} t={t} />
        )}
      </Box>
    </Box>
  )
}

function EditingScreen({ session, t }: { session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  const field = session.field
  if (!field) return <Text color={theme.colors.error}>{t("noFields")}</Text>
  const completed = session.fields.slice(0, session.fieldIndex).slice(-4)
  return (
    <Box flexDirection="column">
      <Text color={theme.colors.mutedForeground}>{t("step", { current: session.fieldIndex + 1, total: session.fields.length })}</Text>
      {completed.map((item) => (
        <Text key={item.id} color={theme.colors.mutedForeground}>
          {item.label}: {displayInteractionValue(item, session.values[item.id])}
        </Text>
      ))}
      {field.description ? <Text color={theme.colors.mutedForeground}>{field.description}</Text> : null}
      <FieldEditor key={field.id} field={field} value={session.fieldValue} error={session.error} onChange={session.changeValue} onSubmit={session.submitValue} t={t} />
    </Box>
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
    <Box flexDirection="column">
      <Text bold>{t("preview")}</Text>
      {session.preview.map((line, index) => <Text key={`${line}-${index}`}>{line}</Text>)}
      <Text color={session.dangerous ? theme.colors.error : theme.colors.success} bold>
        {session.dangerous ? t("hazardNotice") : t("safeNotice")}
      </Text>
      {session.error ? <Text color={theme.colors.error}>{session.error}</Text> : null}
      <Select
        options={options}
        onSubmit={(choice) => choice === "execute" ? void session.execute() : session.back()}
      />
    </Box>
  )
}

function RunningScreen({ session, t }: { session: ReturnType<typeof useTerminalUiSession<unknown, unknown>>; t: TerminalTranslator }) {
  const theme = useTerminalTheme()
  return (
    <Box flexDirection="column">
      <Text bold>{t("running")}</Text>
      <ProgressBar value={session.progress} label={session.status} />
      {session.logs.slice(-5).map((line, index) => <Text key={`${line}-${index}`} color={theme.colors.mutedForeground}>{line}</Text>)}
      <Text color={theme.colors.mutedForeground}>{t("cancelHint")}</Text>
    </Box>
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
    <Box flexDirection="column">
      <Text bold color={summary?.success ? theme.colors.success : theme.colors.error}>{summary?.message ?? session.status}</Text>
      {summary?.lines.map((line, index) => <Text key={`${line}-${index}`}>{line}</Text>)}
      <Select options={resultOptions(t)} onSubmit={(choice) => choice === "again" ? session.reset() : onExit()} />
    </Box>
  )
}
