/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import { ActionLauncher, ActionTabs, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { LoratInput, LoratResult, LoratRow } from "./core.js"

export function LoratTui(props: TerminalUiScreenProps<LoratInput, LoratResult>) {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><LoratWorkbench {...props} /></TerminalThemeProvider>
}

function LoratWorkbench({ definition, language, onExit }: TerminalUiScreenProps<LoratInput, LoratResult>) {
  const theme = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const session = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: session.phase === "running" ? 90 : 480 })
  const [surface, setSurface] = useState<"manage" | "collect">("manage")
  const [rows, setRows] = useState<LoratRow[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const data = session.result?.data
  const actionField = definition.schema.fields.find((field) => field.id === "action")!
  const field = (id: string) => definition.schema.fields.find((item) => item.id === id)!
  const pulse = ["◈···", "·◈··", "··◈·", "···◈"][frame % 4]
  const manageActions = (actionField.options ?? []).filter((option) => option.value !== "collect")
  const collectActions = (actionField.options ?? []).filter((option) => option.value === "collect")
  const search = String(session.values.search ?? "").trim().toLocaleLowerCase()
  const statusFilter = String(session.values.statusFilter ?? "all")
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false
    if (!search) return true
    return [row.name, row.relativePath, row.trigger, row.source].some((value) => value.toLocaleLowerCase().includes(search))
  }), [rows, search, statusFilter])
  useEffect(() => {
    if (!data?.rows) return
    setRows(data.rows)
    session.setField("rowsJson", JSON.stringify(data.rows))
    session.setField("selectedKeys", data.rows.filter((row) => row.selected).map((row) => row.key).join(","))
  }, [data?.rows])
  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => { if (key.name === "escape") onExit() })

  const F = ({ id, width }: { id: string; width?: `${number}%` }) => <box width={width} flexGrow={width ? 0 : 1}><WorkbenchField field={field(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} /></box>
  const updateRows = (next: LoratRow[]) => {
    setRows(next)
    session.setField("rowsJson", JSON.stringify(next))
    session.setField("selectedKeys", next.filter((row) => row.selected).map((row) => row.key).join(","))
  }

  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} LORAT // MODEL SIGNAL MATRIX`}</b></text><text fg={theme.colors.mutedForeground}>LoRA 模型 · Trigger sidecar · TriggerDB</text></box>
      <text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{`${session.phase === "running" ? "SCANNING" : "SIGNAL READY"} ${pulse}`}</text>
    </box>

    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between">
      <ActionTabs id="surface" options={[{ value: "manage", label: "▦ 管理" }, { value: "collect", label: "⊕ 收集" }]} value={surface} focused={false} onFocus={() => undefined} onChange={(value) => setSurface(value as "manage" | "collect")} />
      <ActionLauncher id="lorat-command" field={actionField} options={surface === "collect" ? collectActions : manageActions} session={session} />
    </box>

    <box height={7} flexShrink={0} marginTop={1} flexDirection="row" gap={1}>
      {surface === "manage" ? <><F id="folderPath" width="45%" /><F id="search" width="28%" /><F id="statusFilter" /></> : <><F id="collectionRoot" width="40%" /><F id="collectionItemsJson" width="40%" /><F id="collectionOverwrite" /></>}
    </box>

    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <WorkbenchPanel title={`▦ 模型表格 · ${filteredRows.length}/${rows.length}`} description="单击选择；触发词列可直接输入" width="75%">
        <box height={2} flexShrink={0} flexDirection="row"><text fg={theme.colors.mutedForeground}>{"选  状态      模型 / 路径"}</text><box width="42%"/><text fg={theme.colors.mutedForeground}>触发词</text><box flexGrow={1}/><text fg={theme.colors.mutedForeground}>来源</text></box>
        <scrollbox id="lorat-model-table" flexGrow={1}>{filteredRows.length ? filteredRows.map((row) => {
          const statusColor = row.status === "trigger" ? theme.colors.success : row.status === "notrigger" ? theme.colors.warning : theme.colors.error
          return <box key={row.key} id={`lorat-row-${row.key}`} height={3} flexShrink={0} flexDirection="row" alignItems="center">
            <text id={`select-row-${row.key}`} fg={row.selected ? theme.colors.focusRing : theme.colors.mutedForeground} onMouseDown={() => updateRows(rows.map((item) => item.key === row.key ? { ...item, selected: !item.selected } : item))}>{row.selected ? "◉ " : "○ "}</text>
            <box width={11}><text fg={statusColor}>{row.status === "notrigger" ? "none" : row.status}</text></box>
            <box width="32%" flexDirection="column"><text fg={theme.colors.primary}>{row.name}</text><text fg={theme.colors.mutedForeground}>{row.relativeDir || "."}</text></box>
            <box id={`trigger-cell-${row.key}`} width="30%" height={3} borderStyle="rounded" borderColor={editingKey === row.key ? theme.colors.focusRing : theme.colors.border} paddingLeft={1} paddingRight={1} onMouseDown={(event) => { event.stopPropagation(); setEditingKey(row.key) }}><input id={`trigger-input-${row.key}`} value={row.trigger} placeholder="输入触发词" focused={editingKey === row.key} onInput={(value) => updateRows(rows.map((item) => item.key === row.key ? { ...item, trigger: value, changed: value.trim() !== item.originalTrigger.trim(), status: value.trim() ? "trigger" : item.originalStatus } : item))}/></box>
            <box id={`write-row-${row.key}`} height={3} borderStyle="rounded" borderColor={theme.colors.error} paddingLeft={1} paddingRight={1} justifyContent="center" alignItems="center" onMouseDown={session.phase === "running" ? undefined : () => void session.requestAction("action", "write_triggers", { rowsJson: JSON.stringify(rows), selectedKeys: row.key })}><text fg={theme.colors.error}>✓ 写入</text></box>
            <box flexGrow={1} paddingLeft={1}><text fg={row.changed ? theme.colors.warning : theme.colors.mutedForeground}>{`${row.changed ? "◆ " : ""}${row.source}`}</text></box>
          </box>
        }) : <text fg={theme.colors.mutedForeground}>{rows.length ? "当前过滤条件没有匹配模型。" : "点击“扫描模型”后在这里显示模型表。"}</text>}</scrollbox>
      </WorkbenchPanel>
      <WorkbenchPanel title="◫ 状态遥测" description="sidecar 与收集结果" flexGrow={1}>
        <text>{`▦ 总计 ${data?.stats.total ?? 0}`}</text><text fg={theme.colors.error}>{`◇ 缺失 ${data?.stats.missing ?? 0}`}</text><text fg={theme.colors.success}>{`✓ 有触发词 ${data?.stats.trigger ?? 0}`}</text><text fg={theme.colors.warning}>{`○ 无触发词 ${data?.stats.notrigger ?? 0}`}</text><text>{`✓ 已写入 ${data?.writtenCount ?? 0}`}</text>
        <scrollbox flexGrow={1}>{data?.collection.map((entry, index) => <text key={`${entry.item.sourcePath}-${index}`} fg={entry.status === "collected" ? theme.colors.success : entry.status === "error" ? theme.colors.error : theme.colors.warning}>{`${entry.status === "collected" ? "✓" : entry.status === "error" ? "×" : "○"} ${entry.item.sourcePath}`}</text>)}</scrollbox>
        {session.confirming || session.phase === "running" || session.phase === "paused" ? <ExecutionActions session={session} confirmLabel="✓ 确认写入" /> : null}
        <ProgressBar value={session.progress} label={session.status || "READY"} />
      </WorkbenchPanel>
    </box>
  </box>
}
