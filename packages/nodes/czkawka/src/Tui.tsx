/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionLauncher, ActionTabs, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import { CZKAWKA_TOOLS, type CzkawkaInput, type CzkawkaResult, type CzkawkaTool } from "./core.js"
import { czkawkaToolLabel } from "./interaction.js"
import { getCzkawkaToolOptions } from "./tool-options.js"
import { buildCzkawkaAnalysis } from "./analysis.js"

export function CzkawkaTui(props: TerminalUiScreenProps<CzkawkaInput, CzkawkaResult>) {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><Workbench {...props} /></TerminalThemeProvider>
}

function Workbench({ definition, language, onExit }: TerminalUiScreenProps<CzkawkaInput, CzkawkaResult>) {
  const theme = useTerminalTheme(), t = createTerminalTranslator(language), session = useTerminalUiSession(definition), data = session.result?.data
  const analysis = data ? buildCzkawkaAnalysis(data.groups, [], data.tool) : undefined
  const pulse = useAnimation({ intervalMs: session.phase === "running" ? 110 : 600 })
  const [panel, setPanel] = useState<"roots" | "filters" | "algorithm">("roots")
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => { if (key.name === "escape") onExit() })
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const Field = ({ id }: { id: string }) => <WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} />
  const tool = session.values.tool as CzkawkaTool
  const options = CZKAWKA_TOOLS.map((value) => ({ value, label: czkawkaToolLabel(value, language) }))
  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} CZKAWKA // FILE FORENSICS`}</b></text><text fg={theme.colors.mutedForeground}>11 scanners · TypeScript control plane · Rust scan core</text></box>
      <box alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{session.phase === "running" ? `SCANNING ${["◐", "◓", "◑", "◒"][pulse % 4]}` : "READY"}</text><text fg={theme.colors.focusRing}>{czkawkaToolLabel(tool, language)}</text></box>
    </box>
    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between"><ActionLauncher id="czkawka-command" field={field("tool")} session={session} />{session.confirming || session.phase === "running" || session.phase === "paused" ? <ExecutionActions session={session} confirmLabel="▶ 开始扫描" /> : <text fg={theme.colors.mutedForeground}>{`▦ ${data?.groupCount ?? 0} groups · ▣ ${data?.fileCount ?? 0} files · ${formatBytes(data?.reclaimableBytes ?? 0)} reclaimable`}</text>}</box>
    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <box width="27%" minWidth={24} flexDirection="column" gap={1}>
        <box height={16} flexShrink={0}><WorkbenchPanel title="⌕ SCANNER RAIL" description="全部 11 项工具" flexGrow={1}><scrollbox flexGrow={1}>{options.map((option) => <box key={option.value} height={1} flexShrink={0}><text fg={option.value === tool ? theme.colors.primary : theme.colors.mutedForeground}>{`${option.value === tool ? "◆" : "◇"} ${option.label}`}</text></box>)}</scrollbox></WorkbenchPanel></box>
        <WorkbenchPanel title="▣ SCAN INPUT" description="目录与排除规则" flexGrow={1}><ActionTabs id="czkawka-input-tabs" options={[{ value: "roots", label: "目录" }, { value: "filters", label: "过滤" }, { value: "algorithm", label: "算法" }]} value={panel} focused={false} onFocus={() => undefined} onChange={(value) => setPanel(value as typeof panel)} />
          <scrollbox flexGrow={1} minHeight={0} marginTop={1}><box flexDirection="column" gap={1}>{panel === "roots" ? <><Field id="includedDirectoriesText" /><Field id="excludedDirectoriesText" /><box height={3} flexShrink={0} flexDirection="row" gap={1}><box width="50%"><Field id="recursive" /></box><box flexGrow={1}><Field id="useCache" /></box></box></> : panel === "filters" ? <><Field id="excludedItemsText" /><Field id="allowedExtensions" /><Field id="excludedExtensions" /><Field id="filterText" /></> : getCzkawkaToolOptions(tool).map((option) => <Field key={option.id} id={option.id} />)}</box></scrollbox>
        </WorkbenchPanel>
      </box>
      <WorkbenchPanel title={`▦ RESULT GROUPS · ${data?.groupCount ?? 0}`} description="组轨道 / 文件 / 大小 / 详情" flexGrow={1}>
        <box height={2} flexShrink={0} flexDirection="row"><box width={8}><text fg={theme.colors.mutedForeground}>GROUP</text></box><box width="20%"><text fg={theme.colors.mutedForeground}>SIZE</text></box><box width="45%"><text fg={theme.colors.mutedForeground}>PATH</text></box><text fg={theme.colors.mutedForeground}>DETAIL</text></box>
        <scrollbox id="czkawka-results" flexGrow={1}>{data?.groups.length ? data.groups.flatMap((group) => group.entries.map((entry, index) => <box key={entry.id} height={2} flexShrink={0} flexDirection="row"><box width={8}><text fg={groupColor(group.id, theme)}>{`${index === 0 ? "◆" : index === group.entries.length - 1 ? "└" : "│"} ${String(group.id + 1).padStart(2, "0")}`}</text></box><box width="20%"><text>{formatBytes(entry.size)}</text></box><box width="45%"><text fg={theme.colors.foreground}>{entry.path}</text></box><text fg={theme.colors.mutedForeground}>{entry.detail ?? entry.properExtension ?? entry.similarity ?? ""}</text></box>)) : <text fg={theme.colors.mutedForeground}>选择工具与目录，然后点击“开始扫描”。</text>}</scrollbox>
      </WorkbenchPanel>
      <box width="22%" minWidth={22} flexDirection="column" gap={1}>
        <box height={15} flexShrink={0}><WorkbenchPanel title="◇ ANALYSIS" description="共享 TS 统计" flexGrow={1}><MetricLine label="文件" value={String(data?.fileCount ?? 0)} color={theme.colors.primary} /><MetricLine label="分组" value={String(data?.groupCount ?? 0)} color={theme.colors.success} /><MetricLine label="总大小" value={formatBytes(data?.totalBytes ?? 0)} color={theme.colors.foreground} /><MetricLine label="可回收" value={formatBytes(data?.reclaimableBytes ?? 0)} color={theme.colors.warning} /><MetricLine label="主要格式" value={analysis?.formats[0] ? `${analysis.formats[0].format} ${analysis.formats[0].count}` : "—"} color={theme.colors.focusRing} /></WorkbenchPanel></box>
        <WorkbenchPanel title="▦ TELEMETRY" description="扫描日志" flexGrow={1}><scrollbox flexGrow={1}>{session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${line}`}</text>)}</scrollbox><ProgressBar value={session.progress} label={session.status || "SCANNER READY"} /></WorkbenchPanel>
      </box>
    </box>
  </box>
}

function MetricLine({ label, value, color }: { label: string; value: string; color: string }) { return <box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between"><text>{label}</text><text fg={color}><b>{value}</b></text></box> }
function groupColor(id: number, theme: ReturnType<typeof useTerminalTheme>) { return [theme.colors.primary, theme.colors.success, theme.colors.warning, theme.colors.focusRing][id % 4]! }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024, unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
