import { useState } from "react"
import type { XlchemyFormat } from "@xiranite/node-xlchemy/core"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { FORMATS } from "./constants"

export function XlchemyFormatField(props: {
  ariaLabel?: string
  formats?: XlchemyFormat[]
  label?: string
  onChange: (format: XlchemyFormat) => void
  value: XlchemyFormat
}) {
  const allowed = props.formats ? new Set(props.formats) : undefined
  const formats = allowed ? FORMATS.filter((item) => allowed.has(item.value)) : FORMATS
  return <Field className="gap-1"><FieldLabel className="text-[10px]">{props.label ?? "目标格式"}</FieldLabel><Select value={props.value} onValueChange={(format) => props.onChange(format as XlchemyFormat)}><SelectTrigger aria-label={props.ariaLabel ?? "目标格式"} className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{formats.map((item) => <SelectItem key={item.value} value={item.value}>{item.label} · {item.extension}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
}

export function XlchemySliderField({ disabled, displayValue, editable, label, value, min, max, step = 1, onChange }: {
  disabled?: boolean
  displayValue?: string
  editable?: boolean
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const update = (next: number) => onChange(Math.min(max, Math.max(min, next)))
  const commit = () => {
    const next = Number(draft)
    if (Number.isFinite(next)) update(next)
    setEditing(false)
  }
  const editableValue = <Popover open={editing} onOpenChange={setEditing}>
    <PopoverAnchor className="inline-flex">
      <Badge aria-label={`${label}数值`} aria-valuemax={max} aria-valuemin={min} aria-valuenow={value} className="xiranite-no-drag cursor-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" role="spinbutton" tabIndex={0} variant="outline" onClick={() => { setDraft(String(value)); setEditing(true) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setDraft(String(value)); setEditing(true) } else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); update(value + (event.key === "ArrowUp" ? step : -step)) } }} onWheel={(event) => { event.preventDefault(); update(value + (event.deltaY < 0 ? step : -step)) }}>{value}</Badge>
    </PopoverAnchor>
    <PopoverContent className="w-28 p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
      <Input autoFocus aria-label={`编辑${label}`} className="h-8 text-center tabular-nums" min={min} max={max} step={step} type="number" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
    </PopoverContent>
  </Popover>
  return <Field className="gap-1.5"><div className="flex items-center justify-between gap-2"><FieldLabel className="text-[10px]">{label}</FieldLabel>{editable && !disabled ? editableValue : <Badge variant="outline">{displayValue ?? value}</Badge>}</div><Slider aria-label={label} disabled={disabled} min={min} max={max} step={step} value={[value]} onValueChange={(values) => onChange(values[0] ?? value)} /></Field>
}
