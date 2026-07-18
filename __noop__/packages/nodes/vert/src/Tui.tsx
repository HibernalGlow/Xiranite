/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionTabs, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { VertInput, VertResult } from "./core.js"

export function VertTui(props: TerminalUiScreenProps<VertInput, VertResult>) {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "inherit")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><VertWorkbench {...props} /></TerminalThemeProvider>
}

function VertWorkbench({ definition, language, onExit }: TerminalUiScreenProps<VertInput, VertResult>) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: session.phase === "running" ? 100 : 500 })
  const data = session.result?.data
  const action = String(session.values.action ?? "plan")
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => { if (key.name === "escape") { if (session.confirming) session.dismissConfirmation(); else onExit() } })
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const Field = ({ id, width }: { id: string; width?: `${number}%` }) => <box width={width} flexGrow={width ? 0 : 1}><WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} /></box>
  return (
    <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
      <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} VERT // UNIVERSAL CONVERTER`}</b></text><text fg={theme.colors.mutedForeground}>图像 · 音视频 · 文档 / CLI 优先 · Wasm 回退</text></box>
        <box flexDirection="column" alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{`${session.phase === "running" ? "CONVERTING" : "READY"} ${["·", "•", "●", "•"][frame % 4]}`}</text><text fg={theme.colors.mutedForeground}>{String(session.values.engine ?? "auto").toUpperCase()}</text></box>
      </box>
      <box height={3} flexShrink={0} marginTop={1}><ActionTabs id="field-action" options={field("action").options ?? []} value={action} focused={session.focusedControlId === "action"} disabled={session.phase === "running"} onFocus={() => session.focus("action")} onChange={(value) => session.setField("action", value)} /></box>
      {action === "status" ? null : <box height={7} flexShrink={0} flexDirection="row" gap={1}><Field id="paths" width="42%" /><Field id="targetFormat" width="14%" /><Field id="engine" width="20%" /><box width="21%" flexDirection="column" borderStyle="rounded" borderColor={session.dangerous ? theme.colors.error : theme.colors.border} paddingLeft={1}><text fg={theme.colors.mutedForeground}>CLI → WASM</text><box flexGrow={1} /><ExecutionActions session={session} executeLabel="⌕ 预演" confirmLabel="! 确认转换" /></box></box>}
      {action === "status" ? <box height={5} flexShrink={0} marginTop={1}><ExecutionActions session={session} executeLabel="◌ 检查引擎" confirmLabel="检查" /></box> : null}
      <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
        <WorkbenchPanel title="转换队列" description="输入 → 输出 / 转换器" width="42%"><scrollbox flexGrow={1}>{data?.commands.map((command, index) => <box key={`${command.inputPath}-${index}`} flexDirection="column"><text fg={theme.colors.primary}>{`▹ ${command.inputPath}`}</text><text fg={theme.colors.mutedForeground}>{`  .${command.outputPath.split(".").at(-1)} via ${command.converter}`}</text></box>) ?? <text fg={theme.colors.mutedForeground}>选择文件和目标格式后预演。</text>}</scrollbox></WorkbenchPanel>
        <WorkbenchPanel title="本机引擎" description="优先使用可用 CLI" width="25%"><box flexDirection="column"><text fg={data?.capabilities.ffmpeg ? theme.colors.success : theme.colors.mutedForeground}>{`${data?.capabilities.ffmpeg ? "✓" : "○"} ffmpeg`}</text><text fg={data?.capabilities.magick ? theme.colors.success : theme.colors.mutedForeground}>{`${data?.capabilities.magick ? "✓" : "○"} ImageMagick`}</text><text fg={data?.capabilities.pandoc ? theme.colors.success : theme.colors.mutedForeground}>{`${data?.capabilities.pandoc ? "✓" : "○"} Pandoc`}</text><text fg={theme.colors.primary}>✓ Wasm fallback</text></box></WorkbenchPanel>
        <WorkbenchPanel title="输出与日志" description="结果文件、错误和实时进度" flexGrow={1}><scrollbox flexGrow={1}>{data?.outputPaths.map((path, index) => <text key={`${path}-${index}`} fg={theme.colors.success}>{`✓ ${path}`}</text>)}{data?.errors.map((error, index) => <text key={`${error}-${index}`} fg={theme.colors.error}>{`! ${error}`}</text>)}{session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${line}`}</text>)}</scrollbox></WorkbenchPanel>
      </box>
      <box height={3} flexShrink={0}><ProgressBar value={session.progress} label={session.status || session.preview[0] || "READY"} /></box>
    </box>
  )
}
