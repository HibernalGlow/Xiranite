/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import type { TerminalInteractionDefinition } from "@xiranite/cli-runtime/interaction"
import { ActionLauncher, ActionTabs, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import { CZKAWKA_TOOLS, smartSelect, type CzkawkaEntry, type CzkawkaInput, type CzkawkaResult, type CzkawkaTool } from "./core.js"
import { czkawkaToolLabel } from "./interaction.js"
import { getCzkawkaToolOptions } from "./tool-options.js"
import { buildCzkawkaAnalysis } from "./analysis.js"
import { formatCzkawkaActivityMessage } from "./activity-log.js"

export function CzkawkaTui(props: TerminalUiScreenProps<CzkawkaInput, CzkawkaResult>) {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><Workbench {...props} /></TerminalThemeProvider>
}

export interface CzkawkaTerminalDefinition extends TerminalInteractionDefinition<CzkawkaInput, CzkawkaResult> {
  openPath?: (path: string) => Promise<void>
}

function Workbench({ definition, language, onExit }: TerminalUiScreenProps<CzkawkaInput, CzkawkaResult>) {
  const theme = useTerminalTheme(), t = createTerminalTranslator(language), session = useTerminalUiSession(definition), data = session.result?.data
  const pulse = useAnimation({ intervalMs: session.phase === "running" ? 110 : 600 })
  const [panel, setPanel] = useState<"roots" | "filters" | "algorithm" | "operations">("roots")
  const [resultView, setResultView] = useState<"all" | "selected" | "operation">("all")
  const [inspector, setInspector] = useState<"details" | "operation" | "logs">("details")
  const [resultFocused, setResultFocused] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string>()
  useTerminalChromeActions({ onReset: session.reset, onExit })
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const Field = ({ id }: { id: string }) => <WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => { setResultFocused(false); session.focus(id) }} onChange={(value) => session.setField(id, value)} />
  const tool = session.values.tool as CzkawkaTool
  const action = String(session.values.action ?? "scan")
  const options = CZKAWKA_TOOLS.map((value) => ({ value, label: czkawkaToolLabel(value, language) }))
  const entries = data?.entries ?? []
  const activeEntry = entries.find((entry) => entry.path === activePath) ?? entries[0]
  const activeIndex = Math.max(0, activeEntry ? entries.indexOf(activeEntry) : 0)
  const selectedSet = new Set(selectedPaths)
  const resultEntries = resultView === "selected" ? entries.filter((entry) => selectedSet.has(entry.path)) : resultView === "operation" ? entries.filter((entry) => entry.status || data?.action !== "scan") : entries
  const analysis = data ? buildCzkawkaAnalysis(data.groups, selectedPaths, data.tool) : undefined
  const openPath = (definition as CzkawkaTerminalDefinition).openPath
  function updateSelection(paths: string[]) { const next = [...new Set(paths)]; setSelectedPaths(next); session.setField("selectedPathsText", next.join("\n")) }
  function toggleSelection(path: string) { updateSelection(selectedSet.has(path) ? selectedPaths.filter((item) => item !== path) : [...selectedPaths, path]) }
  function moveActive(delta: number) { if (!entries.length) return; const next = entries[Math.max(0, Math.min(entries.length - 1, activeIndex + delta))]; if (next) setActivePath(next.path) }
  useKeyboard((key) => {
    if (key.name === "escape") { onExit(); return }
    if (key.name === "tab") { setResultFocused((current) => !current); return }
    if (!resultFocused) return
    if (key.name === "up" || key.name === "k") moveActive(-1)
    else if (key.name === "down" || key.name === "j") moveActive(1)
    else if (key.name === "space" && activeEntry) toggleSelection(activeEntry.path)
    else if (key.name === "a") updateSelection(entries.filter((entry) => !entry.isReference).map((entry) => entry.path))
    else if (key.name === "s" && data) updateSelection(smartSelect(data.groups, "all-except-first"))
    else if (key.name === "c") updateSelection([])
    else if (key.name === "o" && activeEntry && openPath) void openPath(activeEntry.path)
  })
  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} CZKAWKA // FILE FORENSICS`}</b></text><text fg={theme.colors.mutedForeground}>11 scanners · TypeScript control plane · Rust scan core</text></box>
      <box alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{session.phase === "running" ? `${action.toUpperCase()} ${["◐", "◓", "◑", "◒"][pulse % 4]}` : "READY"}</text><text fg={theme.colors.focusRing}>{`${action.toUpperCase()} · ${czkawkaToolLabel(tool, language)}`}</text></box>
    </box>
    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between"><ActionLauncher id="czkawka-command" field={field("action")} session={session} />{session.confirming || session.phase === "running" || session.phase === "paused" ? <ExecutionActions session={session} confirmLabel={action === "scan" ? "▶ 开始扫描" : "▶ 执行操作"} /> : <text fg={theme.colors.mutedForeground}>{`▦ ${data?.groupCount ?? 0} groups · ▣ ${data?.fileCount ?? 0} files · ${formatBytes(data?.reclaimableBytes ?? 0)} reclaimable`}</text>}</box>
    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <box width="25%" minWidth={24} flexDirection="column" gap={1}>
        <box height={16} flexShrink={0}><WorkbenchPanel title="⌕ SCANNER RAIL" description="全部 11 项工具" flexGrow={1}><scrollbox flexGrow={1}>{options.map((option) => <box key={option.value} height={1} flexShrink={0}><text fg={option.value === tool ? theme.colors.primary : theme.colors.mutedForeground}>{`${option.value === tool ? "◆" : "◇"} ${option.label}`}</text></box>)}</scrollbox></WorkbenchPanel></box>
        <WorkbenchPanel title="▣ SCAN / OPERATION INPUT" description="扫描与共享文件操作" flexGrow={1}><ActionTabs id="czkawka-input-tabs" options={[{ value: "roots", label: "目录" }, { value: "filters", label: "过滤" }, { value: "algorithm", label: "算法" }, { value: "operations", label: "操作" }]} value={panel} focused={false} onFocus={() => undefined} onChange={(value) => setPanel(value as typeof panel)} />
          <scrollbox flexGrow={1} minHeight={0} marginTop={1}><box flexDirection="column" gap={1}>{panel === "roots" ? <><Field id="tool" /><Field id="includedDirectoriesText" /><Field id="includedDirectoriesReferencedText" /><Field id="excludedDirectoriesText" /><Field id="threadCount" /><box height={3} flexShrink={0} flexDirection="row" gap={1}><box width="50%"><Field id="recursive" /></box><box flexGrow={1}><Field id="useCache" /></box></box></> : panel === "filters" ? <><Field id="excludedItemsText" /><Field id="allowedExtensions" /><Field id="excludedExtensions" /><box height={3} flexShrink={0} flexDirection="row" gap={1}><box width="50%"><Field id="minimumFileSize" /></box><box flexGrow={1}><Field id="maximumFileSize" /></box></box><Field id="filterText" /></> : panel === "algorithm" ? getCzkawkaToolOptions(tool).map((option) => <Field key={option.id} id={option.id} />) : <>{action === "rename" ? <Field id="renameItemsText" /> : <Field id="selectedPathsText" />}{action === "move" ? <><Field id="destinationDirectory" /><Field id="copyMode" /><Field id="preserveStructure" /><Field id="conflictPolicy" /></> : null}{action === "delete" ? <Field id="deleteMode" /> : null}{action === "save" ? <><Field id="outputPath" /><Field id="exportScope" /></> : null}{action === "delete" || action === "move" || action === "rename" ? <Field id="dryRun" /> : null}</>}</box></scrollbox>
        </WorkbenchPanel>
      </box>
      <WorkbenchPanel title={`▦ RESULT GROUPS · ${data?.groupCount ?? 0}`} description="Tab 聚焦结果 · ↑↓/jk 导航 · Space 选择 · a 全选 · s 智能 · c 清空 · o 打开" flexGrow={1}>
        <ActionTabs id="czkawka-result-tabs" options={[{ value: "all", label: `全部 ${entries.length}` }, { value: "selected", label: `已选 ${selectedPaths.length}` }, { value: "operation", label: `操作 ${data?.affectedCount ?? 0}` }]} value={resultView} focused={resultFocused} onFocus={() => setResultFocused(true)} onChange={(value) => setResultView(value as typeof resultView)} />
        <box height={2} flexShrink={0} flexDirection="row"><box width={8}><text fg={theme.colors.mutedForeground}>GROUP</text></box><box width="20%"><text fg={theme.colors.mutedForeground}>SIZE</text></box><box width="45%"><text fg={theme.colors.mutedForeground}>PATH</text></box><text fg={theme.colors.mutedForeground}>DETAIL</text></box>
        <scrollbox id="czkawka-results" flexGrow={1}>{resultEntries.length ? resultEntries.map((entry) => <box key={entry.id} id={`czkawka-result-${entry.id}`} height={2} flexShrink={0} flexDirection="row" backgroundColor={entry.path === activeEntry?.path ? theme.colors.border : undefined} onMouseDown={() => { setResultFocused(true); setActivePath(entry.path); toggleSelection(entry.path) }}><box width={8}><text fg={entry.status === "error" ? theme.colors.error : entry.status === "skipped" ? theme.colors.warning : groupColor(entry.groupId, theme)}>{`${selectedSet.has(entry.path) ? "●" : entry.isReference ? "★" : "○"} ${String(entry.groupId + 1).padStart(2, "0")}`}</text></box><box width="20%"><text>{entry.status ?? formatBytes(entry.size)}</text></box><box width="45%"><text fg={theme.colors.foreground}>{entry.path}</text></box><text fg={entry.error ? theme.colors.error : theme.colors.mutedForeground}>{entry.error ?? entry.secondaryPath ?? entry.detail ?? entry.properExtension ?? entry.similarity ?? ""}</text></box>) : <text fg={theme.colors.mutedForeground}>{resultView === "selected" ? "尚未选择结果；点击行或按 Space。" : resultView === "operation" ? "运行文件操作后显示逐项状态与目标。" : "选择工具与目录，然后点击“开始扫描”。"}</text>}</scrollbox>
      </WorkbenchPanel>
      <box width="28%" minWidth={28} flexDirection="column" gap={1}>
        <box height={17} flexShrink={0}><WorkbenchPanel title="◇ ANALYSIS" description="共享 TS 统计与选择" flexGrow={1}><MetricLine label="文件" value={String(data?.fileCount ?? 0)} color={theme.colors.primary} /><MetricLine label="分组" value={String(data?.groupCount ?? 0)} color={theme.colors.success} /><MetricLine label="已选" value={`${analysis?.selection.selectedCount ?? 0} / ${formatBytes(analysis?.selection.selectedBytes ?? 0)}`} color={theme.colors.focusRing} /><MetricLine label="总大小" value={formatBytes(data?.totalBytes ?? 0)} color={theme.colors.foreground} /><MetricLine label="可回收" value={formatBytes(data?.reclaimableBytes ?? 0)} color={theme.colors.warning} /><MetricLine label="主要格式" value={analysis?.formats[0] ? `${analysis.formats[0].format} ${analysis.formats[0].count}` : "—"} color={theme.colors.focusRing} /></WorkbenchPanel></box>
        <WorkbenchPanel title="▦ INSPECTOR" description="元数据 / 操作结果 / 日志" flexGrow={1}><ActionTabs id="czkawka-inspector-tabs" options={[{ value: "details", label: "详情" }, { value: "operation", label: "操作" }, { value: "logs", label: "日志" }]} value={inspector} focused={false} onFocus={() => undefined} onChange={(value) => setInspector(value as typeof inspector)} />{inspector === "logs" ? <scrollbox flexGrow={1}>{session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${formatCzkawkaActivityMessage("info", line)}`}</text>)}</scrollbox> : inspector === "operation" ? <scrollbox flexGrow={1}><DetailLine label="动作" value={data?.action ?? "—"} /><DetailLine label="影响" value={String(data?.affectedCount ?? 0)} /><DetailLine label="错误" value={String(data?.errorCount ?? 0)} /><DetailLine label="状态" value={activeEntry?.status ?? "—"} /><DetailLine label="方式" value={activeEntry?.operation ?? "—"} /><DetailLine label="目标" value={activeEntry?.secondaryPath ?? "—"} /><DetailLine label="冲突" value={activeEntry?.conflictPolicy ?? "—"} /><DetailLine label="错误详情" value={activeEntry?.error ?? "—"} /></scrollbox> : <scrollbox flexGrow={1}>{activeEntry ? <><text fg={theme.colors.primary}><b>{activeEntry.name}</b></text><box id="czkawka-open-active" height={3} flexShrink={0} borderStyle="rounded" borderColor={openPath ? theme.colors.focusRing : theme.colors.border} justifyContent="center" alignItems="center" onMouseDown={openPath ? () => void openPath(activeEntry.path) : undefined}><text fg={openPath ? theme.colors.focusRing : theme.colors.mutedForeground}>{openPath ? "↗ 打开当前文件 (o)" : "当前终端无打开能力"}</text></box>{entryDetails(activeEntry).map(([label, value]) => <DetailLine key={label} label={label} value={value} />)}</> : <text fg={theme.colors.mutedForeground}>选择结果后显示完整元数据。</text>}</scrollbox>}<ProgressBar value={session.progress} label={session.status || "SCANNER READY"} /></WorkbenchPanel>
      </box>
    </box>
  </box>
}

function MetricLine({ label, value, color }: { label: string; value: string; color: string }) { return <box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between"><text>{label}</text><text fg={color}><b>{value}</b></text></box> }
function DetailLine({ label, value }: { label: string; value: string }) { const theme = useTerminalTheme(); return <box height={1} flexShrink={0} flexDirection="row"><box width={9}><text fg={theme.colors.mutedForeground}>{label}</text></box><text fg={theme.colors.foreground}>{value}</text></box> }
function entryDetails(entry: CzkawkaEntry): Array<[string, string]> { return [["路径", entry.path], ["标题", entry.title ?? "—"], ["艺术家", entry.artist ?? "—"], ["分辨率", entry.width && entry.height ? `${entry.width}×${entry.height}` : "—"], ["相似度", entry.similarity ?? "—"], ["流派", entry.genre ?? "—"], ["年份", entry.year ?? "—"], ["时长", entry.length ?? "—"], ["码率", entry.bitrate === undefined ? "—" : `${entry.bitrate} kbps`], ["分组", String(entry.groupId + 1)], ["大小", formatBytes(entry.size)], ["修改时间", entry.modifiedDate ? new Date(entry.modifiedDate * 1000).toLocaleString() : "—"], ["Hash", entry.hash ?? "—"], ["参考项", entry.isReference ? "是" : "否"], ["正确扩展名", entry.properExtension ?? "—"], ["详情", entry.detail ?? "—"]] }
function groupColor(id: number, theme: ReturnType<typeof useTerminalTheme>) { return [theme.colors.primary, theme.colors.success, theme.colors.warning, theme.colors.focusRing][id % 4]! }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024, unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
