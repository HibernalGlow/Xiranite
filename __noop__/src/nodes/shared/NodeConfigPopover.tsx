import { useEffect, useId, useRef, useState } from "react"
import { DatabaseZap, Download, Eraser, ExternalLink, Eye, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2, Upload } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "./useNodeI18n"

type NodeT = ReturnType<typeof useNodeI18n>["t"]

export interface NodeConfigPopoverProps {
  configPath?: string
  autoRestoreKey?: string
  defaults?: Record<string, unknown>
  fallbackDefaults?: Record<string, unknown>
  dirty: boolean
  triggerLabel?: string
  disabled?: boolean
  loading?: boolean
  t: NodeT
  onOpenFile?: () => Promise<void> | void
  onReload: () => Promise<void> | void
  onRestore: () => void
  onSave: () => Promise<void> | void
  onClearOverride?: () => Promise<void> | void
  preset?: {
    value?: string
    options: Array<{ value: string; label: string; description?: string; editable?: boolean; values?: Record<string, unknown> }>
    onValueChange: (value: string) => Promise<void> | void
    onCreate?: (name: string) => Promise<void> | void
    onDelete?: (value: string) => Promise<void> | void
    onOverwrite?: (value: string) => Promise<void> | void
    onRename?: (value: string, name: string) => Promise<void> | void
    onExport?: () => Promise<void> | void
    onImport?: (serialized: string) => Promise<void> | void
  }
}

export interface NodeConfigButtonProps {
  nodeKey: string
  configDirty: boolean
  configFilePath?: string
  defaults?: Record<string, unknown>
  uiDefaults?: Record<string, unknown>
  disabled?: boolean
  onOpenConfigFile?: () => Promise<void> | void
    onResetOverride: () => Promise<void> | void
  onRestoreDefault: () => Promise<void> | void
  onSaveDefault: () => Promise<void> | void
}

/** Compatibility entry point for nodes that used the old duplicated config popovers. */
export function NodeConfigButton(props: NodeConfigButtonProps) {
  const { t } = useNodeI18n(props.nodeKey)
  const defaults = props.defaults || props.uiDefaults
    ? { ...(props.defaults ?? {}), ...(props.uiDefaults ?? {}) }
    : undefined
  return <NodeConfigPopover
    configPath={props.configFilePath}
    autoRestoreKey={props.nodeKey}
    defaults={defaults}
    dirty={props.configDirty}
    triggerLabel={props.nodeKey === "owithu" ? `owithu ${t("defaults.title", "默认配置")}` : `${props.nodeKey} defaults`}
    disabled={props.disabled}
    t={t}
    onOpenFile={props.onOpenConfigFile}
    onReload={props.onResetOverride}
    onRestore={props.onRestoreDefault}
    onSave={props.onSaveDefault}
    onClearOverride={props.onResetOverride}
  />
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
  const [presetEditor, setPresetEditor] = useState<"create" | "rename" | null>(null)
  const [presetName, setPresetName] = useState("")
  const [presetConfirmation, setPresetConfirmation] = useState<"delete" | "overwrite" | null>(null)
  const [presetImportOpen, setPresetImportOpen] = useState(false)
  const [presetImportText, setPresetImportText] = useState("")
  const autoRestoreKey = props.autoRestoreKey ?? (props.configPath ? `config:${props.configPath}` : undefined)
  const [autoRestore, setAutoRestore] = useState(() => autoRestoreKey ? window.localStorage.getItem(`xiranite:auto-restore:${autoRestoreKey}`) === "1" : false)
  const autoRestoredRef = useRef(false)
  const disabled = Boolean(props.disabled || props.loading || busy)
  const effectiveDefaults = props.defaults && Object.keys(props.defaults).length
    ? props.defaults
    : props.fallbackDefaults
  const hasDefaults = effectiveDefaults !== undefined
  const selectedPreset = props.preset?.options.find((option) => option.value === props.preset?.value)
  const selectedPresetEditable = selectedPreset?.editable === true
  const triggerLabel = props.triggerLabel ?? props.t("config.trigger", "配置管理")

  useEffect(() => {
    if (!autoRestore || !effectiveDefaults || autoRestoredRef.current) return
    autoRestoredRef.current = true
    void props.onRestore()
  }, [autoRestore, effectiveDefaults, props.onRestore])

  function setAutoRestoreDefaults(enabled: boolean) {
    setAutoRestore(enabled)
    if (autoRestoreKey) window.localStorage.setItem(`xiranite:auto-restore:${autoRestoreKey}`, enabled ? "1" : "0")
  }

  async function perform(kind: NonNullable<typeof busy>, action: () => Promise<void> | void) {
    setBusy(kind)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  function beginPresetEditor(mode: "create" | "rename") {
    setPresetName(mode === "rename" ? selectedPreset?.label ?? "" : "")
    setPresetEditor(mode)
  }

  async function commitPresetEditor() {
    const name = presetName.trim()
    if (!name || !props.preset || !presetEditor) return
    const action = presetEditor === "create"
      ? () => props.preset?.onCreate?.(name)
      : () => props.preset?.onRename?.(props.preset?.value ?? "", name)
    await perform("preset", async () => { await action() })
    setPresetEditor(null)
    setPresetName("")
  }

  async function confirmPresetMutation(kind: "delete" | "overwrite") {
    if (!props.preset) return
    const action = kind === "overwrite"
      ? () => props.preset?.onOverwrite?.(props.preset?.value ?? "")
      : () => props.preset?.onDelete?.(props.preset?.value ?? "")
    await perform("preset", async () => { await action() })
    setPresetConfirmation(null)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={triggerLabel}
              disabled={disabled}
              size="icon-sm"
              variant={props.dirty ? "secondary" : "outline"}
            >
              <DatabaseZap />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{triggerLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,360px)]">
        <div className="mb-4">
          <div className="text-sm font-semibold">{props.t("config.title", "配置管理")}</div>
          <p className="text-xs text-muted-foreground">{props.t("config.description", "保存可复用默认值，或恢复本节点的已保存配置。")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {autoRestoreKey && <Field orientation="horizontal" className="items-center justify-between rounded-md border px-2.5 py-2"><FieldLabel className="text-xs">{props.t("config.autoRestore", "启动时恢复默认配置")}</FieldLabel><Switch checked={autoRestore} onCheckedChange={setAutoRestoreDefaults} /></Field>}
          {props.preset && <>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={presetId}>{props.t("config.preset", "预设")}</FieldLabel>
              <Select disabled={disabled} value={props.preset.value ?? ""} onValueChange={(value) => void perform("preset", () => props.preset?.onValueChange(value))}>
                <SelectTrigger id={presetId} className="w-full" size="sm"><SelectValue placeholder={props.t("config.presetPlaceholder", "选择预设")} /></SelectTrigger>
                <SelectContent><SelectGroup>{props.preset.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription className="text-xs">{props.preset.options.find((option) => option.value === props.preset?.value)?.description ?? props.t("config.presetDescription", "切换后保存为默认，即写入 TOML 配置。")}</FieldDescription>
            </Field>
            {(props.preset.onCreate || selectedPresetEditable) && (
              <div className="grid grid-cols-2 gap-2">
                {props.preset.onCreate && <Button disabled={disabled} size="sm" variant="outline" onClick={() => beginPresetEditor("create")}><Plus data-icon="inline-start" />{props.t("config.presetNew", "新建预设")}</Button>}
                {selectedPreset && <Button disabled={disabled} size="sm" variant="outline" onClick={() => void perform("preset", () => props.preset?.onValueChange(selectedPreset.value))}><RotateCcw data-icon="inline-start" />{props.t("config.presetApply", "应用预设")}</Button>}
                {selectedPresetEditable && props.preset.onRename && <Button disabled={disabled} size="sm" variant="outline" onClick={() => beginPresetEditor("rename")}><Pencil data-icon="inline-start" />{props.t("config.presetRename", "重命名")}</Button>}
                {selectedPresetEditable && props.preset.onOverwrite && <Button disabled={disabled} size="sm" variant="outline" onClick={() => setPresetConfirmation("overwrite")}><Save data-icon="inline-start" />{props.t("config.presetOverwrite", "保存当前到预设")}</Button>}
                {selectedPresetEditable && props.preset.onDelete && <Button disabled={disabled} size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setPresetConfirmation("delete")}><Trash2 data-icon="inline-start" />{props.t("config.presetDelete", "删除预设")}</Button>}
              </div>
            )}
            {(props.preset.onImport || props.preset.onExport) && <div className="grid grid-cols-2 gap-2">
              {props.preset.onImport && <Button disabled={disabled} size="sm" variant="outline" onClick={() => setPresetImportOpen(true)}><Upload data-icon="inline-start" />{props.t("config.presetImport", "导入预设")}</Button>}
              {props.preset.onExport && <Button disabled={disabled} size="sm" variant="outline" onClick={() => void perform("preset", props.preset!.onExport!)}><Download data-icon="inline-start" />{props.t("config.presetExport", "导出预设")}</Button>}
            </div>}
            <Dialog open={presetImportOpen} onOpenChange={setPresetImportOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>{props.t("config.presetImport", "导入预设")}</DialogTitle><DialogDescription>{props.t("config.presetImportDescription", "粘贴由配置管理导出的 JSON 预设。")}</DialogDescription></DialogHeader>
                <Textarea className="min-h-48 font-mono text-xs" value={presetImportText} onChange={(event) => setPresetImportText(event.currentTarget.value)} placeholder='{"presets": [...]}' />
                <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPresetImportOpen(false)}>{props.t("common:cancel", "取消")}</Button><Button disabled={!presetImportText.trim() || disabled} onClick={() => void perform("preset", async () => { await props.preset?.onImport?.(presetImportText); setPresetImportText(""); setPresetImportOpen(false) })}>{props.t("config.presetImport", "导入预设")}</Button></div>
              </DialogContent>
            </Dialog>
            {selectedPreset?.values && (
              <Dialog>
                <DialogTrigger asChild><Button disabled={disabled} size="sm" variant="ghost"><Eye data-icon="inline-start" />{props.t("config.presetView", "查看预设配置")}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{selectedPreset.label}</DialogTitle><DialogDescription>{selectedPreset.description ?? props.t("config.customPresetDescription", "此节点的自定义预设")}</DialogDescription></DialogHeader>
                  <ScrollArea className="max-h-[50vh] rounded-md border bg-muted/30"><pre className="p-3 text-xs leading-5">{JSON.stringify(selectedPreset.values, null, 2)}</pre></ScrollArea>
                </DialogContent>
              </Dialog>
            )}
            {presetEditor && (
              <div className="grid gap-2 rounded-md border bg-muted/20 p-2">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${presetId}-name`}>{props.t("config.presetName", "预设名称")}</FieldLabel>
                  <Input id={`${presetId}-name`} autoFocus disabled={disabled} value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void commitPresetEditor() }} />
                </Field>
                <div className="flex justify-end gap-2"><Button disabled={disabled} size="sm" variant="ghost" onClick={() => setPresetEditor(null)}>{props.t("common:cancel", "取消")}</Button><Button disabled={disabled || !presetName.trim()} size="sm" onClick={() => void commitPresetEditor()}>{presetEditor === "create" ? props.t("config.presetCreate", "创建") : props.t("config.presetRename", "重命名")}</Button></div>
              </div>
            )}
            <AlertDialog open={presetConfirmation !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setPresetConfirmation(null) }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{presetConfirmation === "delete" ? props.t("config.presetDeleteTitle", "删除此预设？") : props.t("config.presetOverwriteTitle", "保存当前配置到此预设？")}</AlertDialogTitle>
                  <AlertDialogDescription>{presetConfirmation === "delete" ? props.t("config.presetDeleteDescription", "此操作无法撤销。") : props.t("config.presetOverwriteDescription", "将用当前节点参数替换此预设保存的参数；如需恢复参数，请使用“应用预设”。")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={disabled}>{props.t("common:cancel", "取消")}</AlertDialogCancel>
                  <AlertDialogAction disabled={disabled} variant={presetConfirmation === "delete" ? "destructive" : "default"} onClick={() => { if (presetConfirmation) void confirmPresetMutation(presetConfirmation) }}>{presetConfirmation === "delete" ? props.t("config.presetDelete", "删除预设") : props.t("config.presetOverwrite", "保存当前到预设")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Separator />
          </>}
          <Button disabled={disabled} size="sm" onClick={() => void perform("save", props.onSave)}><Save data-icon="inline-start" />{props.t("config.save", "保存为默认")}</Button>
          <Button disabled={disabled || !hasDefaults} size="sm" variant="outline" onClick={() => void perform("restore", props.onRestore)}><RotateCcw data-icon="inline-start" />{props.t("config.restore", "恢复默认")}</Button>
          <Button disabled={disabled} size="sm" variant="outline" onClick={() => void perform("reload", props.onReload)}><RefreshCw data-icon="inline-start" />{props.t("config.reload", "重新读取")}</Button>
          {props.onClearOverride && <Button disabled={disabled} size="sm" variant="outline" onClick={() => void perform("restore", props.onClearOverride!)}><Eraser data-icon="inline-start" />{props.t("config.clear", "清除覆盖")}</Button>}
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
                <pre className="p-3 text-xs leading-5">{JSON.stringify(effectiveDefaults, null, 2)}</pre>
              </ScrollArea>
            </DialogContent>
          </Dialog>
          <Button disabled={disabled || !props.onOpenFile} size="sm" variant="ghost" onClick={() => void perform("open", () => props.onOpenFile?.())}><ExternalLink data-icon="inline-start" />{props.t("config.openFile", "打开文件")}</Button>
        </div>
        {props.dirty && <p className={cn("mt-3 text-xs text-muted-foreground")}>{props.t("config.dirty", "当前参数与已保存默认值不同。")}</p>}
      </PopoverContent>
    </Popover>
  )
}
