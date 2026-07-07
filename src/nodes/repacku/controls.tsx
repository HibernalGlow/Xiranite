import { Clipboard, FolderOpen, SlidersHorizontal } from "lucide-react"
import type { RepackuAction } from "@xiranite/node-repacku/core"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ACTIONS } from "./constants"
import type { RepackuCardState, RepackuStatusMeta } from "./types"

interface CommonControlProps {
  data: RepackuCardState
  disabled: boolean
  onPatch: (patch: Partial<RepackuCardState>) => void
}

export function PathInput({ compact = false, data, disabled, id = "repacku-path", onPaste, onPatch }: CommonControlProps & {
  compact?: boolean
  id?: string
  onPaste: () => void
}) {
  return (
    <FieldGroup className={compact ? "gap-1" : "gap-3"}>
      <Field className="gap-1.5">
        <FieldLabel className={compact ? "sr-only" : undefined} htmlFor={id}>文件夹路径</FieldLabel>
        <InputGroup>
          <FolderOpen />
          <InputGroupInput
            id={id}
            disabled={disabled}
            placeholder="D:\\archive\\source"
            value={data.path ?? ""}
            onChange={(event) => onPatch({ path: event.currentTarget.value })}
          />
          <InputGroupButton disabled={disabled} onClick={onPaste} variant="ghost">
            <Clipboard data-icon="inline-start" />
            粘贴
          </InputGroupButton>
        </InputGroup>
      </Field>
    </FieldGroup>
  )
}

export function ActionSelect({ action, disabled, triggerClassName, onActionChange }: {
  action: RepackuAction
  disabled: boolean
  triggerClassName?: string
  onActionChange: (value: RepackuAction) => void
}) {
  return (
    <Select disabled={disabled} value={action} onValueChange={(value) => onActionChange(value as RepackuAction)}>
      <SelectTrigger className={cn("min-w-32", triggerClassName)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ACTIONS.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function CompactOptionsPanel({ data, disabled, onPatch }: CommonControlProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <CompactSwitch
        checked={data.dryRun ?? true}
        disabled={disabled}
        label="预演"
        ariaLabel="预演模式"
        description="不写归档"
        onCheckedChange={(value) => onPatch({ dryRun: value })}
      />
      <CompactSwitch
        checked={data.deleteAfter ?? false}
        disabled={disabled}
        label="删源"
        ariaLabel="删除源文件"
        description="成功后"
        onCheckedChange={(value) => onPatch({ deleteAfter: value })}
      />
    </div>
  )
}

export function OptionsPanel({ data, disabled, onPatch }: CommonControlProps) {
  return (
    <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
      <div>
        <div className="text-sm font-semibold">选项</div>
        <div className="text-xs text-muted-foreground">常用项留在卡片内，按容器空间自动换行。</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="repacku-types">目标文件类型</FieldLabel>
          <Input
            id="repacku-types"
            disabled={disabled}
            placeholder="image, document"
            value={data.typesText ?? ""}
            onChange={(event) => onPatch({ typesText: event.currentTarget.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="repacku-min-count">最少文件数</FieldLabel>
          <Input
            id="repacku-min-count"
            disabled={disabled}
            min={1}
            type="number"
            value={data.minCount ?? 2}
            onChange={(event) => onPatch({ minCount: Number(event.currentTarget.value) })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <SwitchField
          checked={data.dryRun ?? true}
          disabled={disabled}
          label="预演模式"
          description="只生成计划，不写归档。"
          onCheckedChange={(value) => onPatch({ dryRun: value })}
        />
        <SwitchField
          checked={data.deleteAfter ?? false}
          disabled={disabled}
          label="删除源文件"
          description="仅在压缩成功后执行。"
          onCheckedChange={(value) => onPatch({ deleteAfter: value })}
        />
      </div>
    </section>
  )
}

export function StatusStrip({ compact = false, progress, status, text }: {
  compact?: boolean
  progress: number
  status: RepackuStatusMeta
  text?: string
}) {
  return (
    <Alert className={cn("shrink-0 bg-background/70", compact && "px-3 py-2 text-xs")}>
      <SlidersHorizontal />
      <AlertTitle className={compact ? "min-h-3 text-xs" : undefined}>{status.label}</AlertTitle>
      <AlertDescription>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <span className="truncate">{text || status.description}</span>
          {status.tone === "running" && <Progress value={progress} />}
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function ConfigFilePanel(props: {
  compact?: boolean
  configDirty: boolean
  data: RepackuCardState
  disabled: boolean
  onOpenConfigFile?: () => void
  onPatch: (patch: Partial<RepackuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onResetOverride: () => void
}) {
  return (
    <section className={cn("flex shrink-0 flex-col gap-3", props.compact ? "border-t pt-3" : "border-b pb-3")}>
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          运行配置
          {props.configDirty && <span className="text-xs font-normal text-muted-foreground">已覆盖默认值</span>}
        </div>
        {!props.compact && <div className="text-xs text-muted-foreground">默认值和可选 JSON 配置在卡片内编辑，不打开额外侧栏。</div>}
      </div>
      <Field>
        <FieldLabel htmlFor="repacku-config-path">配置 JSON 路径</FieldLabel>
        <Input
          id="repacku-config-path"
          disabled={props.disabled}
          placeholder="可选的已有配置路径"
          value={props.data.configPath ?? ""}
          onChange={(event) => props.onPatch({ configPath: event.currentTarget.value })}
        />
        {!props.compact && <FieldDescription>按配置压缩会使用它；分析完成后也会回填。</FieldDescription>}
      </Field>
      <div className="grid grid-cols-2 gap-2 @md/repacku:grid-cols-4">
        <Button disabled={!props.onOpenConfigFile} size={props.compact ? "sm" : "default"} variant="outline" onClick={props.onOpenConfigFile}>
          <FolderOpen data-icon="inline-start" />
          打开配置
        </Button>
        <Button disabled={props.disabled} size={props.compact ? "sm" : "default"} variant="outline" onClick={props.onSaveDefault}>保存默认</Button>
        <Button disabled={props.disabled} size={props.compact ? "sm" : "default"} variant="outline" onClick={props.onRestoreDefault}>恢复默认</Button>
        <Button disabled={props.disabled} size={props.compact ? "sm" : "default"} variant="ghost" onClick={props.onResetOverride}>清除覆盖</Button>
      </div>
      {!props.compact && (
        <Button disabled={props.disabled} variant="ghost" onClick={props.onReset}>清空输出</Button>
      )}
    </section>
  )
}

function CompactSwitch(props: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  ariaLabel: string
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label className={cn("flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5", props.disabled && "opacity-60")}>
      <Switch
        aria-label={props.ariaLabel}
        checked={props.checked}
        disabled={props.disabled}
        size="sm"
        onCheckedChange={props.onCheckedChange}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{props.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{props.description}</span>
      </span>
    </label>
  )
}

function SwitchField({ checked, description, disabled, label, onCheckedChange }: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="min-w-44 flex-1 rounded-md bg-muted/30 p-2">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription className="text-xs">{description}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
