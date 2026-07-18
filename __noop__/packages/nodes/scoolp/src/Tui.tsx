/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal";
import { ActionTabs, ClickTarget, ExecutionActions, ProgressBar, TerminalThemeProvider, WorkbenchButton, WorkbenchField, WorkbenchPanel, resolveTerminalTheme, terminalIcon, useAnimation, useTerminalChromeActions, useTerminalTheme, useTerminalUiSession } from "@xiranite/cli-runtime/terminal/opentui";
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n";
import { formatSize, type CachePackage, type ScoolpInput, type ScoolpResult } from "./core.js";

export function ScoolpTui(props: TerminalUiScreenProps<ScoolpInput, ScoolpResult>) {
  const [theme] = useState(props.theme ?? props.preferences?.current.theme ?? "inherit");
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><ScoolpWorkbench {...props} /></TerminalThemeProvider>;
}

function ScoolpWorkbench({ definition, language, onExit }: TerminalUiScreenProps<ScoolpInput, ScoolpResult>) {
  const theme = useTerminalTheme(), t = createTerminalTranslator(language), session = useTerminalUiSession(definition);
  const pulse = useAnimation({ intervalMs: session.phase === "running" ? 90 : 480 });
  const data = session.result?.data, cache = data?.cache, packages = cache?.obsoletePackages ?? [];
  const action = String(session.values.action ?? "cache_list");
  useTerminalChromeActions({ onReset: session.reset, onExit, resetLabel: "↻ 重置", exitLabel: "× 退出" });
  useKeyboard((key) => { if (key.name === "escape") { if (session.confirming) session.dismissConfirmation(); else onExit(); } });
  if (session.confirming) return <DangerConfirm action={action} count={packages.length} size={cache?.obsoleteSize ?? 0} onConfirm={() => void session.confirmExecute()} onDismiss={session.dismissConfirmation} />;
  const getField = (id: string) => definition.schema.fields.find((item) => item.id === id)!;
  const Field = ({ id, width }: { id: string; width?: `${number}%` }) => session.fields.some((item) => item.id === id) ? <box width={width} flexGrow={width ? 0 : 1}><WorkbenchField field={getField(id)} value={session.values[id]} error={session.fieldErrors[id]} focused={session.focusedControlId === id} disabled={session.phase === "running"} t={t} onFocus={() => session.focus(id)} onChange={(value) => session.setField(id, value)} /></box> : null;
  const cacheMode = action.startsWith("cache_");
  return <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
    <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
      <box flexDirection="column"><text fg={theme.colors.primary}><b>{`${terminalIcon("status")} SCOOLP // CACHE DECK`}</b></text><text fg={theme.colors.mutedForeground}>{session.status || "Scoop 状态、Bucket 同步、缓存容量分析与安全清理"}</text></box>
      <box flexDirection="column" alignItems="flex-end"><text fg={session.phase === "running" ? theme.colors.warning : theme.colors.success}>{`${phase(session.phase)} ${["◐", "◓", "◑", "◒"][pulse % 4]}`}</text><text fg={theme.colors.mutedForeground}>F1 帮助 · F9 队列</text></box>
    </box>
    <box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between"><ActionTabs id="field-action" options={getField("action").options ?? []} value={action} focused={session.focusedControlId === "action"} disabled={session.phase === "running"} onFocus={() => session.focus("action")} onChange={(value) => session.setField("action", value)} /><text fg={theme.colors.mutedForeground}>{`${terminalIcon("result")} ${cache?.obsoleteCount ?? 0} 个过期项 · ${formatSize(cache?.obsoleteSize ?? 0)} · ${session.progress}%`}</text></box>
    <box height={5} minHeight={5} flexShrink={0} flexDirection="row" gap={1}>
      {cacheMode ? <><Field id="scoopRoot" width="27%"/><Field id="cachePath" width="34%"/></> : action === "sync" ? <><Field id="configPath" width="34%"/><Field id="dryRun" width="18%"/></> : action === "install" ? <><Field id="bucketPath" width="30%"/><Field id="dryRun" width="18%"/></> : <Field id="bucketPath" width="42%"/>}
      <box flexGrow={1} flexDirection="column" borderStyle="rounded" borderColor={session.dangerous ? theme.colors.error : theme.colors.border} paddingLeft={1} paddingRight={1}><text fg={session.dangerous ? theme.colors.error : theme.colors.mutedForeground}>{session.dangerous ? "⚠ LIVE · 将修改系统状态" : "◇ DRY RUN · 安全预演"}</text><box flexGrow={1}/><ExecutionActions session={session} executeLabel={actionButton(action)} confirmLabel="⚠ 确认执行" /></box>
    </box>
    <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
      <box width="73%" flexDirection="column" gap={1}>
        <WorkbenchPanel title="缓存容量分析" description={cache?.path || String(session.values.cachePath || "扫描后显示真实缓存占用")}>
          <CacheVolumeMap packages={packages} />
        </WorkbenchPanel>
        <WorkbenchPanel title={`可处理项目 · ${packages.length}`} description="保留最新版本，仅列出过期安装包" flexGrow={1} headerActions={<text fg={theme.colors.mutedForeground}>{cache ? `可回收 ${formatSize(cache.obsoleteSize)}` : "WAITING"}</text>}>
          <scrollbox flexGrow={1} scrollbarOptions={{ trackOptions: { foregroundColor: theme.colors.primary, backgroundColor: theme.colors.border } }}>{packages.length ? packages.map((item, index) => <CacheRow key={item.path} item={item} index={index} maximum={packages[0]?.size ?? 1} />) : <text fg={theme.colors.mutedForeground}>⌕ 执行缓存扫描后，这里显示可备份或删除的真实文件。</text>}</scrollbox>
        </WorkbenchPanel>
      </box>
      <box flexGrow={1} flexDirection="column" gap={1}>
        <WorkbenchPanel title="清理操作" description="先扫描，再选择安全备份或永久清理">
          <box flexDirection="column">{[
            ["cache_list", "⌕ 扫描"], ["cache_backup", "▣ 备份"], ["cache_delete", "⌫ 清理"],
          ].map(([value, label]) => <ClickTarget key={value} id={`action-${value}`} selected={action === value} disabled={session.phase === "running"} onClick={() => session.setField("action", value)}>{label}</ClickTarget>)}</box>
        </WorkbenchPanel>
        <WorkbenchPanel title="运行状态" flexGrow={1}><scrollbox flexGrow={1}>{session.logs.length ? session.logs.map((line, index) => <text key={`${line}-${index}`} fg={theme.colors.mutedForeground}>{`${String(index + 1).padStart(2, "0")} ${line}`}</text>) : <text fg={theme.colors.mutedForeground}>运行日志将在这里持续更新。</text>}</scrollbox><ProgressBar value={session.progress} label={session.status || "READY"}/>{session.resultSummary ? <text fg={session.resultSummary.success ? theme.colors.success : theme.colors.error}><b>{session.resultSummary.message}</b></text> : null}</WorkbenchPanel>
      </box>
    </box>
  </box>;
}

function CacheVolumeMap({ packages }: { packages: CachePackage[] }) {
  const theme = useTerminalTheme(), total = packages.reduce((sum, item) => sum + item.size, 0), maximum = Math.max(...packages.map((item) => item.size), 1);
  return <box height={Math.max(4, Math.min(7, packages.length + 2))} minHeight={4} flexDirection="row" gap={1} overflow="hidden">{packages.length ? packages.slice(0, 6).map((item, index) => { const width = Math.max(12, Math.round((item.size / Math.max(total, 1)) * 100)); const bar = "█".repeat(Math.max(2, Math.round((item.size / maximum) * 12))); return <box key={item.path} width={`${Math.min(48, width)}%`} minWidth={12} flexDirection="column" borderStyle="rounded" borderColor={index === 0 ? theme.colors.primary : theme.colors.border} paddingLeft={1}><text fg={index === 0 ? theme.colors.primary : theme.colors.foreground}><b>{item.name}</b></text><text fg={theme.colors.success}>{bar}</text><text fg={theme.colors.mutedForeground}>{formatSize(item.size)}</text></box>; }) : <box flexGrow={1} alignItems="center" justifyContent="center"><text fg={theme.colors.mutedForeground}>▧ 等待缓存扫描</text></box>}</box>;
}
function CacheRow({ item, index, maximum }: { item: CachePackage; index: number; maximum: number }) { const theme = useTerminalTheme(), cells = Math.max(1, Math.round((item.size / maximum) * 10)); return <box height={3} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between"><box flexDirection="column"><text fg={theme.colors.foreground}><b>{`${index % 2 ? "◷" : "▣"} ${item.name}#${item.version}`}</b></text><text fg={theme.colors.mutedForeground}>{item.filename}</text></box><box flexDirection="column" alignItems="flex-end"><text fg={theme.colors.success}>{formatSize(item.size)}</text><text fg={theme.colors.primary}>{`${"▰".repeat(cells)}${"▱".repeat(10 - cells)}`}</text></box></box>; }
function DangerConfirm({ action, count, size, onConfirm, onDismiss }: { action: string; count: number; size: number; onConfirm: () => void; onDismiss: () => void }) { const theme = useTerminalTheme(); return <box width="100%" height="100%" alignItems="center" justifyContent="center"><box width="68%" height={11} flexDirection="column" borderStyle="double" borderColor={theme.colors.error} paddingLeft={2} paddingRight={2}><text fg={theme.colors.error}><b>⚠ 确认 Scoop 系统操作</b></text><text>{`${actionButton(action)} · ${count} 个目标 · ${formatSize(size)}`}</text><text fg={theme.colors.mutedForeground}>永久清理无法撤销；建议优先选择备份操作。</text><box flexGrow={1}/><box flexDirection="row" gap={2}><WorkbenchButton id="confirm-execute" danger onClick={onConfirm}>确认执行</WorkbenchButton><WorkbenchButton id="confirm-dismiss" onClick={onDismiss}>返回检查</WorkbenchButton></box></box></box>; }
function actionButton(action: string) { return action === "cache_list" ? "⌕ 扫描缓存" : action === "cache_backup" ? "▣ 备份过期项" : action === "cache_delete" ? "⌫ 永久清理" : action === "sync" ? "↻ 同步 Bucket" : action === "install" ? "＋ 安装软件包" : "◉ 检查状态"; }
function phase(value: string) { return value === "running" ? "SCANNING" : value === "paused" ? "PAUSED" : value === "result" ? "COMPLETE" : "CACHE READY"; }
