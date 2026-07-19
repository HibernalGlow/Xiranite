import { Info, X } from "lucide-react"
import { useSyncExternalStore, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

import type { ReaderSwitchToastPort } from "./ReaderSwitchToastStore"

export function ReaderSwitchToastHost({ port }: { port: ReaderSwitchToastPort }) {
  const settings = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot)
  const messages = useSyncExternalStore(port.subscribeMessages, port.getMessages, port.getMessages)
  if (!messages.length) return null
  const style = {
    left: settings.positionX,
    top: settings.positionY,
    "--reader-switch-toast-opacity": settings.opacity,
  } as CSSProperties

  return (
    <div
      className="pointer-events-none fixed z-[90] grid w-[min(22rem,calc(100vw-1rem))] gap-2"
      style={style}
      aria-live="polite"
      aria-atomic="false"
      data-reader-switch-toast-host="true"
    >
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "pointer-events-auto flex min-h-12 items-start gap-2 rounded-md border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg",
            settings.liquidGlass && "border-white/25 bg-background/65 shadow-xl backdrop-blur-xl backdrop-saturate-150",
          )}
          style={{ opacity: "var(--reader-switch-toast-opacity)" }}
          data-reader-switch-toast="true"
          data-liquid-glass={settings.liquidGlass ? "true" : "false"}
        >
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-5">{message.title}</p>
            {message.description ? <p className="break-words text-[11px] leading-4 text-muted-foreground">{message.description}</p> : null}
          </div>
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="关闭切换提示"
            title="关闭切换提示"
            onClick={() => port.dismiss(message.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
