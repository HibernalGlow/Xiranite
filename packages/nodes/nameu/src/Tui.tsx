/* @jsxImportSource @opentui/react */
/**
 * The nameu workbench (ADR-0074 §5).
 *
 * This screen is presentation only. It never imports `core.ts` as a value and never touches the machine: every
 * number and row it shows comes from `definition.run`, which `cli.ts` binds to the host's
 * `POST /nodes/nameu/operations`, and every control it offers (pause, resume, cancel) is the same definition
 * addressing the operation this face started. A host that cannot be reached is refused in `cli.ts` before the
 * renderer opens, so no prompt here can produce a locally computed plan.
 */
import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import {
  ActionLauncher,
  ExecutionActions,
  ProgressBar,
  TerminalThemeProvider,
  WorkbenchField,
  WorkbenchPanel,
  resolveTerminalTheme,
  terminalIcon,
  useAnimation,
  useTerminalChromeActions,
  useTerminalTheme,
  useTerminalUiSession,
} from "@xiranite/cli-runtime/terminal/opentui"
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n"
import type { NameuInput, NameuPlanItem, NameuResult } from "./core.js"

export function NameuTui(p: TerminalUiScreenProps<NameuInput, NameuResult>): import("react").ReactNode {
  const [theme] = useState(p.theme ?? p.preferences?.current.theme ?? "nord")
  return <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}><Desk {...p}/></TerminalThemeProvider>
}

/**
 * One screen, two jobs: the rule matrix on the left drives the plan, the projection on the right is the host's
 * result document rendered row by row. `docs/nameu-tui-visual-review.md` is the layout source of truth.
 */
function Desk({ definition, language, onExit }: TerminalUiScreenProps<NameuInput, NameuResult>) {
  const th = useTerminalTheme()
  const t = createTerminalTranslator(language)
  const s = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: s.phase === "running" ? 85 : 480 })
  const d = s.result?.data
  useTerminalChromeActions({ onReset: s.reset, onExit })
  useKeyboard((k) => {
    if (k.name === "escape") onExit()
  })
  const field = (id: string) => definition.schema.fields.find((x) => x.id === id)!
  const F = ({ id }: { id: string }) => <WorkbenchField field={field(id)} value={s.values[id]} error={s.fieldErrors[id]} focused={s.focusedControlId === id} disabled={s.phase === "running"} t={t} onFocus={() => s.focus(id)} onChange={(v) => s.setField(id, v)}/>
  const flow = ["A → · → Z", "A · → → Z", "A → → · Z", "A → · → Z"][frame % 4]
  return <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden"><box height={4} flexShrink={0} borderStyle="single" borderColor={th.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between"><box flexDirection="column"><text fg={th.colors.primary}><b>{`${terminalIcon("status")} NAMEU // RENAME REVIEW DESK`}</b></text><text fg={th.colors.mutedForeground}>规则矩阵 · 名称投影 · 冲突检查</text></box><box alignItems="flex-end"><text fg={s.phase === "running" ? th.colors.warning : th.colors.success}>{s.phase === "running" ? "NORMALIZING" : "RULES READY"}</text><text fg={th.colors.focusRing}>{flow}</text></box></box><box height={3} flexShrink={0} marginTop={1} flexDirection="row" justifyContent="space-between"><ActionLauncher id="nameu-command" field={field("action")} session={s}/>{s.confirming || s.phase === "running" || s.phase === "paused" ? <ExecutionActions session={s} confirmLabel="⇄ 确认改名"/> : null}</box><box height={8} flexShrink={0} marginTop={1} flexDirection="row" gap={1}><WorkbenchPanel title="▦ 输入队列" description="作者目录或资料库根目录" width="35%"><F id="pathsText"/></WorkbenchPanel><WorkbenchPanel title="⌁ 规则矩阵" description={flow} flexGrow={1}><box flexDirection="row" gap={1}><box width="22%"><F id="mode"/></box><box width="15%"><F id="recursive"/></box><box width="18%"><F id="addArtistName"/></box><box width="20%"><F id="normalizeFolders"/></box><box flexGrow={1}><F id="keepTimestamp"/></box></box></WorkbenchPanel></box><box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}><WorkbenchPanel title={`⇄ 改名投影 · ${d?.items.length ?? 0}`} description="原名称 → 目标名称" width="78%"><box height={2} flexDirection="row"><box width={12}><text fg={th.colors.mutedForeground}>状态</text></box><box width="38%"><text fg={th.colors.mutedForeground}>原名称</text></box><box flexGrow={1}><text fg={th.colors.mutedForeground}>目标投影</text></box></box><scrollbox id="nameu-plan" flexGrow={1}>{d?.items.length ? d.items.map((x, i) => <Row key={`${x.sourcePath}-${i}`} item={x}/>) : <text fg={th.colors.mutedForeground}>点击扫描或预览后显示名称变化。</text>}</scrollbox></WorkbenchPanel><WorkbenchPanel title="◫ 操作统计" description="就绪、冲突与执行" flexGrow={1}><M l="扫描" v={d?.scannedCount ?? 0}/><M l="就绪" v={d?.readyCount ?? 0} c={th.colors.success}/><M l="改名" v={d?.renamedCount ?? 0} c={th.colors.primary}/><M l="冲突" v={d?.conflictCount ?? 0} c={th.colors.warning}/><M l="错误" v={d?.errorCount ?? 0} c={th.colors.error}/><scrollbox flexGrow={1}>{d?.errors.map((x, i) => <text key={`${x}-${i}`} fg={th.colors.error}>{x}</text>)}</scrollbox><ProgressBar value={s.progress} label={s.status || "REVIEW READY"}/></WorkbenchPanel></box></box>
}

/** One planned rename, coloured by the status the host reported for it. */
function Row({ item: x }: { item: NameuPlanItem }) {
  const t = useTerminalTheme()
  const color = x.status === "ready" || x.status === "renamed"
    ? t.colors.success
    : x.status === "conflict"
      ? t.colors.warning
      : x.status === "error"
        ? t.colors.error
        : t.colors.mutedForeground
  const icon = x.status === "ready" ? "✓" : x.status === "renamed" ? "⇄" : x.status === "conflict" ? "⚠" : x.status === "error" ? "×" : "○"
  return <box height={3} flexShrink={0} flexDirection="row" alignItems="center"><box width={12}><text fg={color}>{`${icon} ${x.status}`}</text></box><box width="38%" flexDirection="column"><text fg={t.colors.foreground}>{x.sourceName}</text><text fg={t.colors.mutedForeground}>{`${x.artistName} · ${x.kind}`}</text></box><box flexGrow={1}><text fg={color}>{`→ ${x.targetName}`}</text></box></box>
}

/** A single metric line in the statistics panel. */
function M({ l, v, c }: { l: string; v: number; c?: string }) {
  const t = useTerminalTheme()
  return <box flexDirection="row" justifyContent="space-between"><text fg={c ?? t.colors.mutedForeground}>{l}</text><text fg={c ?? t.colors.foreground}><b>{String(v).padStart(2, "0")}</b></text></box>
}
