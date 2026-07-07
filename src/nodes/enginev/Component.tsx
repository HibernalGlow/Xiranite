import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type {
  EngineVAction,
  EngineVData,
  EngineVInput,
  EngineVResult,
} from "@xiranite/node-enginev/core"
import { filterWallpapers } from "@xiranite/node-enginev/core"
import { Copy, Eye, Image, Play, RotateCcw, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { ACTIONS, CONFIG_FIELDS } from "./constants"
import {
  ActionIconButton,
  ActionSelect,
  ConfigDefaultsPopover,
  FilterFields,
  FilterPopover,
  GallerySettingsPopover,
  OptionsFields,
  OptionsPopover,
  PathInput,
  StatusStrip,
  SwitchRow,
} from "./controls"
import { ResultTabs, StatsPanel } from "./ResultPanels"
import type { EngineVCardState, EngineVStatusMeta } from "./types"
import { WallpaperGallery } from "./WallpaperGallery"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const data = host.getData<EngineVCardState>(compId) ?? {}
  const dataRef = useRef<EngineVCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<EngineVCardState> | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const result = data.result ?? null
  const logs = data.logs ?? []
  const action = data.action ?? "scan"
  const progress = data.progress ?? 0
  const wallpapers = data.wallpapers ?? result?.wallpapers ?? []
  const selectedIds = useMemo(() => parseIds(data.idsText), [data.idsText])
  const hasFilters = Boolean(data.titleFilter || data.ratingFilter || data.typeFilter)
  const galleryWallpapers = useMemo(() => {
    if (!wallpapers.length) return []
    if (hasFilters) {
      return filterWallpapers(wallpapers, {
        title: data.titleFilter,
        contentRating: data.ratingFilter,
        type: data.typeFilter,
      })
    }
    return data.filteredWallpapers?.length ? data.filteredWallpapers : wallpapers
  }, [data.filteredWallpapers, data.ratingFilter, data.titleFilter, data.typeFilter, hasFilters, wallpapers])
  const status = statusFromState(data, running)
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const forceCollapsedSurface = surface.mode === "compact" && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "compact" && surface.width < 560 && surface.height >= 300

  useEffect(() => {
    host.getNodeConfig?.<Partial<EngineVCardState>>()
      .then((response) => {
        setDefaults(response.config)
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.outputPath, data.template, data.workshopPath, defaults])

  function patch(patchData: Partial<EngineVCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ workshopPath: text.trim() })
  }

  async function copyPath(path: string) {
    await host.clipboard?.writeText?.(path)
  }

  async function copyResults() {
    const resultLines = [
      ...galleryWallpapers.map((item) => `${item.workshopId}\t${item.title || item.folderName}\t${item.path}`),
      ...(result?.renameResults ?? []).map((item) => `${item.status}\t${item.oldName}\t${item.newName}`),
      ...(result?.deleteResults ?? []).map((item) => `${item.status}\t${item.workshopId}\t${item.message}`),
    ]
    if (resultLines.length) await host.clipboard?.writeText?.(resultLines.join("\n"))
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({
      phase: "idle",
      progress: 0,
      progressText: "",
      result: null,
      wallpapers: [],
      filteredWallpapers: [],
      logs: [],
    })
  }

  async function saveAsDefault() {
    const config: Partial<EngineVCardState> = {}
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
    patch({ workshopPath: undefined, outputPath: undefined, template: undefined })
  }

  function toggleWallpaper(id: string) {
    const current = new Set(parseIds(dataRef.current.idsText))
    if (current.has(id)) current.delete(id)
    else current.add(id)
    patch({ idsText: [...current].join(",") })
  }

  async function execute(nextAction = action) {
    if (running) return
    const current = dataRef.current
    const ids = parseIds(current.idsText)
    const input = buildInput(nextAction, current)

    if (!input.path && !input.wallpapers?.length) {
      const message = "请先选择 Wallpaper Engine 工坊目录，或先完成一次扫描。"
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }
    if (nextAction === "delete" && !ids.length) {
      const message = "删除前请先在画廊中选择至少一个项目。"
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }
    if (nextAction === "export" && !input.exportPath) {
      const message = "导出需要目标文件路径。"
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }

    const runAction = host.actions?.run
    if (!runAction) {
      const message = "Local Backend 暂不可用，无法运行 enginev。"
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: `正在${labelForAction(nextAction)}。` })
    try {
      const response = await runAction<EngineVInput, EngineVData>("enginev", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
          return
        }
        pushLog(event.message)
      }) as EngineVResult

      const next = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: next,
        wallpapers: next?.wallpapers ?? dataRef.current.wallpapers ?? [],
        filteredWallpapers: next?.filteredWallpapers ?? dataRef.current.filteredWallpapers ?? [],
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

  const commonProps = {
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    galleryWallpapers,
    host,
    logs,
    progress,
    result,
    running,
    selectedIds,
    status,
    wallpapers,
    onActionChange: (value: EngineVAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyPath: copyPath,
    onCopyResults: copyResults,
    onExecute: (value?: EngineVAction) => execute(value),
    onOpenConfigFile: host.openConfigFile,
    onPaste: pastePath,
    onPatch: patch,
    onReset: reset,
    onResetOverride: resetOverride,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
    onToggleWallpaper: toggleWallpaper,
  }

  return (
    <TooltipProvider>
      <div ref={surface.ref} className="@container/enginev relative flex h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_18%_0%,hsl(var(--primary)/0.16),transparent_36%),radial-gradient(circle_at_84%_8%,hsl(var(--chart-2)/0.16),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : surface.mode === "compact" ? (
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
  action: EngineVAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: EngineVCardState
  defaults?: Partial<EngineVCardState>
  galleryWallpapers: EngineVData["wallpapers"]
  host: NodeComponentProps["host"]
  logs: string[]
  progress: number
  result: EngineVData | null
  running: boolean
  selectedIds: string[]
  status: EngineVStatusMeta
  wallpapers: EngineVData["wallpapers"]
  onActionChange: (value: EngineVAction) => void
  onCopyLogs: () => void
  onCopyPath: (path: string) => void
  onCopyResults: () => void
  onExecute: (value?: EngineVAction) => void
  onOpenConfigFile?: () => Promise<void> | void
  onPaste: () => void
  onPatch: (patch: Partial<EngineVCardState>) => void
  onReset: () => void
  onResetOverride: () => void
  onRestoreDefault: () => void
  onSaveDefault: () => void
  onToggleWallpaper: (id: string) => void
}) {
  return props
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm">
      <div className={cn("absolute inset-0 opacity-70 transition-opacity", props.status.tone === "running" && "animate-pulse bg-primary/10", props.status.tone === "error" && "bg-destructive/10", props.status.tone === "success" && "bg-primary/10")} />
      <div className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg", props.status.iconClass)}>
        <Image />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>EngineV</span>
          <Badge variant={props.status.badgeVariant}>{props.status.label}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{summarize(props)}</div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {props.galleryWallpapers.length} 可见 · {props.selectedIds.length} 选中
        </div>
      </div>
      <Button aria-label={`快速${props.actionMeta.shortLabel}`} disabled={props.running} size="icon-xs" onClick={() => props.onExecute(props.action)}>
        <ActionIcon />
        <span className="sr-only">快速{props.actionMeta.shortLabel}</span>
      </Button>
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || props.actionMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <FilterPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <Button aria-label={`执行${props.actionMeta.shortLabel}`} disabled={props.running} size="icon-sm" onClick={() => props.onExecute(props.action)}>
            <ActionIcon />
            <span className="sr-only">执行{props.actionMeta.shortLabel}</span>
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <ActionSelect action={props.action} disabled={props.running} triggerClassName="w-full" onActionChange={props.onActionChange} />
          <Button disabled={props.running} onClick={() => props.onExecute(props.action)}>
            <Play data-icon="inline-start" />
            运行
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={Eye} label="预演" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
          <SwitchRow checked={props.data.copyMode ?? false} disabled={props.running} icon={Copy} label="复制" onCheckedChange={(copyMode) => props.onPatch({ copyMode })} />
        </div>
        <ToolbarActions compact {...props} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="truncate text-xs text-muted-foreground">{props.galleryWallpapers.length} 个可见项目</div>
          <GallerySettingsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
        <div className="min-h-0 flex-1">
          <WallpaperGallery
            columns={props.data.galleryColumns}
            compact={props.data.galleryCompact}
            host={props.host}
            showMeta={props.data.galleryShowMeta}
            showPath={props.data.galleryShowPath}
            selectedIds={props.selectedIds}
            wallpapers={props.galleryWallpapers}
            onCopyPath={props.onCopyPath}
            onToggle={props.onToggleWallpaper}
          />
        </div>
      </div>
    </div>
  )
}

function PortraitCompactView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || props.actionMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <FilterPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <Button aria-label={`执行${props.actionMeta.shortLabel}`} disabled={props.running} size="icon-sm" onClick={() => props.onExecute(props.action)}>
            <ActionIcon />
            <span className="sr-only">执行{props.actionMeta.shortLabel}</span>
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 gap-2">
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <ActionSelect action={props.action} disabled={props.running} triggerClassName="w-full" onActionChange={props.onActionChange} />
          <Button disabled={props.running} onClick={() => props.onExecute(props.action)}>
            <Play data-icon="inline-start" />
            运行
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={Eye} label="预演" onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
          <SwitchRow checked={props.data.copyMode ?? false} disabled={props.running} icon={Copy} label="复制" onCheckedChange={(copyMode) => props.onPatch({ copyMode })} />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <ToolbarActions compact {...props} />
          <GallerySettingsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
      </div>

      {props.galleryWallpapers.length ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(96px,1fr)_minmax(128px,0.85fr)] gap-2">
          <section className="flex min-h-0 flex-col gap-1.5">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="truncate text-xs font-medium text-muted-foreground">{props.galleryWallpapers.length} 个可见项目</div>
            </div>
            <div className="min-h-0 flex-1">
              <WallpaperGallery
                columns={props.data.galleryColumns}
                compact={props.data.galleryCompact}
                host={props.host}
                showMeta={props.data.galleryShowMeta}
                showPath={props.data.galleryShowPath}
                selectedIds={props.selectedIds}
                wallpapers={props.galleryWallpapers}
                onCopyPath={props.onCopyPath}
                onToggle={props.onToggleWallpaper}
              />
            </div>
          </section>
          <ResultTabs compact result={props.result} logs={props.logs} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResultTabs compact result={props.result} logs={props.logs} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
        </div>
      )}
    </div>
  )
}

function FullView(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-col gap-3 @4xl/enginev:flex-row @4xl/enginev:items-center @4xl/enginev:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/enginev:flex-row @4xl/enginev:items-center">
          <HeaderLine
            status={props.status}
            subtitle={props.data.progressText || `${props.galleryWallpapers.length} 可见 / ${props.wallpapers.length} 已扫描 / ${props.selectedIds.length} 选中`}
          />
          <div data-testid="enginev-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ActionSelect action={props.action} disabled={props.running} triggerClassName="w-36 @4xl/enginev:w-40" onActionChange={props.onActionChange} />
            <ToolbarActions {...props} />
            <ActionIconButton label="清空状态" icon={RotateCcw} disabled={props.running} onClick={props.onReset} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HeaderStats selected={props.selectedIds.length} total={props.wallpapers.length} visible={props.galleryWallpapers.length} />
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
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/enginev:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <ScrollArea className="min-h-0">
          <div className="flex min-h-0 flex-col gap-3 pr-1">
            <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
              <div>
                <div className="text-sm font-semibold">输入</div>
                <div className="text-xs text-muted-foreground">工坊路径、执行动作和高频按钮固定在顶部，不被画廊和日志挤出视野。</div>
              </div>
              <PathInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
            </section>
            <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
              <div className="text-sm font-semibold">筛选</div>
              <FilterFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
            </section>
            <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
              <div className="text-sm font-semibold">写入选项</div>
              <OptionsFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
            </section>
            <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
            <StatsPanel result={props.result} selected={props.selectedIds.length} total={props.wallpapers.length} visible={props.galleryWallpapers.length} />
          </div>
        </ScrollArea>

        <Tabs defaultValue="gallery" className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="gallery">画廊</TabsTrigger>
              <TabsTrigger value="results">结果</TabsTrigger>
            </TabsList>
            <GallerySettingsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          </div>
          <TabsContent value="gallery" className="min-h-0 flex-1">
            <WallpaperGallery
              columns={props.data.galleryColumns}
              compact={props.data.galleryCompact}
              host={props.host}
              showMeta={props.data.galleryShowMeta}
              showPath={props.data.galleryShowPath}
              selectedIds={props.selectedIds}
              wallpapers={props.galleryWallpapers}
              onCopyPath={props.onCopyPath}
              onToggle={props.onToggleWallpaper}
            />
          </TabsContent>
          <TabsContent value="results" className="min-h-0 flex-1">
            <ResultTabs result={props.result} logs={props.logs} onCopyLogs={props.onCopyLogs} onCopyResults={props.onCopyResults} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      {ACTIONS.filter((item) => item.value !== "delete").map((item) => (
        <ActionIconButton
          key={item.value}
          active={props.action === item.value}
          disabled={props.running || isActionDisabled(item.value, props)}
          icon={item.icon}
          label={item.label}
          onClick={() => props.onExecute(item.value)}
        />
      ))}
      <DeleteConfirmButton disabled={props.running || !props.selectedIds.length} onConfirm={() => props.onExecute("delete")} selectedCount={props.selectedIds.length} />
      <ActionIconButton label="复制结果" icon={Copy} disabled={!props.galleryWallpapers.length && !props.result} onClick={props.onCopyResults} />
    </div>
  )
}

function DeleteConfirmButton(props: {
  disabled?: boolean
  selectedCount: number
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button aria-label="删除所选" disabled={props.disabled} size="icon-sm" variant="destructive">
              <Trash2 />
              <span className="sr-only">删除所选</span>
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>删除所选</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除所选项目？</AlertDialogTitle>
          <AlertDialogDescription>
            将处理 {props.selectedCount} 个 Wallpaper Engine 工坊项目。默认会走回收站；如果关闭预演并启用永久删除，操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>确认删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function HeaderLine({ status, subtitle }: { status: EngineVStatusMeta; subtitle: string }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", status.iconClass)}>
          <Image />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">EngineV</h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function HeaderStats(props: { selected: number; total: number; visible: number }) {
  const items = [
    ["可见", props.visible],
    ["已扫描", props.total],
    ["选中", props.selected],
  ] as const
  return (
    <div className="hidden shrink-0 grid-cols-3 gap-1 @4xl/enginev:grid @4xl/enginev:min-w-52">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/30 px-2 py-1 text-center">
          <div className="truncate text-[10px] text-muted-foreground">{label}</div>
          <div className="text-xs font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

function buildInput(action: EngineVAction, data: EngineVCardState): EngineVInput {
  const ids = parseIds(data.idsText)
  return {
    action,
    path: data.workshopPath,
    wallpapers: action === "scan" ? undefined : data.wallpapers,
    filters: {
      title: data.titleFilter,
      contentRating: data.ratingFilter,
      type: data.typeFilter,
    },
    ids: ids.length ? ids : undefined,
    template: data.template,
    dryRun: data.dryRun ?? true,
    permanent: data.permanent ?? false,
    copyMode: data.copyMode ?? false,
    targetPath: data.targetPath,
    exportPath: data.outputPath || data.targetPath,
    exportFormat: data.exportFormat ?? "json",
  }
}

function statusFromState(data: EngineVCardState, running: boolean): EngineVStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: "EngineV 正在处理当前任务。",
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
      description: "上次任务失败，请查看结果和日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: "就绪",
    description: "选择工坊路径后即可扫描。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summarize(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.failedCount) return `${props.result.failedCount} 个失败项`
  if (props.galleryWallpapers.length) return `${props.galleryWallpapers.length} 个可见项目`
  if (props.data.workshopPath) return compactPath(props.data.workshopPath)
  return "选择工坊目录"
}

function labelForAction(action: EngineVAction): string {
  return ACTIONS.find((item) => item.value === action)?.shortLabel ?? action
}

function isActionDisabled(action: EngineVAction, props: ViewProps): boolean {
  if (action === "scan") return !props.data.workshopPath
  if (action === "export") return !props.galleryWallpapers.length || !(props.data.outputPath || props.data.targetPath)
  return !props.galleryWallpapers.length && !props.data.workshopPath
}

function parseIds(value = ""): string[] {
  const seen = new Set<string>()
  return value.split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function compactPath(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : value
}
