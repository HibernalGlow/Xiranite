/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionLauncher, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { SynctInput, SynctPlanItem, SynctResult } from "./core.js"

export function SynctTui(props: TerminalUiScreenProps<SynctInput, SynctResult>): import('react').ReactNode {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><SynctWorkbench {...props} /></TerminalThemeProvider>
}

function SynctWorkbench({ definition, language, onExit }: TerminalUiScreenProps<SynctInput, SynctResult>) {
  const theme = useTerminalTheme(), t = createTerminalTranslator(language), session = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: session.phase === "running" ? 85 : 420 })
  const data = session.result?.data
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const streams = ["──◇────", "────◇──", "──────◇", "◇──────"][frame % 4]
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => { if (key.name === "escape") onExit() })
  const F = ({ id }: { id: string }) => <WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} />

  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} SYNCT // CHRONOLOGICAL FLOW`}</b></text><text fg={theme.colors.mutedForeground}>时间提取 · 路径映射 · 原生归档</text></box>
      <box flexDirection="column" alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{session.phase === "running" ? "FLOWING" : "SYNCHRONIZED"}</text><text fg={theme.colors.focusRing}>{streams}</text></box>
    </box>

    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between">
      <ActionLauncher id="synct-command" field={field("action")} session={session} />
      {session.confirming || session.phase === "running" || session.phase === "paused" ? <ExecutionActions session={session} confirmLabel="⇄ 确认归档" /> : null}
    </box>

    <box height={8} flexShrink={0} marginTop={1} flexDirection="row" gap={1}>
      <WorkbenchPanel title="▤ 来源队列" description="文件与文件夹输入" width="39%"><F id="pathsText" /></WorkbenchPanel>
      <box width="13%" flexDirection="column" justifyContent="center" alignItems="center"><text fg={theme.colors.focusRing}>{streams}</text><text fg={theme.colors.mutedForeground}>TIMESTAMP</text><text fg={theme.colors.primary}>{String(session.values.formatKey ?? "year_month")}</text></box>
      <WorkbenchPanel title="⌁ 映射规则" description="日期提取与目标结构" flexGrow={1}><box flexDirection="row" gap={1}><box width="33%"><F id="sourceMode" /></box><box flexGrow={1}><F id="formatKey" /></box></box><box flexDirection="row" flexWrap="wrap" marginTop={1}><box width="25%"><F id="recursive" /></box><box width="25%"><F id="archiveFolder" /></box><box width="25%"><F id="fallbackToCreatedTime" /></box><box width="25%"><F id="syncFolderFileTimes" /></box></box></WorkbenchPanel>
    </box>

    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <WorkbenchPanel title={`⇄ 归档路径规划 · ${data?.items.length ?? 0}`} description="来源 → 日期目录 → 目标" width="72%">
        <box height={2} flexShrink={0} flexDirection="row"><box width={12}><text fg={theme.colors.mutedForeground}>状态</text></box><box width="35%"><text fg={theme.colors.mutedForeground}>来源</text></box><box flexGrow={1}><text fg={theme.colors.mutedForeground}>目标路径</text></box></box>
        <scrollbox id="synct-plan" flexGrow={1}>{data?.items.length ? data.items.map((item, index) => <PlanRow key={`${item.sourcePath}-${index}`} item={item} />) : <text fg={theme.colors.mutedForeground}>点击扫描或规划后显示时间归档路径。</text>}</scrollbox>
      </WorkbenchPanel>
      <WorkbenchPanel title="◫ 流程遥测" description="扫描、就绪与冲突" flexGrow={1}>
        <Metric icon="⌕" label="已扫描" value={data?.scannedCount ?? 0} /><Metric icon="✓" label="就绪" value={data?.readyCount ?? 0} color={theme.colors.success} /><Metric icon="⇄" label="已移动" value={data?.movedCount ?? 0} color={theme.colors.primary} /><Metric icon="⚠" label="冲突" value={data?.conflictCount ?? 0} color={theme.colors.warning} /><Metric icon="×" label="错误" value={data?.errorCount ?? 0} color={theme.colors.error} />
        <scrollbox flexGrow={1}>{data?.errors.map((error, index) => <text key={`${error}-${index}`} fg={theme.colors.error}>{error}</text>)}</scrollbox>
        <ProgressBar value={session.progress} label={session.status || "FLOW READY"} />
      </WorkbenchPanel>
    </box>
  </box>
}

function PlanRow({ item }: { item: SynctPlanItem }) {
  const theme = useTerminalTheme()
  const color = item.status === "ready" || item.status === "moved" ? theme.colors.success : item.status === "conflict" ? theme.colors.warning : item.status === "error" ? theme.colors.error : theme.colors.mutedForeground
  const icon = item.status === "moved" ? "⇄" : item.status === "ready" ? "✓" : item.status === "conflict" ? "⚠" : item.status === "error" ? "×" : "○"
  return <box height={3} flexShrink={0} flexDirection="row" alignItems="center"><box width={12}><text fg={color}>{`${icon} ${item.status}`}</text></box><box width="35%" flexDirection="column"><text fg={theme.colors.primary}>{item.sourceName}</text><text fg={theme.colors.mutedForeground}>{item.timestamp?.slice(0, 10) ?? item.kind}</text></box><box flexGrow={1}><text fg={color}>{`→ ${item.targetRelative}`}</text></box></box>
}

function Metric({ icon, label, value, color }: { icon: string; label: string; value: number; color?: string }) { const theme = useTerminalTheme(); return <box flexDirection="row" justifyContent="space-between"><text fg={color ?? theme.colors.mutedForeground}>{`${icon} ${label}`}</text><text fg={color ?? theme.colors.foreground}><b>{String(value).padStart(2, "0")}</b></text></box> }
