import { useState, type ComponentType, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"

import { BlurFade } from "@/components/ui/blur-fade"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { SettingsStepId } from "./types"

export function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
      <span className="text-[10px] font-mono tracking-widest text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-xs font-mono text-foreground" title={value}>{value}</span>
    </div>
  )
}

export function PreferenceToggle({
  label,
  labels,
  onChange,
  value,
  values,
}: {
  label: string
  labels: Record<string, string>
  onChange: (value: string) => void
  value: string
  values: readonly string[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => next && onChange(next)}
        variant="outline"
        size="sm"
        spacing={2}
        className="grid w-full grid-cols-4 gap-1.5"
      >
        {values.map((item) => (
          <ToggleGroupItem key={item} value={item} className="min-w-0 px-1.5 text-[11px]">
            {labels[item] ?? item}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function AlphabetIndexSlider({
  label,
  value,
  min,
  max,
  current,
  onValueChange,
}: {
  label: string
  value: string
  min: number
  max: number
  current: number
  onValueChange(value: number): void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-foreground">{label}</span>
        <span className="text-xs font-mono text-muted-foreground">{value}</span>
      </div>
      <Slider
        aria-label={label}
        value={[current]}
        onValueChange={([next]) => onValueChange(next)}
        min={min}
        max={max}
        step={1}
      />
    </div>
  )
}

/** Step card: light surface + optional BlurFade + advanced collapsible. Avoids MagicCard/BorderBeam per-card cost. */
export function SettingsStepCard({
  id,
  title,
  description,
  icon: Icon,
  actions,
  advanced,
  defaultOpen = true,
  children,
  className,
  delay = 0,
}: {
  id: SettingsStepId
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  actions?: ReactNode
  advanced?: boolean
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  delay?: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen && !advanced)

  const body = (
    <div className={cn("overflow-hidden rounded-md border border-border/70 bg-card/80", className)}>
      {advanced ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 border-b border-border/50 px-4 py-3 text-left">
            <StepHeader icon={Icon} title={title} description={description} advanced actions={actions} advancedLabel={t("settings:timeline.advanced")} />
            <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-4 p-4">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
            <StepHeader icon={Icon} title={title} description={description} actions={actions} />
          </div>
          <div className="space-y-4 p-4">{children}</div>
        </>
      )}
    </div>
  )

  return (
    <div id={`settings-step-${id}`} data-settings-step={id} className="scroll-mt-4">
      {/* Short delay only; no continuous beam animations on every card. */}
      <BlurFade delay={Math.min(delay, 0.12)} offset={6} direction="up" inView={false}>
        {body}
      </BlurFade>
    </div>
  )
}

function StepHeader({
  icon: Icon,
  title,
  description,
  advanced,
  advancedLabel,
  actions,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  advanced?: boolean
  advancedLabel?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      {Icon ? (
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm border border-border/50 bg-muted/30">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {advanced ? (
            <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              {advancedLabel}
            </span>
          ) : null}
          {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {description ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  )
}
