import { useId, useState } from "react"
import { DatabaseZap, ExternalLink, Eye, RefreshCw, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { useNodeI18n } from "./useNodeI18n"

type NodeT = ReturnType<typeof useNodeI18n>["t"]

export interface NodeConfigPopoverProps {
  configPath?: string
  defaults?: Record<string, unknown>
  dirty: boolean
  disabled?: boolean
  loading?: boolean
  t: NodeT
  onOpenFile?: () => Promise<void> | void
  onReload: () => Promise<void> | void
  onRestore: () => void
  onSave: () => Promise<void> | void
  preset?: {
    value?: string
    options: Array<{ value: string; label: string; description?: string }>
    onValueChange: (value: string) => Promise<void> | void
  }
}

/**
 * Shared configuration-management control for nodes. Nodes retain ownership
 * of which fields are persistable; this component only presents the common
 * save / restore / inspect / open-file workflow.
 */
export function NodeConfigPopover(props: NodeConfigPopoverProps) {
  const presetId = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<"preset" | "reload" | "save" | "restore" | "open" | null>(null)
  const disabled = Boolean(props.disabled || props.loading || busy)
  const hasDefaults = Boolean(props.defaults && Object.keys(props.defaults).length)

  async function perform(kind: NonNullable<typeof busy>, action: () => Promise<void> | void) {
    setBusy(kind)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={props.t("config.trigger", "配置管理")}
              disabled={disabled}
              size="icon-sm"
              variant={props.dirty ? "secondary" : "outline"}
            >
              <DatabaseZap />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{props.t("config.trigger", "配置管理")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,360px)]">
        <div className="mb-4">
          <div className="text-sm font-semibold">{props.t("config.title", "配置管理")}</div>
          <p className="text-xs text-muted-foreground">{props.t("config.description", "保存可复用默认值，或恢复本节点的已保存配置。")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {props.preset && <>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={presetId}>{props.t("config.preset", "预设")}</FieldLabel>
              <Select disabled={disabled} value={props.preset.value} onValueChange={(value) => void perform("preset", () => props.preset?.onValueChange(value))}>
                <SelectTrigger id={presetId} className="w-full" size="sm"><SelectValue placeholder={props.t("config.presetPlaceholder", "选择预设")} /></SelectTrigger>
                <SelectContent><SelectGroup>{props.preset.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription className="text-xs">{props.preset.options.find((option) => option.value === props.preset?.value)?.description ?? props.t("config.presetDescription", "切换后保存为默认，即写入 TOML 配置。")}</FieldDescription>
            </Field>
            <Separator />
          </>}
          <Button disabled={disabled} size="sm" onClick={() => void perform("save", props.onSave)}><Save data-icon="inline-start" />{props.t("config.save", "保存为默认")}</Button>
          <Button disabled={disabled || !hasDefaults} size="sm" variant="outline" onClick={() => void perform("restore", props.onRestore)}><RotateCcw data-icon="inline-start" />{props.t("config.restore", "恢复默认")}</Button>
          <Button disabled={disabled} size="sm" variant="outline" onClick={() => void perform("reload", props.onReload)}><RefreshCw data-icon="inline-start" />{props.t("config.reload", "重新读取")}</Button>
          <Separator />
          <Dialog>
            <DialogTrigger asChild>
              <Button disabled={!hasDefaults} size="sm" variant="ghost"><Eye data-icon="inline-start" />{props.t("config.view", "查看配置")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{props.t("config.previewTitle", "默认配置")}</DialogTitle>
                <DialogDescription>{props.configPath ?? props.t("config.noPath", "尚未连接配置文件")}</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[50vh] rounded-md border bg-muted/30">
                <pre className="p-3 text-xs leading-5">{JSON.stringify(props.defaults, null, 2)}</pre>
              </ScrollArea>
            </DialogContent>
          </Dialog>
          <Button disabled={disabled || !props.onOpenFile} size="sm" variant="ghost" onClick={() => void perform("open", () => props.onOpenFile?.())}><ExternalLink data-icon="inline-start" />{props.t("config.openFile", "打开配置文件")}</Button>
        </div>
        {props.dirty && <p className={cn("mt-3 text-xs text-muted-foreground")}>{props.t("config.dirty", "当前参数与已保存默认值不同。")}</p>}
      </PopoverContent>
    </Popover>
  )
}
