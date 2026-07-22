import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

export interface SwimlaneInteractionSettingsValue {
  soloOnFocus: boolean
  showNavigatorInSolo: boolean
  edgeRevealDelayMs: number
  focusOnHover: boolean
  focusDelayMs: number
}

export function SwimlaneInteractionSettings({ value, labels, onChange }: {
  value: SwimlaneInteractionSettingsValue
  labels?: Partial<Record<"soloOnFocus" | "showNavigatorInSolo" | "edgeRevealDelay" | "focusOnHover" | "focusDelay", string>>
  onChange(patch: Partial<SwimlaneInteractionSettingsValue>): void
}) {
  const [edgeDelay, setEdgeDelay] = useState(String(value.edgeRevealDelayMs))
  const [focusDelay, setFocusDelay] = useState(String(value.focusDelayMs))

  useEffect(() => setEdgeDelay(String(value.edgeRevealDelayMs)), [value.edgeRevealDelayMs])
  useEffect(() => setFocusDelay(String(value.focusDelayMs)), [value.focusDelayMs])

  function commitDelay(kind: "edge" | "focus") {
    const current = kind === "edge" ? value.edgeRevealDelayMs : value.focusDelayMs
    const raw = kind === "edge" ? edgeDelay : focusDelay
    const minimum = kind === "edge" ? 100 : 200
    const next = Math.min(5_000, Math.max(minimum, Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : current))
    if (kind === "edge") setEdgeDelay(String(next))
    else setFocusDelay(String(next))
    if (next !== current) onChange(kind === "edge" ? { edgeRevealDelayMs: next } : { focusDelayMs: next })
  }

  return <div className="grid gap-3" data-swimlane-interaction-settings="true">
    <SettingSwitch label={labels?.soloOnFocus ?? "主泳道聚焦时自动全屏"} checked={value.soloOnFocus} onCheckedChange={(soloOnFocus) => onChange({ soloOnFocus })} />
    <SettingSwitch label={labels?.showNavigatorInSolo ?? "独占时显示泳道切换栏"} checked={value.showNavigatorInSolo} onCheckedChange={(showNavigatorInSolo) => onChange({ showNavigatorInSolo })} />
    <DelaySetting label={labels?.edgeRevealDelay ?? "左右泳道展开延迟"} value={edgeDelay} min={100} disabled={false} onChange={setEdgeDelay} onCommit={() => commitDelay("edge")} />
    <div className="grid gap-2 border-t border-border/55 pt-3">
      <SettingSwitch label={labels?.focusOnHover ?? "悬停后重新聚焦"} checked={value.focusOnHover} onCheckedChange={(focusOnHover) => onChange({ focusOnHover })} />
      <DelaySetting label={labels?.focusDelay ?? "重新聚焦延迟"} value={focusDelay} min={200} disabled={!value.focusOnHover} onChange={setFocusDelay} onCommit={() => commitDelay("focus")} compact />
    </div>
  </div>
}

function SettingSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange(checked: boolean): void }) {
  return <label className="flex min-h-8 items-center justify-between gap-4 border-t border-border/55 pt-3 first:border-t-0 first:pt-0 text-sm">
    <span>{label}</span>
    <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
  </label>
}

function DelaySetting({ label, value, min, disabled, compact = false, onChange, onCommit }: { label: string; value: string; min: number; disabled: boolean; compact?: boolean; onChange(value: string): void; onCommit(): void }) {
  return <label className={compact ? "grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3" : "grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 border-t border-border/55 pt-3"}>
    <span className="text-sm">{label}</span>
    <Input aria-label={label} type="number" min={min} max={5_000} step={50} disabled={disabled} value={value} onChange={(event) => onChange(event.currentTarget.value)} onBlur={onCommit} onKeyDown={(event) => { if (event.key === "Enter") onCommit() }} />
  </label>
}
