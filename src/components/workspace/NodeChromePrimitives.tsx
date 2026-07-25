import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const NODE_CHROME_PILL_CLASS_NAME = "xiranite-node-chrome-pill flex items-center gap-0.5 rounded-[4px] border border-transparent bg-background/45 p-0.5 shadow-sm backdrop-blur-md ring-1 ring-border/20"

export function NodeChromePill({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(NODE_CHROME_PILL_CLASS_NAME, className)} {...props} />
}

export function NodeChromeActionButton({
  className,
  danger = false,
  onPointerDown,
  ...props
}: ComponentProps<typeof Button> & { danger?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        "text-muted-foreground",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:text-primary",
        className,
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
        onPointerDown?.(event)
      }}
      {...props}
    />
  )
}
