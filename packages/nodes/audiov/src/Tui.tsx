/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionTabs, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { AudiovInput, AudiovResult } from "./core.js"

export function AudiovTui(props: TerminalUiScreenProps<AudiovInput, AudiovResult>) {
  const theme = props.theme ?? props.preferences?.current.theme ?? "nord"
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><AudiovScreen {...props} /></TerminalThemeProvider>
}

function AudiovScreen({ definition, language, onExit }: TerminalUiScreenProps<AudiovInput, AudiovResult>) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: session.phase === "running" ? 80 : 500 })
  const data = session.result?.data
  const action = String(session.values.action ?? "plan")
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const Field = ({ id, width }: { id: string; width?: `${number}%` }) => <box width={width} flexGrow={width ? 0 : 1}><WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} /></box>
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => { if (key.name === "escape") { if (session.confirming) session.dismissConfirmation(); else onExit() } })
  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} flexDirection="row" justifyContent="space-between"><box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} AUDIOV // EXTRACTION DECK`}</b></text><text fg={theme.colors.mutedForeground}>ffmpeg extraction and local audio preview</text></box><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{`${session.phase === "running" ? "ENCODING" : "DECK READY"} ${[".", "o", "O", "o"][frame % 4]}`}</text></box>
    <box height={3} flexShrink={0} marginTop={1}><ActionTabs id="field-action" options={field("action").options ?? []} value={action} focused={session.focusedControlId === "action"} disabled={session.phase === "running"} onFocus={() => session.focus("action")} onChange={(value) => session.setField("action", value)} /></box>
    <box height={7} flexShrink={0} flexDirection="row" gap={1}><Field id="paths" width="58%" /><Field id="dryRun" width="16%" /><box width="23%" flexDirection="column" borderStyle="rounded" borderColor={session.dangerous ? theme.colors.error : theme.colors.border} paddingLeft={1}><text fg={session.dangerous ? theme.colors.error : theme.colors.mutedForeground}>{session.dangerous ? "WRITE M4A" : "COMMAND PLAN"}</text><box flexGrow={1} /><ExecutionActions session={session} executeLabel={action === "status" ? "Check ffmpeg" : "Preview extraction"} confirmLabel="Start extraction" /></box></box>
    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}><WorkbenchPanel title="视频队列" description="Source files" width="27%"><scrollbox flexGrow={1}>{String(session.values.paths ?? "").split(/\r?\n/).filter(Boolean).map((path, index) => <text key={`${path}-${index}`}>{`${index + 1}. ${path}`}</text>)}</scrollbox></WorkbenchPanel><WorkbenchPanel title={`ffmpeg 计划 · ${data?.commands.length ?? 0}`} description="Fixed AAC / 192k / m4a profile" width="32%"><scrollbox flexGrow={1}>{data?.commands.map((command, index) => <box key={`${command.inputPath}-${index}`} flexDirection="column"><text fg={theme.colors.primary}>{command.label}</text><text fg={theme.colors.mutedForeground}>{`${command.command} ${command.args.join(" ")}`}</text></box>) ?? <text fg={theme.colors.mutedForeground}>Preview the extraction plan first.</text>}</scrollbox></WorkbenchPanel><WorkbenchPanel title="输出与日志" description="Results and live logs" width="24%"><scrollbox flexGrow={1}>{data?.outputPaths.map((path, index) => <text key={`${path}-${index}`} fg={theme.colors.success}>{`READY ${index + 1}. ${path}`}</text>)}{data?.errors.map((error, index) => <text key={`${error}-${index}`} fg={theme.colors.error}>{`ERROR ${error}`}</text>)}{session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${line}`}</text>)}</scrollbox></WorkbenchPanel><WorkbenchPanel title={`Audio preview prototype · ${data?.outputPaths.length ?? 0}`} description="Hand off extracted files to xmelodeck / mpv" flexGrow={1}><scrollbox flexGrow={1}>{data?.outputPaths.length ? data.outputPaths.map((path, index) => <box key={`${path}-${index}`} flexDirection="column"><text fg={theme.colors.success}>{`READY ${index + 1}. ${path}`}</text><text fg={theme.colors.mutedForeground}>{`xmelodeck play "${path}"`}</text><text fg={theme.colors.mutedForeground}>Queue preview controls will be connected to Melodeck.</text></box>) : <text fg={theme.colors.mutedForeground}>Run a preview to populate the audio queue.</text>}</scrollbox></WorkbenchPanel></box>
    <box height={3} flexShrink={0}><ProgressBar value={session.progress} label={session.status || session.preview[0] || "READY"} /></box>
  </box>
}
