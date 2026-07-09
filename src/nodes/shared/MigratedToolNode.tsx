import { useMemo, useRef, useState } from "react"
import type { ComponentType } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, CheckCircle2, Database, FileText, Play, RotateCcw, Settings2, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "./useNodeSurface"

export type ToolFieldType = "text" | "textarea" | "number" | "select" | "switch"

export interface ToolOption {
  value: string
  label: string
  description?: string
}

export interface ToolField {
  key: string
  label: string
  type: ToolFieldType
  defaultValue?: string | number | boolean
  placeholder?: string
  description?: string
  rows?: number
  options?: ToolOption[]
}

export interface ToolStat {
  label: string
  value: string | number
  tone?: "default" | "success" | "warning" | "error"
}

export interface ToolSection {
  title: string
  rows?: Array<[string, unknown]>
  items?: unknown[]
}

export interface MigratedToolSpec<TInput, TData> {
  id: string
  title: string
  description: string
  icon: LucideIcon
  actions: ToolOption[]
  defaultAction: string
  fields: ToolField[]
  advancedFields?: ToolField[]
  buildInput: (state: ToolCardState, action: string) => TInput
  summarize: (result: NodeRunResult<TData> | null) => ToolStat[]
  sections: (result: NodeRunResult<TData> | null) => ToolSection[]
  primaryLabel?: (action: string, state: ToolCardState) => string
}

export interface ToolCardState {
  action?: string
  phase?: "idle" | "running" | "success" | "error"
  progress?: number
  progressText?: string
  result?: NodeRunResult<unknown> | null
  logs?: string[]
  [key: string]: unknown
}

export function createMigratedToolComponent<TInput, TData>(
  spec: MigratedToolSpec<TInput, TData>,
): ComponentType<NodeComponentProps> {
  return function MigratedToolComponent({ compId, host }: NodeComponentProps) {
    const surface = useNodeSurface()
    const fieldDefaults = useMemo(() => fieldDefaultsFor(spec), [spec])
    const persistedData = (host.state?.getData?.() as ToolCardState | undefined) ?? host.getData<ToolCardState>(compId) ?? {}
    const data = { ...fieldDefaults, ...persistedData }
    const dataRef = useRef<ToolCardState>(data)
    dataRef.current = data
    const [running, setRunning] = useState(false)

    const compact = surface.mode === "collapsed" || surface.mode === "compact" || surface.mode === "portrait"
    const action = String(data.action ?? spec.defaultAction)
    const result = (data.result ?? null) as NodeRunResult<TData> | null
    const logs = data.logs ?? []
    const stats = useMemo(() => spec.summarize(result), [result])
    const sections = useMemo(() => spec.sections(result), [result])
    const Icon = spec.icon
    const phase = running ? "running" : data.phase ?? "idle"
    const phaseMeta = phaseInfo(phase)
    const PhaseIcon = phaseMeta.icon

    function patch(patchData: Partial<ToolCardState>) {
      dataRef.current = { ...dataRef.current, ...patchData }
      if (host.state?.patchData) {
        host.state.patchData(patchData)
        return
      }
      host.patchData(compId, patchData)
    }

    function pushLog(message: string) {
      const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
      patch({ logs: nextLogs })
    }

    function reset() {
      patch({
        phase: "idle",
        progress: 0,
        progressText: "",
        result: null,
        logs: [],
      })
    }

    async function execute() {
      if (running) return
      const run = host.runner?.run ?? host.actions?.run
      if (!run) {
        patch({ phase: "error", progress: 0, progressText: "当前宿主没有本地运行能力。" })
        return
      }

      const input = spec.buildInput(dataRef.current, action)
      setRunning(true)
      patch({ phase: "running", progress: 0, progressText: "准备运行。", result: null })
      pushLog(`run ${spec.id}:${action}`)
      try {
        const response = await run<TInput, TData>(spec.id, input, (event: NodeRunEvent) => {
          if (event.type === "progress") {
            patch({ progress: event.progress ?? 0, progressText: event.message })
          }
          pushLog(event.progress === undefined ? event.message : `[${event.progress}%] ${event.message}`)
        }) as NodeRunResult<TData>
        patch({
          phase: response.success ? "success" : "error",
          progress: response.success ? 100 : 0,
          progressText: response.message,
          result: response as NodeRunResult<unknown>,
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

    return (
      <div ref={surface.ref} className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/35">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{spec.title}</div>
              {!compact && <div className="line-clamp-2 text-xs text-muted-foreground">{spec.description}</div>}
            </div>
          </div>
          <Badge variant={phaseMeta.variant} className="shrink-0">
            <PhaseIcon className="size-3" />
            {phaseMeta.label}
          </Badge>
        </div>

        <div className={cn("grid min-h-0 flex-1 gap-0", compact ? "grid-cols-1" : "md:grid-cols-2")}>
          <ScrollArea className="min-h-0 border-b md:border-r md:border-b-0">
            <div className="space-y-3 p-3">
              <div className="grid gap-2">
                <ControlLabel label="动作" icon={Play} />
                <Select value={action} onValueChange={(nextAction) => patch({ action: nextAction })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.actions.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ActionHint action={action} actions={spec.actions} />
              </div>

              <FieldGrid fields={spec.fields} state={data} disabled={running} onPatch={patch} />

              {spec.advancedFields?.length ? (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Settings2 className="size-3.5" />
                    运行选项
                  </div>
                  <FieldGrid fields={spec.advancedFields} state={data} disabled={running} onPatch={patch} />
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" disabled={running} onClick={execute}>
                  <Play className="size-4" />
                  {spec.primaryLabel?.(action, data) ?? "运行"}
                </Button>
                <Button size="sm" variant="outline" disabled={running} onClick={reset}>
                  <RotateCcw className="size-4" />
                  清空
                </Button>
              </div>
            </div>
          </ScrollArea>

          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-xs text-muted-foreground">{data.progressText || "等待运行"}</div>
                <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{Math.round(Number(data.progress ?? 0))}%</div>
              </div>
              <Progress value={Math.max(0, Math.min(100, Number(data.progress ?? 0)))} className="h-1.5" />
            </div>

            <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-3 mt-3 grid shrink-0 grid-cols-3">
                <TabsTrigger value="summary">摘要</TabsTrigger>
                <TabsTrigger value="data">数据</TabsTrigger>
                <TabsTrigger value="log">日志</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="space-y-3 p-3">
                    <StatGrid stats={stats} />
                    <ResultSections sections={sections} />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="data" className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <pre className="m-3 overflow-auto rounded-md bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
                    {result ? JSON.stringify(result.data ?? result, null, 2) : "No result yet."}
                  </pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="log" className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="space-y-1 p-3 font-mono text-xs text-muted-foreground">
                    {logs.length ? logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <div>No logs yet.</div>}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    )
  }
}

function FieldGrid({
  fields,
  state,
  disabled,
  onPatch,
}: {
  fields: ToolField[]
  state: ToolCardState
  disabled: boolean
  onPatch: (patch: Partial<ToolCardState>) => void
}) {
  return (
    <div className="grid gap-3">
      {fields.map((field) => (
        <ToolFieldControl key={field.key} field={field} state={state} disabled={disabled} onPatch={onPatch} />
      ))}
    </div>
  )
}

function ToolFieldControl({
  field,
  state,
  disabled,
  onPatch,
}: {
  field: ToolField
  state: ToolCardState
  disabled: boolean
  onPatch: (patch: Partial<ToolCardState>) => void
}) {
  const value = fieldValue(state, field)
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
      {field.type === "textarea" ? (
        <Textarea
          disabled={disabled}
          value={String(value ?? "")}
          rows={field.rows ?? 4}
          placeholder={field.placeholder}
          onChange={(event) => onPatch({ [field.key]: event.target.value })}
        />
      ) : field.type === "select" ? (
        <Select value={String(value ?? field.options?.[0]?.value ?? "")} onValueChange={(nextValue) => onPatch({ [field.key]: nextValue })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "switch" ? (
        <div className="flex h-9 items-center justify-between rounded-md border px-3">
          <span className="text-sm">{field.placeholder ?? field.label}</span>
          <Switch disabled={disabled} checked={Boolean(value)} onCheckedChange={(checked) => onPatch({ [field.key]: checked })} />
        </div>
      ) : (
        <Input
          disabled={disabled}
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(event) => onPatch({ [field.key]: field.type === "number" ? event.target.value : event.target.value })}
        />
      )}
      {field.description ? <span className="text-xs text-muted-foreground">{field.description}</span> : null}
    </label>
  )
}

function fieldDefaultsFor<TInput, TData>(spec: MigratedToolSpec<TInput, TData>): ToolCardState {
  return [...spec.fields, ...(spec.advancedFields ?? [])].reduce<ToolCardState>((defaults, field) => {
    if (field.defaultValue !== undefined) defaults[field.key] = field.defaultValue
    return defaults
  }, {})
}

function fieldValue(state: ToolCardState, field: ToolField): unknown {
  return state[field.key] ?? field.defaultValue
}

function ControlLabel({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </div>
  )
}

function ActionHint({ action, actions }: { action: string; actions: ToolOption[] }) {
  const description = actions.find((item) => item.value === action)?.description
  if (!description) return null
  return <div className="text-xs text-muted-foreground">{description}</div>
}

function StatGrid({ stats }: { stats: ToolStat[] }) {
  if (!stats.length) return <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">运行后会显示摘要。</div>
  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.map((stat) => (
        <div key={stat.label} className={cn("rounded-md border p-2", stat.tone === "error" && "border-destructive/45", stat.tone === "success" && "border-emerald-500/45")}>
          <div className="text-[11px] text-muted-foreground">{stat.label}</div>
          <div className="truncate text-lg font-semibold tabular-nums">{stat.value}</div>
        </div>
      ))}
    </div>
  )
}

function ResultSections({ sections }: { sections: ToolSection[] }) {
  if (!sections.length) return null
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="size-3.5" />
            {section.title}
          </div>
          {section.rows?.length ? (
            <div className="divide-y rounded-md border">
              {section.rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[7rem_1fr] gap-2 px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="min-w-0 break-all">{formatValue(value)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {section.items?.length ? (
            <pre className="max-h-56 overflow-auto rounded-md bg-muted/35 p-2 text-xs leading-5 text-muted-foreground">
              {JSON.stringify(section.items.slice(0, 12), null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function phaseInfo(phase: ToolCardState["phase"] | "running") {
  if (phase === "running") return { label: "运行中", variant: "secondary" as const, icon: Terminal }
  if (phase === "success") return { label: "完成", variant: "default" as const, icon: CheckCircle2 }
  if (phase === "error") return { label: "错误", variant: "destructive" as const, icon: AlertCircle }
  return { label: "待命", variant: "outline" as const, icon: Database }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

export function lines(value: unknown): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function words(value: unknown): string[] {
  return String(value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function textValue(state: ToolCardState, key: string): string | undefined {
  const value = String(state[key] ?? "").trim()
  return value || undefined
}

export function numberValue(state: ToolCardState, key: string): number | undefined {
  const raw = String(state[key] ?? "").trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function boolValue(state: ToolCardState, key: string): boolean | undefined {
  return state[key] === undefined ? undefined : Boolean(state[key])
}
