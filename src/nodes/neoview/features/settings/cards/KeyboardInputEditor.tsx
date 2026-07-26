import type { ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"
import { Radio } from "lucide-react"
import type { MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function KeyboardInputEditor({ input, disabled, recording, onRecord, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "keyboard" }>
  disabled: boolean
  recording: boolean
  onRecord(event: MouseEvent<HTMLButtonElement>): void
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-1">
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-1">
      <Input className="h-8 text-xs" value={input.code} disabled={disabled || recording} onChange={(event) => onChange({ ...input, code: event.currentTarget.value })} aria-label="键盘代码" />
      <select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.trigger ?? "down"} disabled={disabled || recording} onChange={(event) => onChange(event.currentTarget.value === "hold" ? { ...input, trigger: "hold", durationMs: input.durationMs ?? 450 } : { device: "keyboard", code: input.code, ctrl: input.ctrl, alt: input.alt, shift: input.shift, meta: input.meta })} aria-label="键盘触发方式"><option value="down">按下</option><option value="hold">长按</option></select>
      <Button type="button" size="sm" variant={recording ? "default" : "outline"} disabled={disabled && !recording} onClick={onRecord} aria-label={recording ? "取消录制键盘输入" : "录制键盘输入"}><Radio />{recording ? "录制中" : "录制"}</Button>
    </div>
    <KeyboardModifierEditor input={input} disabled={disabled || recording} onChange={onChange} />
    {input.trigger === "hold" ? <label className="grid gap-0.5 text-[10px] text-muted-foreground">长按毫秒<Input className="h-8 text-xs" type="number" min={100} max={5000} value={input.durationMs ?? 450} disabled={disabled || recording} onChange={(event) => onChange({ ...input, durationMs: Number(event.currentTarget.value) })} /></label> : null}
  </div>
}

function KeyboardModifierEditor({ input, disabled, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "keyboard" }>
  disabled: boolean
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{(["ctrl", "alt", "shift", "meta"] as const).map((key) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(input[key])} disabled={disabled} onChange={(event) => onChange({ ...input, [key]: event.currentTarget.checked || undefined })} />{modifierLabel(key)}</label>)}</div>
}

function modifierLabel(key: "ctrl" | "alt" | "shift" | "meta"): string {
  return key === "ctrl" ? "Ctrl" : key === "alt" ? "Alt" : key === "shift" ? "Shift" : "Meta"
}
