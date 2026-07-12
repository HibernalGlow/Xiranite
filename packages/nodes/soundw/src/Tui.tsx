/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useMemo, useState } from "react"
import { ActionLauncher, ActionTabs, ClickTarget, resolveTerminalTheme, TerminalPreferencesScreen, TerminalThemeProvider, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession, WorkbenchButton, WorkbenchField, WorkbenchPanel } from "@xiranite/cli-runtime/terminal/opentui"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { NodeRunResult } from "@xiranite/contract"
import type { SoundwData, SoundwInput } from "./core.js"
import { soundwActionLabel } from "./interaction.js"

export function SoundwTui(props: TerminalUiScreenProps<SoundwInput, NodeRunResult<SoundwData>>) {
  const [previewTheme, setPreviewTheme] = useState(props.theme ?? props.preferences?.current.theme ?? "inherit")
  return <TerminalThemeProvider theme={resolveTerminalTheme(previewTheme === "inherit" ? "nord" : previewTheme)}><SoundwWorkbench {...props} onThemePreview={setPreviewTheme} /></TerminalThemeProvider>
}

function SoundwWorkbench({ definition, language, preferences, onExit, onThemePreview }: TerminalUiScreenProps<SoundwInput, NodeRunResult<SoundwData>> & { onThemePreview: (theme: string) => void }) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const [settings, setSettings] = useState(false)
  const frame = useAnimation({ intervalMs: session.phase === "running" ? 120 : 520 })
  const action = String(session.values.action ?? "status") as SoundwInput["action"]
  const profileField = definition.schema.fields.find((field) => field.id === "profileName")!
  const pathField = definition.schema.fields.find((field) => field.id === "soundSwitchPath")!
  const profiles = useMemo(() => session.resultSummary?.lines.flatMap((line) => line.startsWith("Profiles:") ? line.slice(9).split(",").map((item) => item.trim()).filter(Boolean) : []) ?? [], [session.resultSummary])
  useTerminalChromeActions({ onReset: session.reset, onExit, resetLabel: `↺ ${t("reset")}`, exitLabel: `× ${language === "zh" ? "退出" : "Exit"}` })
  useKeyboard((key) => { if (key.name === "escape") { if (settings) setSettings(false); else if (session.phase === "running") void session.cancel(); else onExit() } })
  if (settings && preferences) return <TerminalPreferencesScreen controller={preferences} focusedId={session.focusedControlId} onFocus={session.focus} onPreviewTheme={onThemePreview} onBack={() => setSettings(false)} />

  return <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="row"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} SOUNDW // RECORDING ROUTE`}</b></text><text fg={theme.colors.mutedForeground}>{`  ${session.resultSummary?.message ?? (language === "zh" ? "录音路由待命" : "Recording route ready")}`}</text></box>
      <box flexDirection="column" alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.primary}>{`${session.phase === "running" ? "ROUTING" : "MIC READY"} ${["⠁", "⠂", "⠄", "⡀", "⢀", "⠠"][frame % 6]}`}</text>{preferences ? <ClickTarget id="settings" onClick={() => setSettings(true)}>{`⚙ ${language === "zh" ? "设置" : "Settings"}`}</ClickTarget> : null}</box>
    </box>

    <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
      <WorkbenchPanel title={language === "zh" ? "设备矩阵" : "Device matrix"} description="RECORDING ROUTE" width="38%">
        <box flexDirection="column" flexGrow={1} gap={1}>
          <box height={3} flexShrink={0} borderStyle="rounded" borderColor={action === "switch-recording" ? theme.colors.focusRing : theme.colors.border} paddingLeft={1} paddingRight={1}><text fg={theme.colors.primary}><b>◉ RECORDING DEVICES</b></text></box>
          <ActionLauncher field={definition.schema.fields.find((item) => item.id === "action")!} session={session} />
          <WorkbenchButton id="execute" onClick={() => void session.requestExecute()}>{session.phase === "running" ? "■ 执行中" : `▶ ${soundwActionLabel(action ?? "status", language)}`}</WorkbenchButton>
        </box>
      </WorkbenchPanel>

      <WorkbenchPanel title={language === "zh" ? "预设卡片" : "Profile cards"} description="SOUNDSWITCH PROFILES" flexGrow={1}>
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          <box flexDirection="row" gap={1}><box flexGrow={1}><WorkbenchField field={profileField} value={session.values.profileName} error={session.fieldErrors.profileName} focused={session.focusedControlId === "profileName"} disabled={session.phase === "running"} t={t} onFocus={() => session.focus("profileName")} onChange={(value) => session.setField("profileName", value)} /></box><WorkbenchButton id="profile-activate" onClick={() => { session.setField("action", "profile"); void session.requestExecute() }}>▶ 激活</WorkbenchButton><WorkbenchButton id="profiles-scan" onClick={() => { session.setField("action", "profiles"); void session.requestExecute() }}>↻ 扫描</WorkbenchButton></box>
          <scrollbox flexGrow={1} marginTop={1}><box flexDirection="row" flexWrap="wrap" gap={1}>{profiles.length ? profiles.map((profile) => <box key={profile} id={`profile-${profile}`} width="31%" height={5} borderStyle={session.values.profileName === profile ? "double" : "rounded"} borderColor={session.values.profileName === profile ? theme.colors.focusRing : theme.colors.border} paddingLeft={1} paddingRight={1} onMouseDown={() => session.setField("profileName", profile)}><text fg={theme.colors.primary}><b>{`◈ ${profile}`}</b></text><text fg={theme.colors.mutedForeground}>use profile</text></box>) : <text fg={theme.colors.mutedForeground}>{language === "zh" ? "扫描预设后，这里会以卡片显示可用路由。" : "Scan profiles to show available routes as cards."}</text>}</box></scrollbox>
        </box>
      </WorkbenchPanel>
    </box>

    <box height={10} minHeight={10} flexShrink={0} marginTop={1} borderStyle="rounded" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
      <box width="32%" flexDirection="column"><text fg={theme.colors.primary}><b>⌘ CLI PATH OVERRIDE</b></text><WorkbenchField field={pathField} value={session.values.soundSwitchPath} error={session.fieldErrors.soundSwitchPath} focused={session.focusedControlId === "soundSwitchPath"} disabled={session.phase === "running"} t={t} onFocus={() => session.focus("soundSwitchPath")} onChange={(value) => session.setField("soundSwitchPath", value)} /><ClickTarget id="settings-action" onClick={() => { session.setField("action", "settings"); void session.requestExecute() }}>⚙ SoundSwitch Settings</ClickTarget></box>
      <box flexGrow={1} flexDirection="column"><box flexDirection="row"><ClickTarget id="tab-status" selected={session.resultTab === "status"} onClick={() => session.selectResultTab("status")}>◉ STATUS</ClickTarget><ClickTarget id="tab-logs" selected={session.resultTab === "logs"} onClick={() => session.selectResultTab("logs")}>{`▤ CONSOLE (${session.logs.length})`}</ClickTarget></box><scrollbox id="soundw-console" flexGrow={1}>{session.resultTab === "logs" ? (session.logs.length ? session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(3, "0")} ${line}`}</text>) : <text fg={theme.colors.mutedForeground}>No commands run.</text>) : <Status result={session.resultSummary} language={language} />}</scrollbox></box>
    </box>
  </box>
}

function Status({ result, language }: { result: ReturnType<typeof useTerminalUiSession<SoundwInput, NodeRunResult<SoundwData>>>["resultSummary"]; language: "zh" | "en" }) {
  const theme = useTerminalTheme()
  return <box flexDirection="column">{result ? <><text fg={result.success ? theme.colors.success : theme.colors.error}><b>{result.message}</b></text>{result.lines.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{line}</text>)}</> : <text fg={theme.colors.mutedForeground}>{language === "zh" ? "等待设备操作或状态查询。" : "Waiting for a device action or status query."}</text>}</box>
}
