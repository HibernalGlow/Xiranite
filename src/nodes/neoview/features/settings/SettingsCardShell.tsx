import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"
import { useReaderCardChrome } from "../panels/ReaderCardChromeContext"

export function SettingsCardShell({
  id,
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
}: {
  id: string
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const embeddedInReaderCard = useReaderCardChrome()
  return (
    <section className={cn("flex flex-col gap-3 rounded-md border bg-card/50 p-3", embeddedInReaderCard && "rounded-none border-0 bg-transparent p-0", className)} data-neoview-settings-card={id}>
      {embeddedInReaderCard ? (
        description || actions ? <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
          {description ? <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : <span />}
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div> : null
      ) : <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold leading-none">
            {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
            {title}
          </h2>
          {description ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

export function SettingsCardSection({
  title,
  description,
  children,
}: {
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3">
      {title || description ? (
        <div className="grid gap-1">
          {title ? <h3 className="text-xs font-semibold">{title}</h3> : null}
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function SettingsToggleRow({
  label,
  description,
  control,
}: {
  label: string
  description?: string
  control: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

export function SettingsUnavailableNote({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="grid gap-1.5 rounded-md border border-dashed bg-muted/10 px-3 py-3" data-neoview-settings-card="unavailable">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>
    </section>
  )
}
