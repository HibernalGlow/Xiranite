import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const NODE_CHROME_PILL_CLASS_NAME = "xiranite-node-chrome-pill flex items-center gap-0.5 rounded-[4px] border border-transparent bg-background/45 p-0.5 shadow-sm backdrop-blur-md ring-1 ring-border/20"
export const NODE_CHROME_ACTION_CLASS_NAME = "text-muted-foreground hover:text-primary"

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
      data-node-chrome-action
      data-node-chrome-danger={danger || undefined}
      className={cn(
        NODE_CHROME_ACTION_CLASS_NAME,
        danger && "hover:bg-destructive/10 hover:text-destructive",
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

export function NodeChromeActionPreview({
  className,
  danger = false,
  ...props
}: ComponentProps<"span"> & { danger?: boolean }) {
  return (
    <span
      data-node-chrome-action
      data-node-chrome-danger={danger || undefined}
      className={cn(
        NODE_CHROME_ACTION_CLASS_NAME,
        "grid size-6 place-items-center rounded-md transition-colors hover:bg-accent [&_svg]:size-3",
        danger && "hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      {...props}
    />
  )
}
