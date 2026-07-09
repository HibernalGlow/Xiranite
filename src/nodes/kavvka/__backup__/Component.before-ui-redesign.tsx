import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { KavvkaAction, KavvkaData, KavvkaInput } from "@xiranite/node-kavvka/core"
import { parseKavvkaKeywords, parseKavvkaPaths } from "@xiranite/node-kavvka/core"
import { Copy, Image, RotateCcw, Square } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS } from "./constants"
import {
  ActionIconButton,
  ActionMeta,
  AdvancedOptionsPopover,
  ConfigDefaultsPopover,
  KeywordAndDepthFields,
  PathTextPanel,
  PrimarySwitches,
  StatusStrip,
} from "./controls"
import type { KavvkaCardState, KavvkaPhase, KavvkaStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<KavvkaCardState>(compId) ?? {}
  const dataRef = useRef<KavvkaCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<KavvkaCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)
  const { t: tNode } = useNodeI18n("kavvka")

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const sourcePaths = useMemo(() => parseKavvkaPaths(data.sourceText), [data.sourceText])
  const scanRoots = useMemo(() => parseKavvkaPaths(data.scanRootText), [data.scanRootText])
  const keywords = useMemo(() => parseKavvkaKeywords(data.keywordText), [data.keywordText])
  const dryRun = data.dryRun ?? true
  const action = data.action ?? "process"
  const actionMeta = ActionMeta(action)
  const phase = phaseFromState(data, running)
  const status = statusFromState(data, running, tNode)
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.getNodeConfig?.<Partial<KavvkaCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [
    data.sourceText,
    data.scanRootText,
    data.keywordText,
    data.scanDepth,
    data.force,
    data.dryRun,
    data.strictArtist,
    defaults,
  ])

  function patch(patchData: Partial<KavvkaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120)
    patch({ logs: nextLogs })
  }

  async function paste(kind: "source" | "scan") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    if (kind === "source") patch({ sourceText: appendText(dataRef.current.sourceText, text) })
    else patch({ scanRootText: appendText(dataRef.current.scanRootText, text) })
  }

  async function copyResults() {
    const text = result?.allCombinedPaths.length
      ? result.allCombinedPaths.join("\n")
      : result?.matchedPaths.join("\n") ?? ""
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(nextAction: KavvkaAction) {
    if (running) return
    const input = buildInput(nextAction, dataRef.current)
    if (nextAction === "scan" && !scanRoots.length) {
      const message = tNode("pathRequiredScan", "请先输入至少一个扫描根目录。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }
    if (nextAction !== "scan" && !sourcePaths.length) {
      const message = tNode("pathRequiredSource", "请先输入至少一个源路径。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    const run = host.actions?.run
    if (!run) {
      const message = tNode("noNative", "当前环境没有本地运行能力，请使用桌面模式或 CLI。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      patch({
        action: nextAction,
        phase: phaseForAction(nextAction),
        progress: 0,
        progressText: tNode("actionStart", "{{action}}开始", { action: actionMeta.shortLabel }),
        result: null,
      })
      const response = await run<KavvkaInput, KavvkaData>("kavvka", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<KavvkaData>

      const next = response.data ?? null
      const sourceOverride = nextAction === "scan" && next?.matchedPaths.length
        ? { sourceText: next.matchedPaths.join("\n") }
        : {}
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: next,
        ...sourceOverride,
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

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<KavvkaCardState> = {}
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
    patch({
      sourceText: undefined,
      scanRootText: undefined,
      keywordText: undefined,
      scanDepth: undefined,
      force: undefined,
      dryRun: undefined,
      strictArtist: undefined,
    })
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    keywords,
    logs,
    progress,
    result,
    running,
    scanRoots,
    sourcePaths,
    status,
    tNode,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPaste: paste,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  })

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/kavvka relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_14%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-3)_16%,transparent),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact ? <PortraitCompactView {...commonProps} /> : <CompactView {...commonProps} />
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

type ViewProps = ReturnType<typeof createViewProps>

function createViewProps(props: {
  action: KavvkaAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: KavvkaCardState
  defaults?: Partial<KavvkaCardState>
  dryRun: boolean
  host: NodeComponentProps["host"]
  keywords: string[]
  logs: string[]
  progress: number
  result: KavvkaData | null
  running: boolean
  scanRoots: string[]
  sourcePaths: string[]
  status: KavvkaStatusMeta
  tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string
  onCopyLogs: () => void
  onCopyResults: () => void
  onExecute: (action: KavvkaAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: (kind: "source" | "scan") => void
  onPatch: (patch: Partial<KavvkaCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div data-testid="kavvka-collapsed-view" className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Image />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Kavvka</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summaryText(props)}</div>
      </div>
      <Button aria-label={props.tNode("aria.running", "kavvka running")} disabled={props.running} size="icon-sm" onClick={() => props.onExecute(props.action)}>
        <ActionIcon />
        <span className="sr-only">{props.actionMeta.shortLabel}</span>
      </Button>
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div data-testid="kavvka-compact-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathTextPanel
          ariaLabel="kavvka source paths"
          compact
          count={props.sourcePaths.length}
          disabled={props.running}
          inputId="kavvka-source-paths"
          label={props.tNode("sourceLabel", "源路径")}
          placeholder={"D:/library/[artist] bundle/gallery"}
          value={props.data.sourceText ?? ""}
          onChange={(sourceText) => props.onPatch({ sourceText })}
          onClear={() => props.onPatch({ sourceText: "" })}
          onPaste={() => props.onPaste("source")}
        />
        <PathTextPanel
          ariaLabel="kavvka scan roots"
          badgeTone="secondary"
          compact
          count={props.scanRoots.length}
          disabled={props.running}
          inputId="kavvka-scan-roots"
          label={props.tNode("scanLabel", "扫描根目录")}
          placeholder={"D:/library"}
          value={props.data.scanRootText ?? ""}
          onChange={(scanRootText) => props.onPatch({ scanRootText })}
          onClear={() => props.onPatch({ scanRootText: "" })}
          onPaste={() => props.onPaste("scan")}
        />
        <ToolbarActions compact {...props} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
          {props.result?.allCombinedPaths.length ? props.result.allCombinedPaths.slice(0, 40).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : props.result?.matchedPaths.length ? props.result.matchedPaths.slice(0, 60).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {props.data.progressText || props.tNode("empty.keywordsEmpty", "关键词：{{keywords}} 或未设置", { keywords: props.keywords.slice(0, 4).join(", ") || "—" })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div data-testid="kavvka-portrait-view" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || summaryText(props)} />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <PathTextPanel
          ariaLabel="kavvka source paths"
          compact
          count={props.sourcePaths.length}
          disabled={props.running}
          inputId="kavvka-source-paths"
          label={props.tNode("sourceLabel", "源路径")}
          placeholder={"D:/library/[artist] bundle/gallery"}
          value={props.data.sourceText ?? ""}
          onChange={(sourceText) => props.onPatch({ sourceText })}
          onClear={() => props.onPatch({ sourceText: "" })}
          onPaste={() => props.onPaste("source")}
        />
        <PathTextPanel
          ariaLabel="kavvka scan roots"
          badgeTone="secondary"
          compact
          count={props.scanRoots.length}
          disabled={props.running}
          inputId="kavvka-scan-roots"
          label={props.tNode("scanLabel", "扫描根目录")}
          placeholder={"D:/library"}
          value={props.data.scanRootText ?? ""}
          onChange={(scanRootText) => props.onPatch({ scanRootText })}
          onClear={() => props.onPatch({ scanRootText: "" })}
          onPaste={() => props.onPaste("scan")}
        />
        <PrimarySwitches compact data={props.data} disabled={props.running} onPatch={props.onPatch} />
        <ToolbarActions compact {...props} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
        {props.result?.allCombinedPaths.length ? props.result.allCombinedPaths.slice(0, 60).map((path) => (
          <div key={path} className="truncate">{path}</div>
        )) : props.result?.matchedPaths.length ? props.result.matchedPaths.slice(0, 80).map((path) => (
          <div key={path} className="truncate">{path}</div>
        )) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {props.data.progressText || `关键词：${props.keywords.slice(0, 4).join(", ") || "未设置"}`}
          </div>
        )}
      </div>
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div data-testid="kavvka-full-view" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/kavvka:flex-row @4xl/kavvka:items-center @4xl/kavvka:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/kavvka:flex-row @4xl/kavvka:items-center">
          <HeaderLine
            status={props.status}
            subtitle={props.data.progressText || props.tNode("headerSubtitle", "{{source}} 源 / {{roots}} 根 / {{mode}}", { source: props.sourcePaths.length, roots: props.scanRoots.length, mode: props.dryRun ? props.tNode("modeDryRun", "预演") : props.tNode("modeWrite", "真实") })}
          />
          <div data-testid="kavvka-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} scanRoots={props.scanRoots} sourcePaths={props.sourcePaths} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/kavvka:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">{props.tNode("sections.input", "输入")}</div>
              <div className="text-xs text-muted-foreground">{props.tNode("sections.inputDesc", "扫描根目录下匹配关键词的文件夹会回填到源路径。")}</div>
            </div>
            <PathTextPanel
              ariaLabel="kavvka source paths"
              count={props.sourcePaths.length}
              disabled={props.running}
              inputId="kavvka-source-paths"
              label={props.tNode("sourceLabel", "源路径")}
              placeholder={"D:/library/[artist] bundle/gallery"}
              value={props.data.sourceText ?? ""}
              onChange={(sourceText) => props.onPatch({ sourceText })}
              onClear={() => props.onPatch({ sourceText: "" })}
              onPaste={() => props.onPaste("source")}
            />
            <PathTextPanel
              ariaLabel="kavvka scan roots"
              badgeTone="secondary"
              count={props.scanRoots.length}
              disabled={props.running}
              inputId="kavvka-scan-roots"
              label={props.tNode("scanLabel", "扫描根目录")}
              placeholder={"D:/library"}
              value={props.data.scanRootText ?? ""}
              onChange={(scanRootText) => props.onPatch({ scanRootText })}
              onClear={() => props.onPatch({ scanRootText: "" })}
              onPaste={() => props.onPaste("scan")}
            />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{props.tNode("sections.keywordsDepth", "关键词与扫描深度")}</div>
            <KeywordAndDepthFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">{props.tNode("sections.keySwitches", "关键开关")}</div>
            <PrimarySwitches data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
        </section>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="text-sm font-semibold">{props.tNode("sections.results", "Czkawka 路径 / 扫描结果")}</div>
            <ActionIconButton disabled={!props.result} icon={Copy} label={props.tNode("buttons.copyResults", "复制结果")} onClick={props.onCopyResults} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-5">
            {props.result?.allCombinedPaths.length ? (
              <>
                {props.result.allCombinedPaths.slice(0, 200).map((path) => (
                  <div key={path} className="truncate">{path}</div>
                ))}
                {props.result.allCombinedPaths.length > 200 ? (
                  <div className="pt-1 text-muted-foreground">{props.tNode("empty.truncated", "仅显示前 200 项（共 {{count}} 项）", { count: props.result.allCombinedPaths.length })}</div>
                ) : null}
              </>
            ) : props.result?.matchedPaths.length ? (
              <>
                {props.result.matchedPaths.slice(0, 200).map((path) => (
                  <div key={path} className="truncate">{path}</div>
                ))}
                {props.result.matchedPaths.length > 200 ? (
                  <div className="pt-1 text-muted-foreground">{props.tNode("empty.truncated", "仅显示前 200 项（共 {{count}} 项）", { count: props.result.matchedPaths.length })}</div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {props.data.progressText || props.tNode("empty.noProgress", "扫描或处理后将在此显示路径")}
              </div>
            )}
          </div>
          <div className="h-32 shrink-0 overflow-auto rounded-md border bg-muted/15 p-2 font-mono text-xs text-muted-foreground">
            {props.logs.length ? props.logs.map((line, index) => <div key={index} className="truncate">{line}</div>) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">{props.tNode("empty.logs", "暂无日志")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  const labelForAction = (value: string, fallback: string) => {
    if (value === "scan") return props.tNode("buttons.scan", fallback)
    if (value === "plan") return props.tNode("buttons.plan", fallback)
    return props.tNode("buttons.process", fallback)
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {ACTIONS.filter((item) => item.value !== "process").map((item) => (
        <ActionIconButton
          key={item.value}
          active={props.action === item.value}
          disabled={props.running || isActionDisabled(item.value, props)}
          icon={item.icon}
          label={labelForAction(item.value, item.label)}
          onClick={() => props.onExecute(item.value)}
        />
      ))}
      {!props.compact && <PrimaryActionButton props={props} />}
      <ActionIconButton disabled={!props.result} icon={Copy} label={props.tNode("buttons.copyResults", "复制结果")} onClick={props.onCopyResults} />
      <ActionIconButton disabled={!props.logs.length} icon={Copy} label={props.tNode("buttons.copyLogs", "复制日志")} onClick={props.onCopyLogs} />
      <ActionIconButton disabled={props.running} icon={RotateCcw} label={props.tNode("buttons.reset", "清空状态")} onClick={props.onReset} />
      {!props.compact && (
        <ConfigDefaultsPopover
          configDirty={props.configDirty}
          configFilePath={props.configFilePath}
          defaults={props.defaults}
          disabled={props.running}
          onOpenConfigFile={props.onOpenConfigFile}
          onResetOverride={props.onResetOverride}
          onRestoreDefault={props.onRestoreDefault}
          onSaveDefault={props.onSaveDefault}
        />
      )}
    </div>
  )
}

function PrimaryActionButton({ compact, props }: { compact?: boolean; props: ViewProps }) {
  if (props.running) {
    return (
      <Button aria-label={props.tNode("aria.running", "kavvka running")} disabled size={compact ? "icon-sm" : "sm"} variant="secondary">
        <Square />
        {!compact && <span>{props.tNode("status.running", "运行中")}</span>}
      </Button>
    )
  }

  const actionMeta = props.actionMeta
  const dangerous = actionMeta.value === "process" && !props.dryRun
  const label = dangerous ? props.tNode("buttons.realProcess", "真实处理") : actionMeta.label
  const disabled = isActionDisabled(actionMeta.value, props)

  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} variant="destructive">
            <actionMeta.icon />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.tNode("dialog.confirmRealTitle", "确认真实执行 Kavvka？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {props.tNode("dialog.confirmRealDesc", "当前关闭了预演，处理时会真的把兄弟目录移动到 #compare 下。源路径 {{count}} 项，请确认无误后继续。", { count: props.sourcePaths.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.tNode("buttons.cancel", "取消")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => props.onExecute("process")}>{props.tNode("buttons.confirmExecute", "确认执行")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Button aria-label={label} disabled={disabled} size={compact ? "icon-sm" : "sm"} onClick={() => props.onExecute(actionMeta.value)}>
      <actionMeta.icon />
      {!compact && <span>{label}</span>}
    </Button>
  )
}

function HeaderLine({ status, subtitle }: {
  status: KavvkaStatusMeta
  subtitle: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Image />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">Kavvka</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function StatsPanel(props: {
  progress: number
  result: KavvkaData | null
  scanRoots: string[]
  sourcePaths: string[]
}) {
  const { t: tNode } = useNodeI18n("kavvka")
  const errorLabel = tNode("stats.errors", "失败")
  const stats = [
    [tNode("stats.source", "源"), props.sourcePaths.length],
    [tNode("stats.roots", "根目录"), props.scanRoots.length],
    [tNode("stats.scanned", "扫描"), props.result?.scanResults.length ?? 0],
    [tNode("stats.matched", "匹配"), props.result?.matchedPaths.length ?? 0],
    [tNode("stats.processed", "处理"), props.result?.processedCount ?? 0],
    [tNode("stats.moved", "移动"), props.result?.movedCount ?? 0],
    [errorLabel, props.result?.errorCount ?? 0],
    [tNode("stats.progress", "进度"), `${props.progress}%`],
  ] as const

  return (
    <div className="grid shrink-0 grid-cols-4 gap-1 @4xl/kavvka:grid-cols-8">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center">
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", label === errorLabel && Number(value) > 0 && "text-destructive")}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function buildInput(action: KavvkaAction, data: KavvkaCardState): KavvkaInput {
  return {
    action,
    pathText: data.sourceText,
    scanRootText: data.scanRootText,
    keywordText: data.keywordText,
    scanDepth: data.scanDepth ?? 3,
    force: data.force ?? true,
    dryRun: action === "plan" ? true : data.dryRun ?? true,
    strictArtist: data.strictArtist ?? false,
  }
}

function phaseFromState(data: KavvkaCardState, running: boolean): KavvkaPhase {
  if (running) return data.phase ?? "processing"
  return data.phase ?? "idle"
}

function phaseForAction(action: KavvkaAction): KavvkaPhase {
  if (action === "scan") return "scanning"
  if (action === "plan") return "planning"
  return "processing"
}

function statusFromState(data: KavvkaCardState, running: boolean, tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string): KavvkaStatusMeta {
  if (running || data.phase === "scanning" || data.phase === "planning" || data.phase === "processing") {
    return {
      label: tNode("status.running", "运行中"),
      description: data.progressText || tNode("statusDesc.running", "Kavvka 正在处理当前任务。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.phase === "error" || (data.result?.errors.length ?? 0) > 0) {
    return {
      label: tNode("status.error", "失败"),
      description: data.progressText || data.result?.errors[0] || tNode("statusDesc.error", "上次任务失败，请查看日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  if (data.phase === "completed") {
    return {
      label: tNode("status.completed", "完成"),
      description: data.progressText || tNode("statusDesc.completed", "上次任务已完成。"),
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    }
  }
  if (data.result?.allCombinedPaths.length) {
    return {
      label: tNode("status.hasResults", "有结果"),
      description: tNode("statusDesc.hasResults", "{{count}} 个 Czkawka 路径已生成。", { count: data.result.allCombinedPaths.length }),
      tone: "idle",
      badgeVariant: "outline",
      iconClass: "bg-secondary text-secondary-foreground",
    }
  }
  return {
    label: tNode("status.idle", "就绪"),
    description: tNode("statusDesc.idle", "粘贴路径或扫描根目录后开始处理。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function isActionDisabled(action: KavvkaAction, props: ViewProps): boolean {
  if (action === "scan") return !props.scanRoots.length
  return !props.sourcePaths.length
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.errorCount) return props.tNode("summary.errors", "{{count}} 个失败", { count: props.result.errorCount })
  if (props.result?.allCombinedPaths.length) return props.tNode("summary.pathGroups", "{{count}} 组路径", { count: props.result.allCombinedPaths.length })
  if (props.result?.matchedPaths.length) return props.tNode("summary.matched", "{{count}} 个匹配", { count: props.result.matchedPaths.length })
  if (props.sourcePaths.length) return props.tNode("summary.sourceRoots", "{{source}} 源 / {{roots}} 根", { source: props.sourcePaths.length, roots: props.scanRoots.length })
  if (props.scanRoots.length) return props.tNode("summary.rootsScannable", "{{count}} 个根目录可扫描", { count: props.scanRoots.length })
  return props.tNode("summary.pasteHint", "粘贴路径或扫描根目录")
}

function appendText(current = "", next: string): string {
  return current.trim() ? `${current.trimEnd()}\n${next}` : next
}
