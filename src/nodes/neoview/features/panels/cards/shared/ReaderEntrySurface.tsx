import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

export type ReaderEntrySurfaceVariant = "compact" | "content" | "banner" | "thumbnail"

export interface ReaderEntrySurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant: ReaderEntrySurfaceVariant
  selected?: boolean
  focused?: boolean
  current?: boolean
  leading?: ReactNode
  media?: ReactNode
  primary: ReactNode
  secondary?: ReactNode
  tertiary?: ReactNode
  metadata?: ReactNode
  trailing?: ReactNode
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
}

export function ReaderEntrySurface({
  variant,
  selected = false,
  focused = false,
  current = false,
  leading,
  media,
  primary,
  secondary,
  tertiary,
  metadata,
  trailing,
  buttonProps,
  className,
  ...rootProps
}: ReaderEntrySurfaceProps) {
  const { className: buttonClassName, ...interactiveProps } = buttonProps ?? {}
  const grid = variant === "banner" || variant === "thumbnail"

  return (
    <div
      {...rootProps}
      className={cn(
        "min-w-0 overflow-hidden bg-background text-xs hover:bg-muted data-[selected=true]:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary",
        variant === "compact" && "flex h-[34px] w-full items-center gap-1 border-b px-1",
        variant === "content" && "flex h-[76px] w-full items-center gap-1 border-b px-1",
        // Fill the virtual-list cell; height is driven by the adaptive row pitch.
        variant === "banner" && "h-full w-full rounded border data-[selected=true]:border-primary",
        variant === "thumbnail" && "h-full w-full rounded border data-[current=true]:border-primary data-[current=true]:ring-1 data-[current=true]:ring-primary",
        className,
      )}
      data-reader-entry-surface="true"
      data-entry-variant={variant}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      data-current={current || undefined}
    >
      {leading}
      <button
        type="button"
        {...interactiveProps}
        className={cn(
          "min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          !grid && "flex h-full flex-1 items-center gap-2 rounded px-1",
          // Media takes ~42% of the card width so covers grow with the panel.
          variant === "banner" && "grid size-full grid-cols-[minmax(7rem,42%)_minmax(0,1fr)] overflow-hidden",
          variant === "thumbnail" && "grid size-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden",
          buttonClassName,
        )}
      >
        {media ? (
          <span
            className={cn(
              "min-h-0 min-w-0 overflow-hidden",
              variant === "banner" && "h-full w-full",
              variant === "thumbnail" && "h-full w-full",
              !grid && "contents",
            )}
            data-reader-entry-media="true"
          >
            {media}
          </span>
        ) : null}
        <span className={cn(
          "min-w-0",
          !grid && "grid flex-1 gap-1",
          variant === "banner" && "grid content-center gap-1 px-2 py-1.5",
          variant === "thumbnail" && "flex min-h-9 items-center gap-1 border-t px-1.5 py-1.5",
        )}>
          <span className={cn("min-w-0 truncate", variant === "banner" && "font-medium")}>{primary}</span>
          {secondary ? <span className="min-w-0 truncate text-[10px] text-muted-foreground">{secondary}</span> : null}
          {tertiary ? <span className="min-w-0 truncate text-[10px] text-muted-foreground">{tertiary}</span> : null}
        </span>
        {metadata}
      </button>
      {trailing}
    </div>
  )
}
