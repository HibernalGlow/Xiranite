import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import type {
  EngineVAction,
  EngineVData,
  EngineVInput,
  EngineVResult,
} from "@xiranite/node-enginev/core"
import { filterWallpapers } from "@xiranite/node-enginev/core"
import { Copy, Eye, FolderInput, Image, Images, ListChecks, RotateCcw, Settings2, SlidersHorizontal, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NodeSectionHeader } from "@/nodes/shared/NodeSectionHeader"
import { RunningTint } from "@/nodes/shared/controls"
import { ACTIONS, CONFIG_FIELDS, UI_CONFIG_FIELDS } from "./constants"
import {
  ActionIconButton,
  EngineWorkflowTabs,
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
import type { EngineVCardState, EngineVNodeConfig, EngineVStatusMeta, EngineVUiConfig } from "./types"
import { WallpaperGallery } from "./WallpaperGallery"

type EngineVProps = NodeComponentProps<EngineVCardState, EngineVNodeConfig>

export function Component({ host }: EngineVProps) {
  const surface = useNodeSurface()
  const { t: tNode } = useNodeI18n("enginev")
  const data = host.state.getData() ?? {}
  const dataRef = useRef<EngineVCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<EngineVCardState> | undefined>(undefined)
  const [uiDefaults, setUiDefaults] = useState<EngineVUiConfig | undefined>(undefined)
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)
  const uiConfigLoadedRef = useRef(false)
  const applyingUiConfigRef = useRef(false)
  const lastSavedUiConfigKeyRef = useRef("")

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
  const status = statusFromState(data, running, tNode)
  const actionMeta = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
  const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

  useEffect(() => {
    host.config?.get()
      .then((response) => {
        setDefaults(pickEngineVRuntimeConfig(response.config))
        setConfigFilePath(response.path)
      })
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    let cancelled = false
    uiConfigLoadedRef.current = false
    applyingUiConfigRef.current = false
    lastSavedUiConfigKeyRef.current = ""

    async function loadUiConfig() {
      try {
        const response = await host.config?.getUi?.<EngineVUiConfig>()
        if (cancelled) return

        const config = normalizeEngineVUiConfig(response?.config)
        if (hasEngineVUiConfig(config)) {
          setUiDefaults(config)
          applyingUiConfigRef.current = true
          patch(config)
          lastSavedUiConfigKeyRef.current = stableStringify(config)
          uiConfigLoadedRef.current = true
          queueMicrotask(() => {
            applyingUiConfigRef.current = false
          })
          return
        }

        const migrated = pickEngineVUiConfig(dataRef.current)
        if (hasEngineVUiConfig(migrated)) {
          await host.config?.saveUi?.(migrated)
          setUiDefaults(migrated)
        } else {
          setUiDefaults(undefined)
        }
        lastSavedUiConfigKeyRef.current = stableStringify(migrated)
        uiConfigLoadedRef.current = true
      } catch {
        if (!cancelled) uiConfigLoadedRef.current = true
      }
    }

    void loadUiConfig()

    return () => {
      cancelled = true
    }
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.outputPath, data.template, data.workshopPath, defaults])

  const uiConfigKey = useMemo(
    () => stableStringify(pickEngineVUiConfig(data)),
    [data.galleryColumns, data.galleryCompact, data.galleryShowMeta, data.galleryShowPath],
  )

  useEffect(() => {
    if (!uiConfigLoadedRef.current || applyingUiConfigRef.current || !host.config?.saveUi) return
    if (uiConfigKey === lastSavedUiConfigKeyRef.current) return

    const timer = window.setTimeout(() => {
      const config = pickEngineVUiConfig(dataRef.current)
      const nextKey = stableStringify(config)
      if (nextKey === lastSavedUiConfigKeyRef.current) return

      host.config?.saveUi?.(config)
        .then(() => {
          lastSavedUiConfigKeyRef.current = nextKey
        })
        .catch(() => undefined)
    }, 400)

    return () => window.clearTimeout(timer)
  }, [host, uiConfigKey])

  function patch(patchData: Partial<EngineVCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.state.patchData(patchData)
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
    const config: EngineVNodeConfig = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined && value !== "") (config as Record<string, unknown>)[field] = value
    }
    await host.config?.save(config)
    if (host.config?.saveUi) {
      const uiConfig = resolveEngineVUiConfigForSave(dataRef.current)
      await host.config.saveUi(uiConfig)
      setUiDefaults(uiConfig)
      lastSavedUiConfigKeyRef.current = stableStringify(uiConfig)
    }
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
      const message = tNode("pathRequired", "请先选择 Wallpaper Engine 工坊目录，或先完成一次扫描。")
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }
    if (nextAction === "delete" && !ids.length) {
      const message = tNode("deleteRequiresSelection", "删除前请先在画廊中选择至少一个项目。")
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }
    if (nextAction === "export" && !input.exportPath) {
      const message = tNode("exportRequiresPath", "导出需要目标文件路径。")
      patch({ phase: "error", progressText: message })
      pushLog(message)
      return
    }

    const runAction = host.runner?.run
    if (!runAction) {
      const message = tNode("noNative", "Local Backend 暂不可用，无法运行 enginev。")
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
      return
    }

    setRunning(true)
    patch({ action: nextAction, phase: "running", progress: 0, progressText: tNode("actionStart", "正在{{action}}。", { action: labelForAction(nextAction) }) })
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
    uiDefaults,
    galleryWallpapers,
    host,
    logs,
    progress,
    result,
    running,
    selectedIds,
    status,
    tNode,
    wallpapers,
    onActionChange: (value: EngineVAction) => patch({ action: value }),
    onCopyLogs: copyLogs,
    onCopyPath: copyPath,
    onCopyResults: copyResults,
    onExecute: (value?: EngineVAction) => execute(value),
    onOpenConfigFile: host.config?.openFile,
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
  action: EngineVAction
  actionMeta: typeof ACTIONS[number]
  configDirty: boolean
  configFilePath?: string
  data: EngineVCardState
  defaults?: Partial<EngineVCardState>
  uiDefaults?: EngineVUiConfig
  galleryWallpapers: EngineVData["wallpapers"]
  host: EngineVProps["host"]
  logs: string[]
  progress: number
  result: EngineVData | null
  running: boolean
  selectedIds: string[]
  status: EngineVStatusMeta
  tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string
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
    <div className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-card/90 px-3 py-2 shadow-sm">
      <RunningTint tone={props.status.tone} />
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
          {props.tNode("summary.visibleSelected", "{{visible}} 可见 · {{selected}} 选中", { visible: props.galleryWallpapers.length, selected: props.selectedIds.length })}
        </div>
      </div>
      <Button aria-label={props.tNode("buttons.quickAction", "快速{{action}}", { action: props.actionMeta.shortLabel })} disabled={props.running} size="icon-xs" onClick={() => props.onExecute(props.action)}>
        <ActionIcon />
        <span className="sr-only">{props.tNode("buttons.quickAction", "快速{{action}}", { action: props.actionMeta.shortLabel })}</span>
      </Button>
      {props.status.tone === "running" && <div className="relative text-xs tabular-nums text-muted-foreground">{props.progress}%</div>}
    </div>
  )
}

function CompactView(props: ViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || props.actionMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <FilterPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <EngineExecutionBar {...props} />
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={Eye} label={props.tNode("buttons.dryRun", "预演")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
          <SwitchRow checked={props.data.copyMode ?? false} disabled={props.running} icon={Copy} label={props.tNode("buttons.copy", "复制")} onCheckedChange={(copyMode) => props.onPatch({ copyMode })} />
        </div>
        <ToolbarActions compact {...props} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip compact progress={props.progress} status={props.status} text={props.data.progressText} />
        )}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="truncate text-xs text-muted-foreground">{props.tNode("empty.visibleItems", "{{count}} 个可见项目", { count: props.galleryWallpapers.length })}</div>
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
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine status={props.status} subtitle={props.data.progressText || props.actionMeta.description} />
        <div className="flex shrink-0 items-center gap-1">
          <FilterPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
          <OptionsPopover data={props.data} disabled={props.running} onPatch={props.onPatch} />
        </div>
      </div>

      <div className="grid shrink-0 gap-2">
        <PathInput compact data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
        <EngineExecutionBar {...props} />
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow checked={props.data.dryRun ?? true} disabled={props.running} icon={Eye} label={props.tNode("buttons.dryRun", "预演")} onCheckedChange={(dryRun) => props.onPatch({ dryRun })} />
          <SwitchRow checked={props.data.copyMode ?? false} disabled={props.running} icon={Copy} label={props.tNode("buttons.copy", "复制")} onCheckedChange={(copyMode) => props.onPatch({ copyMode })} />
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
              <div className="truncate text-xs font-medium text-muted-foreground">{props.tNode("empty.visibleItems", "{{count}} 个可见项目", { count: props.galleryWallpapers.length })}</div>
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
            subtitle={props.data.progressText || props.tNode("summary.headerLine", "{{visible}} 可见 / {{scanned}} 已扫描 / {{selected}} 选中", { visible: props.galleryWallpapers.length, scanned: props.wallpapers.length, selected: props.selectedIds.length })}
          />
          <div data-testid="enginev-header-toolbar" className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarActions {...props} />
            <ActionIconButton label={props.tNode("buttons.clearState", "清空状态")} icon={RotateCcw} disabled={props.running} onClick={props.onReset} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HeaderStats selected={props.selectedIds.length} total={props.wallpapers.length} visible={props.galleryWallpapers.length} tNode={props.tNode} />
          <ConfigDefaultsPopover
            configDirty={props.configDirty}
            configFilePath={props.configFilePath}
            defaults={props.defaults}
            disabled={props.running}
            uiDefaults={props.uiDefaults}
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
              <NodeSectionHeader
                icon={FolderInput}
                title={props.tNode("sections.input", "输入")}
                description={props.tNode("sections.inputDesc", "工坊路径、执行动作和高频按钮固定在顶部，不被画廊和日志挤出视野。")}
              />
              <PathInput data={props.data} disabled={props.running} onPaste={props.onPaste} onPatch={props.onPatch} />
              <EngineExecutionBar {...props} />
            </section>
            <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
              <NodeSectionHeader icon={SlidersHorizontal} title={props.tNode("sections.filter", "筛选")} />
              <FilterFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
            </section>
            <section className="flex shrink-0 flex-col gap-3 border-b pb-3">
              <NodeSectionHeader icon={Settings2} title={props.tNode("sections.writeOptions", "写入选项")} />
              <OptionsFields data={props.data} disabled={props.running} onPatch={props.onPatch} />
            </section>
            <StatusStrip progress={props.progress} status={props.status} text={props.data.progressText} />
            <StatsPanel result={props.result} selected={props.selectedIds.length} total={props.wallpapers.length} visible={props.galleryWallpapers.length} />
          </div>
        </ScrollArea>

        <Tabs defaultValue="gallery" className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <TabsList variant="line">
              <TabsTrigger value="gallery" className="gap-1.5 px-2.5">
                <Images className="size-3.5 shrink-0" />
                {props.tNode("tabs.gallery", "画廊")}
              </TabsTrigger>
              <TabsTrigger value="results" className="gap-1.5 px-2.5">
                <ListChecks className="size-3.5 shrink-0" />
                {props.tNode("tabs.results", "结果")}
              </TabsTrigger>
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

function EngineExecutionBar(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <EngineWorkflowTabs action={props.action} className="min-w-0 flex-1" disabled={props.running} onActionChange={props.onActionChange} />
      <Button disabled={props.running || isActionDisabled(props.action, props)} onClick={() => props.onExecute(props.action)}>
        <ActionIcon data-icon="inline-start" />
        {props.tNode("buttons.run", "运行")} {props.actionMeta.shortLabel}
      </Button>
    </div>
  )
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", props.compact && "justify-between")}>
      <DeleteConfirmButton disabled={props.running || !props.selectedIds.length} onConfirm={() => props.onExecute("delete")} selectedCount={props.selectedIds.length} tNode={props.tNode} />
      <ActionIconButton label={props.tNode("buttons.copyResults", "复制结果")} icon={Copy} disabled={!props.galleryWallpapers.length && !props.result} onClick={props.onCopyResults} />
    </div>
  )
}

function DeleteConfirmButton(props: {
  disabled?: boolean
  selectedCount: number
  tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button aria-label={props.tNode("aria.deleteSelected", "删除所选")} disabled={props.disabled} size="icon-sm" variant="destructive">
              <Trash2 />
              <span className="sr-only">{props.tNode("aria.deleteSelected", "删除所选")}</span>
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{props.tNode("aria.deleteSelected", "删除所选")}</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.tNode("dialog.confirmDeleteTitle", "确认删除所选项目？")}</AlertDialogTitle>
          <AlertDialogDescription>
            {props.tNode("dialog.confirmDeleteDesc", "将处理 {{count}} 个 Wallpaper Engine 工坊项目。默认会走回收站；如果关闭预演并启用永久删除，操作不可恢复。", { count: props.selectedCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{props.tNode("buttons.cancel", "取消")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>{props.tNode("buttons.confirmDelete", "确认删除")}</AlertDialogAction>
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

function HeaderStats(props: { selected: number; total: number; visible: number; tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string }) {
  const items = [
    [props.tNode("stats.visible", "可见"), props.visible, Eye],
    [props.tNode("stats.scanned", "已扫描"), props.total, Images],
    [props.tNode("stats.selected", "选中"), props.selected, ListChecks],
  ] as const
  return (
    <div className="hidden shrink-0 grid-cols-3 gap-1 @4xl/enginev:grid @4xl/enginev:min-w-52">
      {items.map(([label, value, Icon]) => (
        <div key={label} className="min-w-0 rounded-md bg-muted/30 px-2 py-1 text-center">
          <div className="flex min-w-0 items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{label}</span>
          </div>
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

function statusFromState(data: EngineVCardState, running: boolean, tNode: (key: string, fallback: string, vars?: Record<string, unknown>) => string): EngineVStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: tNode("status.running", "运行中"),
      description: data.progressText || tNode("statusDesc.running", "EngineV 正在处理当前任务。"),
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
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
  if (data.phase === "error") {
    return {
      label: tNode("status.error", "失败"),
      description: data.progressText || tNode("statusDesc.error", "上次任务失败，请查看结果和日志。"),
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    }
  }
  return {
    label: tNode("status.idle", "就绪"),
    description: tNode("statusDesc.idle", "选择工坊路径后即可扫描。"),
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  }
}

function summarize(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText
  if (props.result?.failedCount) return props.tNode("summary.failedItems", "{{count}} 个失败项", { count: props.result.failedCount })
  if (props.galleryWallpapers.length) return props.tNode("summary.visibleItems", "{{count}} 个可见项目", { count: props.galleryWallpapers.length })
  if (props.data.workshopPath) return compactPath(props.data.workshopPath)
  return props.tNode("summary.selectWorkshop", "选择工坊目录")
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

function pickEngineVRuntimeConfig(config: EngineVNodeConfig | undefined): Partial<EngineVCardState> | undefined {
  if (!config) return undefined
  const next: Partial<EngineVCardState> = {}
  for (const field of CONFIG_FIELDS) {
    const value = config[field]
    if (value !== undefined) (next as Record<string, unknown>)[field] = value
  }
  return Object.keys(next).length ? next : undefined
}

function normalizeEngineVUiConfig(config: EngineVUiConfig | undefined): EngineVUiConfig {
  if (!config) return {}
  const next: EngineVUiConfig = {}
  if (typeof config.galleryColumns === "number" && Number.isFinite(config.galleryColumns)) {
    next.galleryColumns = Math.min(6, Math.max(1, Math.round(config.galleryColumns)))
  }
  if (typeof config.galleryCompact === "boolean") next.galleryCompact = config.galleryCompact
  if (typeof config.galleryShowMeta === "boolean") next.galleryShowMeta = config.galleryShowMeta
  if (typeof config.galleryShowPath === "boolean") next.galleryShowPath = config.galleryShowPath
  return next
}

function pickEngineVUiConfig(data: Partial<EngineVCardState>): EngineVUiConfig {
  const config: EngineVUiConfig = {}
  if (hasOwn(data, "galleryColumns")) {
    const value = data.galleryColumns
    config.galleryColumns = typeof value === "number" && Number.isFinite(value)
      ? Math.min(6, Math.max(1, Math.round(value)))
      : undefined
  }
  for (const field of UI_CONFIG_FIELDS.filter((item) => item !== "galleryColumns")) {
    if (hasOwn(data, field)) {
      const value = data[field]
      const next = config as Record<string, unknown>
      next[field] = typeof value === "boolean" ? value : undefined
    }
  }
  return config
}

function resolveEngineVUiConfigForSave(data: Partial<EngineVCardState>): EngineVUiConfig {
  const value = data.galleryColumns
  return {
    galleryColumns: typeof value === "number" && Number.isFinite(value)
      ? Math.min(6, Math.max(1, Math.round(value)))
      : undefined,
    galleryCompact: data.galleryCompact ?? false,
    galleryShowMeta: data.galleryShowMeta ?? true,
    galleryShowPath: data.galleryShowPath ?? true,
  }
}

function hasEngineVUiConfig(config: EngineVUiConfig): boolean {
  return Object.values(config).some((value) => value !== undefined)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value))
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortObject((value as Record<string, unknown>)[key])]),
  )
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
