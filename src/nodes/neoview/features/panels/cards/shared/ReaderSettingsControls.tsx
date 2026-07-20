import type { ReactNode } from "react"

import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function ReaderSettingsSection({ title, description, icon, action, children, className }: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-2.5 rounded-md border border-border/40 bg-accent/10 p-2.5", className)} data-reader-settings-section={title}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            {icon}
            <span>{title}</span>
          </div>
          {description ? <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground/70">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

export function ReaderSettingsToggle({ label, description, checked, disabled = false, onCheckedChange }: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-3", disabled && "opacity-50")}>
      <div className="min-w-0 pt-0.5">
        <div className="text-[10px] font-medium leading-tight text-foreground">{label}</div>
        {description ? <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground/70">{description}</p> : null}
      </div>
      <Switch
        size="sm"
        className="shrink-0"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export function ReaderSettingsSlider({ label, value, min, max, step = 1, suffix = "", disabled = false, minLabel, maxLabel, valueFormatter, onPreview, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  minLabel?: string
  maxLabel?: string
  valueFormatter?(value: number): string
  onPreview(value: number): void
  onCommit(value: number): void
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-40")}>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <output className="font-mono tabular-nums text-foreground">{valueFormatter?.(value) ?? formatValue(value, step)}{suffix}</output>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        className="h-4"
        onValueChange={(values) => {
          const next = values[0]
          if (next !== undefined) onPreview(next)
        }}
        onValueCommit={(values) => {
          const next = values[0]
          if (next !== undefined) {
            onPreview(next)
            onCommit(next)
          }
        }}
      />
      {minLabel || maxLabel ? (
        <div className="flex justify-between text-[8px] text-muted-foreground/50">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

function formatValue(value: number, step: number): string {
  return step < 1 ? String(Math.round(value * 100) / 100) : String(value)
}
