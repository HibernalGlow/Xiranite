import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type {
  RepackuAction,
  RepackuData,
  RepackuFolderNode,
  RepackuInput,
  RepackuResult,
} from "@xiranite/node-repacku/core"
import {
  Clipboard,
  Copy,
  FileArchive,
  FolderOpen,
  Package,
  Play,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"

interface RepackuCardState {
  path?: string
  configPath?: string
  typesText?: string
  minCount?: number
  deleteAfter?: boolean
  dryRun?: boolean
  action?: RepackuAction
  phase?: "idle" | "running" | "completed" | "error" | RepackuAction | string
  progress?: number
  progressText?: string
  result?: RepackuData | null
  logs?: string[]
}

const CONFIG_FIELDS: (keyof RepackuCardState)[] = ["path", "configPath", "typesText", "minCount", "deleteAfter", "dryRun", "action"]

const ACTIONS: Array<{ value: RepackuAction; label: string; description: string; icon: typeof Search }> = [
  { value: "analyze", label: "分析", description: "扫描文件夹并写出配置计划。", icon: Search },
  { value: "full", label: "完整流程", description: "先分析，再按计划执行重打包。", icon: Sparkles },
  { value: "compress", label: "按配置压缩", description: "从已有配置或当前路径执行压缩。", icon: FileArchive },
  { value: "single-pack", label: "单层打包", description: "打包一级子目录和散图。", icon: Package },
  { value: "gallery-pack", label: "画集打包", description: "查找画集目录并逐个单层打包。", icon: FolderOpen },
]

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<RepackuCardState>(compId) ?? {}
  const dataRef = useRef<RepackuCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<RepackuCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const result = data.result ?? null
  const logs = data.logs ?? []
  const action = data.action ?? "full"
  const progress = data.progress ?? 0
  const modeMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[1]!
  const types = useMemo(() => parseTypes(data.typesText), [data.typesText])
  const status = statusFromState(data, running)
  const treeLines = useMemo(() => result?.folderTree ? flattenTree(result.folderTree).slice(0, 80) : [], [result?.folderTree])
  const operationPreview = result?.operations.slice(0, 120) ?? []

  useEffect(() => {
    host.getNodeConfig?.<Partial<RepackuCardState>>()
      .then((response) => setDefaults(response.config))
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.action, data.configPath, data.deleteAfter, data.dryRun, data.minCount, data.path, data.typesText, defaults])

  function patch(patchData: Partial<RepackuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-80)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ path: text.trim() })
  }

  async function copyResults() {
    const text = [
      result?.configPath ? `config=${result.configPath}` : "",
      ...operationPreview.map((item) => `${item.status} ${item.mode} ${item.sourcePath} -> ${item.targetPath}`),
    ].filter(Boolean).join("\n")
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<RepackuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined && value !== "") (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({ path: undefined, configPath: undefined, typesText: undefined, minCount: undefined, deleteAfter: undefined, dryRun: undefined, action: undefined })
  }

  async function execute(nextAction = action) {
    if (running) return
    const input = buildInput(nextAction, data)
    if (nextAction !== "compress" && !input.path && !input.paths?.length) {
      const message = "请先选择文件夹路径。"
      patch({ progressText: message })
      pushLog(message)
      return
    }
    if (nextAction === "compress" && !input.configPath && !input.path && !input.paths?.length) {
      const message = "按配置压缩需要配置路径或文件夹路径。"
      patch({ progressText: message })
      pushLog(message)
      return
    }

    const runAction = host.actions?.run
    if (!runAction) {
      const message = "Local Backend 暂不可用，无法运行 repacku。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: "正在启动 repacku。", result: null })
    try {
      const response = await runAction<RepackuInput, RepackuData>("repacku", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          return
        }
        pushLog(event.message)
      }) as RepackuResult

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        configPath: response.data?.configPath || dataRef.current.configPath,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  const content = surface.mode === "collapsed"
    ? (
      <CollapsedView
        actionLabel={modeMeta.label}
        progress={progress}
        status={status}
        text={data.progressText || summarize(data, result)}
      />
    )
    : surface.mode === "compact"
      ? (
        <CompactView
          action={action}
          configDirty={configDirty}
          data={data}
          modeMeta={modeMeta}
          progress={progress}
          running={running}
          status={status}
          onActionChange={(value) => patch({ action: value })}
          onExecute={() => execute()}
          onPaste={pastePath}
          onPatch={patch}
          onReset={reset}
          onRestoreDefault={restoreDefault}
          onSaveDefault={saveAsDefault}
          onResetOverride={resetOverride}
          onOpenConfigFile={host.openConfigFile}
        />
      )
      : (
        <FullView
          action={action}
          configDirty={configDirty}
          data={data}
          logs={logs}
          operationPreview={operationPreview}
          progress={progress}
          result={result}
          running={running}
          status={status}
          surfaceMode={surface.mode}
          treeLines={treeLines}
          types={types}
          onActionChange={(value) => patch({ action: value })}
          onCopyLogs={copyLogs}
          onCopyResults={copyResults}
          onExecute={(value) => execute(value)}
          onPaste={pastePath}
          onPatch={patch}
          onReset={reset}
          onRestoreDefault={restoreDefault}
          onSaveDefault={saveAsDefault}
          onResetOverride={resetOverride}
          onOpenConfigFile={host.openConfigFile}
        />
      )

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.16),transparent_34%),radial-gradient(circle_at_80%_10%,hsl(var(--accent)/0.42),transparent_30%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {content}
        </div>
      </div>
    </TooltipProvider>
  )
}

function CollapsedView({ actionLabel, progress, status, text }: { actionLabel: string; progress: number; status: StatusMeta; text: string }) {
  return (
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-full border bg-background/80 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-60 transition-opacity", status.tone === "running" && "animate-pulse bg-primary/10", status.tone === "error" && "bg-destructive/10", status.tone === "success" && "bg-primary/10")} />
      <div className="relative grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <Package />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Repacku</span>
          <Badge variant={status.badgeVariant}>{actionLabel}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{text}</div>
      </div>
      {status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{progress}%</div>}
    </div>
  )
}

function CompactView(props: {
  action: RepackuAction
  configDirty: boolean
  data: RepackuCardState
  modeMeta: { label: string; description: string; icon: typeof Search }
  progress: number
  running: boolean
  status: StatusMeta
  onActionChange: (value: RepackuAction) => void
  onExecute: () => void
  onPaste: () => void
  onPatch: (patch: Partial<RepackuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onResetOverride: () => void
  onOpenConfigFile?: () => void
}) {
  const ModeIcon = props.modeMeta.icon
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <HeaderLine status={props.status} subtitle={props.data.progressText || props.modeMeta.description} />
      <PathInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
      <div className="flex min-w-0 items-center gap-2">
        <ActionSelect action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
        <Button className="flex-1" disabled={props.running} onClick={props.onExecute}>
          <ModeIcon data-icon="inline-start" />
          启动
        </Button>
        <AdvancedSheet {...props} />
      </div>
      <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
    </div>
  )
}

function FullView(props: {
  action: RepackuAction
  configDirty: boolean
  data: RepackuCardState
  logs: string[]
  operationPreview: RepackuData["operations"]
  progress: number
  result: RepackuData | null
  running: boolean
  status: StatusMeta
  surfaceMode: "regular" | "expanded" | "workspace"
  treeLines: string[]
  types: string[]
  onActionChange: (value: RepackuAction) => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action?: RepackuAction) => void
  onPaste: () => void
  onPatch: (patch: Partial<RepackuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onResetOverride: () => void
  onOpenConfigFile?: () => void
}) {
  const isWide = props.surfaceMode === "expanded" || props.surfaceMode === "workspace"
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <HeaderLine
          status={props.status}
          subtitle={props.data.progressText || `${props.types.length ? props.types.join(", ") : "全部文件"} | 至少 ${props.data.minCount ?? 2} 个 | ${props.data.dryRun ?? true ? "预演" : "写入"}`}
        />
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={props.onReset}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>清空运行状态</TooltipContent>
          </Tooltip>
          <AdvancedSheet {...props} modeMeta={ACTIONS.find((item) => item.value === props.action) ?? ACTIONS[1]!} />
        </div>
      </div>

      <div className={cn("grid min-h-0 flex-1 gap-3", isWide ? "grid-cols-[minmax(280px,0.86fr)_minmax(360px,1.4fr)]" : "grid-cols-1")}>
        <ScrollArea className="min-h-0">
          <div className="flex min-h-0 flex-col gap-3 pr-1">
          <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">输入</div>
                <div className="text-xs text-muted-foreground">选择路径、模式和执行策略。</div>
              </div>
              <ActionSelect action={props.action} disabled={props.running} onActionChange={props.onActionChange} />
            </div>
            <PathInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
            <div className="flex items-center gap-2">
              <Button disabled={props.running} onClick={() => props.onExecute(props.action)}>
                <Play data-icon="inline-start" />
                启动
              </Button>
              <Button disabled={props.running || !props.data.path} variant="outline" onClick={() => props.onExecute("analyze")}>
                <Search data-icon="inline-start" />
                分析
              </Button>
              <Button disabled={props.running || (!props.data.configPath && !props.data.path)} variant="outline" onClick={() => props.onExecute("compress")}>
                <FileArchive data-icon="inline-start" />
                压缩
              </Button>
            </div>
          </section>

          <OptionsPanel data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
          <StatsPanel result={props.result} />
          </div>
        </ScrollArea>

        <Tabs defaultValue="operations" className="min-h-0">
          <TabsList>
            <TabsTrigger value="operations">操作</TabsTrigger>
            <TabsTrigger value="tree">目录树</TabsTrigger>
            <TabsTrigger value="logs">日志</TabsTrigger>
          </TabsList>
          <TabsContent value="operations" className="min-h-0">
            <PreviewPanel
              emptyText="还没有操作计划。运行分析或完整流程后可预览文件夹。"
              lines={props.operationPreview.map((item) => `${item.status.padEnd(7)} ${item.mode.padEnd(9)} ${item.sourcePath} -> ${item.targetPath}`)}
              onCopy={props.onCopyResults}
            />
          </TabsContent>
          <TabsContent value="tree" className="min-h-0">
            <PreviewPanel emptyText="分析完成后会显示目录树。" lines={props.treeLines} />
          </TabsContent>
          <TabsContent value="logs" className="min-h-0">
            <PreviewPanel emptyText="运行日志会显示在这里。" lines={props.logs} onCopy={props.onCopyLogs} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function HeaderLine({ status, subtitle }: { status: StatusMeta; subtitle: string }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Package />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Repacku</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function PathInput({ data, disabled, onPaste, onPatch }: {
  data: RepackuCardState
  disabled: boolean
  onPaste: () => void
  onPatch: (patch: Partial<RepackuCardState>) => void
}) {
  return (
    <FieldGroup className="gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor="repacku-path">文件夹路径</FieldLabel>
        <InputGroup>
          <FolderOpen />
          <InputGroupInput
            id="repacku-path"
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

function ActionSelect({ action, disabled, onActionChange }: { action: RepackuAction; disabled: boolean; onActionChange: (value: RepackuAction) => void }) {
  return (
    <Select disabled={disabled} value={action} onValueChange={(value) => onActionChange(value as RepackuAction)}>
      <SelectTrigger className="min-w-32">
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

function OptionsPanel({ data, disabled, onPatch }: { data: RepackuCardState; disabled: boolean; onPatch: (patch: Partial<RepackuCardState>) => void }) {
  return (
    <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
      <div>
        <div className="text-sm font-semibold">选项</div>
        <div className="text-xs text-muted-foreground">常用项留在卡片内，低频配置放进侧栏。</div>
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
        <SwitchField checked={data.dryRun ?? true} disabled={disabled} label="预演模式" description="只生成计划，不写归档。" onCheckedChange={(value) => onPatch({ dryRun: value })} />
        <SwitchField checked={data.deleteAfter ?? false} disabled={disabled} label="删除源文件" description="仅在压缩成功后执行。" onCheckedChange={(value) => onPatch({ deleteAfter: value })} />
      </div>
    </section>
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

function StatusStrip({ progress, status, text }: { progress: number; status: StatusMeta; text?: string }) {
  return (
    <Alert className="shrink-0 bg-background/70">
      <SlidersHorizontal />
      <AlertTitle>{status.label}</AlertTitle>
      <AlertDescription>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <span className="truncate">{text || status.description}</span>
          {status.tone === "running" && <Progress value={progress} />}
        </div>
      </AlertDescription>
    </Alert>
  )
}

function StatsPanel({ result }: { result: RepackuData | null }) {
  const stats = [
    ["文件夹", result?.totalFolders ?? 0],
    ["整包", result?.entireCount ?? 0],
    ["筛选", result?.selectiveCount ?? 0],
    ["操作", result?.totalOperations ?? 0],
    ["失败", result?.failedCount ?? 0],
  ] as const
  return (
    <div className="grid shrink-0 grid-cols-5 gap-1">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/30 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function PreviewPanel({ emptyText, lines, onCopy }: { emptyText: string; lines: string[]; onCopy?: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">{lines.length ? `${lines.length} 项` : "预览"}</div>
        {onCopy && (
          <Button disabled={!lines.length} size="xs" variant="ghost" onClick={onCopy}>
            <Copy data-icon="inline-start" />
            复制
          </Button>
        )}
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {lines.length ? (
          <pre className="p-3 text-xs leading-5 text-muted-foreground">
            {lines.join("\n")}
          </pre>
        ) : (
          <div className="flex min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">{emptyText}</div>
        )}
      </ScrollArea>
    </section>
  )
}

function AdvancedSheet(props: {
  configDirty: boolean
  data: RepackuCardState
  modeMeta?: { label: string; description: string; icon: typeof Search }
  running: boolean
  onOpenConfigFile?: () => void
  onPatch: (patch: Partial<RepackuCardState>) => void
  onReset: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onResetOverride: () => void
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="icon-sm" variant={props.configDirty ? "secondary" : "outline"}>
          <Settings2 />
          <span className="sr-only">高级设置</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[380px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Repacku 设置</SheetTitle>
          <SheetDescription>默认值来自 Xiranite 配置；本次运行状态保存在当前组件。</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
          <OptionsPanel data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <FieldSet>
            <Field>
              <FieldLabel htmlFor="repacku-config-path">配置 JSON 路径</FieldLabel>
              <Input
                id="repacku-config-path"
                disabled={props.running}
                placeholder="可选的已有配置路径"
                value={props.data.configPath ?? ""}
                onChange={(event) => props.onPatch({ configPath: event.currentTarget.value })}
              />
              <FieldDescription>按配置压缩会使用它；分析完成后也会回填。</FieldDescription>
            </Field>
          </FieldSet>
          <div className="grid gap-2">
            <Button disabled={!props.onOpenConfigFile} variant="outline" onClick={props.onOpenConfigFile}>
              <FolderOpen data-icon="inline-start" />
              打开配置文件
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={props.running} variant="outline" onClick={props.onSaveDefault}>保存默认值</Button>
              <Button disabled={props.running} variant="outline" onClick={props.onRestoreDefault}>恢复默认值</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={props.running} variant="ghost" onClick={props.onResetOverride}>清除覆盖</Button>
              <Button disabled={props.running} variant="ghost" onClick={props.onReset}>清空输出</Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface StatusMeta {
  label: string
  description: string
  tone: "idle" | "running" | "success" | "error"
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  iconClass: string
}

function statusFromState(data: RepackuCardState, running: boolean): StatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: "Repacku 正在处理当前任务。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: "上次任务已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error") {
    return {
      label: "失败",
      description: "上次任务失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "选择路径后即可运行任务。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function buildInput(action: RepackuAction, data: RepackuCardState): RepackuInput {
  return {
    action,
    path: data.path,
    configPath: data.configPath,
    types: data.typesText,
    minCount: data.minCount ?? 2,
    deleteAfter: data.deleteAfter ?? false,
    dryRun: data.dryRun ?? true,
  }
}

function summarize(data: RepackuCardState, result: RepackuData | null): string {
  if (data.progressText) return data.progressText
  if (result?.totalOperations) return `${result.totalOperations} 个操作，${result.failedCount} 个失败`
  if (data.path) return compactPath(data.path)
  return "选择文件夹"
}

function compactPath(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : value
}

function parseTypes(value = ""): string[] {
  return value.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean)
}

function flattenTree(root: RepackuFolderNode): string[] {
  const lines: string[] = []
  function walk(node: RepackuFolderNode, depth: number) {
    lines.push(`${"  ".repeat(depth)}${node.compressMode.padEnd(9)} ${node.name} (${node.totalFiles})`)
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return lines
}
