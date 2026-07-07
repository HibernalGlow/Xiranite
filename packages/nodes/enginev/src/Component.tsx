import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, Filter, Image, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeConfigButton, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { EngineVAction, EngineVData, EngineVInput, EngineVResult, EngineVWallpaper } from "./core.js"

interface EngineVCardState {
  workshopPath?: string
  titleFilter?: string
  ratingFilter?: string
  typeFilter?: string
  idsText?: string
  template?: string
  outputPath?: string
  dryRun?: boolean
  copyMode?: boolean
  targetPath?: string
  phase?: string
  progress?: number
  progressText?: string
  wallpapers?: EngineVWallpaper[]
  filteredWallpapers?: EngineVWallpaper[]
  result?: EngineVData | null
  logs?: string[]
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof EngineVCardState)[] = ["workshopPath", "outputPath", "template"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<EngineVCardState>(compId) ?? {}
  const dataRef = useRef<EngineVCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.enginev] 读取）
  const [defaults, setDefaults] = useState<Partial<EngineVCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<EngineVCardState>>().then((result) => {
      setDefaults(result.config)
    }).catch(() => {
      // backend 不可用或配置文件不存在
    })
  }, [])

  // 检测 comp.data 中的配置字段是否与 TOML 默认值不同
  useEffect(() => {
    if (!defaults) return
    const dirty = CONFIG_FIELDS.some((field) => {
      const current = data[field] as string | undefined
      const defaultVal = defaults[field] as string | undefined
      return (current ?? "") !== (defaultVal ?? "")
    })
    setConfigDirty(dirty)
  }, [data.workshopPath, data.outputPath, data.template, defaults])

  const result = data.result ?? null
  const wallpapers = data.wallpapers ?? result?.wallpapers ?? []
  const filtered = data.filteredWallpapers ?? result?.filteredWallpapers ?? []
  const logs = data.logs ?? []
  const selectedIds = parseIds(data.idsText)

  function patch(patchData: Partial<EngineVCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ workshopPath: text.trim() })
  }

  async function execute(action: EngineVAction, forceWrite = false) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    const input = buildInput(action, data, forceWrite)
    if (!input.path && !input.wallpapers?.length) return
    if (action === "delete" && !selectedIds.length) return
    if (action === "export" && !input.exportPath) return

    setRunning(true)
    try {
      patch({ phase: action, progress: 0, progressText: t("module:enginev.starting") })
      const response = await runNativeAction<EngineVInput, EngineVData>("enginev", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          log(`[${event.progress ?? 0}%] ${event.message}`)
        }
        else log(event.message)
      }) as EngineVResult
  
      const next = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: next,
        wallpapers: next?.wallpapers ?? wallpapers,
        filteredWallpapers: next?.filteredWallpapers ?? filtered,
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  async function copyResults() {
    const text = filtered.map((item) => `${item.workshopId}\t${item.title}\t${item.path}`).join("\n")
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, wallpapers: [], filteredWallpapers: [], logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<EngineVCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field] as string | undefined
      if (value) (config as Record<string, unknown>)[field] = value
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

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:enginev.title")}
        meta={t("module:enginev.meta", {
          scanned: wallpapers.length,
          visible: filtered.length,
          selected: selectedIds.length,
        })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <IconButton title={t("module:enginev.pasteWorkshopPath")} disabled={running} onClick={pastePath}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.workshopPath} onClick={() => execute("scan")}><RefreshCw size={14} /> {t("module:enginev.scan")}</ActionButton>
            <ActionButton disabled={running || (!wallpapers.length && !data.workshopPath)} onClick={() => execute("filter")}><Filter size={14} /> {t("module:enginev.filter")}</ActionButton>
            <ActionButton variant="primary" disabled={running || (!wallpapers.length && !data.workshopPath)} onClick={() => execute("rename")}><Play size={14} /> {t("module:enginev.rename")}</ActionButton>
            <IconButton title={t("module:enginev.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:enginev.copyLogs")} onClick={copyLogs}><Download size={14} /></IconButton>
            <IconButton title={t("module:enginev.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:enginev.workshopPath")} value={data.workshopPath ?? ""} disabled={running} onChange={(event) => patch({ workshopPath: event.currentTarget.value })} />
          <Field label={t("module:enginev.ids")} value={data.idsText ?? ""} disabled={running} placeholder="123,456" onChange={(event) => patch({ idsText: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:enginev.titleFilter")} value={data.titleFilter ?? ""} disabled={running} onChange={(event) => patch({ titleFilter: event.currentTarget.value })} />
          <Field label={t("module:enginev.rating")} value={data.ratingFilter ?? ""} disabled={running} placeholder="Everyone" onChange={(event) => patch({ ratingFilter: event.currentTarget.value })} />
          <Field label={t("module:enginev.type")} value={data.typeFilter ?? ""} disabled={running} placeholder="Video" onChange={(event) => patch({ typeFilter: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:enginev.renameTemplate")} value={data.template ?? "[#{id}]{original_name}+{title}"} disabled={running} onChange={(event) => patch({ template: event.currentTarget.value })} />
          <Field label={t("module:enginev.targetExportPath")} value={data.targetPath || data.outputPath || ""} disabled={running} onChange={(event) => patch({ targetPath: event.currentTarget.value, outputPath: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>{t("module:enginev.dryRun")}</SegmentButton>
          <SegmentButton active={data.copyMode ?? false} disabled={running} onClick={() => patch({ copyMode: !(data.copyMode ?? false) })}>{t("module:enginev.copyMode")}</SegmentButton>
          <ActionButton disabled={running || !selectedIds.length} onClick={() => execute("delete")}><Trash2 size={14} /> {t("module:enginev.delete")}</ActionButton>
          <ActionButton disabled={running || (!filtered.length && !wallpapers.length)} onClick={() => execute("export")}><Download size={14} /> {t("module:enginev.export")}</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:enginev.stats.total")} value={result?.totalCount ?? wallpapers.length} tone="accent" />
          <StatPill label={t("module:enginev.stats.filtered")} value={result?.filteredCount ?? filtered.length} tone="good" />
          <StatPill label={t("module:enginev.stats.types")} value={Object.keys(result?.typeStats ?? {}).length} />
          <StatPill label={t("module:enginev.stats.ok")} value={result?.successCount ?? 0} />
          <StatPill label={t("module:enginev.stats.failed")} value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {running ? (
            <div>{`[${data.progress ?? 0}%] ${data.progressText ?? ""}`}</div>
          ) : result?.renameResults.length ? (
            result.renameResults.slice(0, 60).map((item) => (
              <div key={`${item.workshopId}:${item.newPath}`} className="truncate">{item.status} {item.oldName} -&gt; {item.newName}</div>
            ))
          ) : result?.deleteResults.length ? (
            result.deleteResults.slice(0, 60).map((item) => (
              <div key={`${item.workshopId}:${item.status}`} className="truncate">{item.status} {item.workshopId} {item.message}</div>
            ))
          ) : filtered.length ? (
            filtered.slice(0, 80).map((item) => <WallpaperRow key={item.workshopId} item={item} host={host} />)
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><Image size={16} className="mr-1" /> {t("module:enginev.readyToScan")}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: EngineVAction, data: EngineVCardState, forceWrite: boolean): EngineVInput {
  return {
    action,
    path: data.workshopPath,
    wallpapers: action === "scan" ? undefined : data.wallpapers,
    filters: {
      title: data.titleFilter,
      contentRating: data.ratingFilter,
      type: data.typeFilter,
    },
    ids: data.idsText,
    template: data.template,
    dryRun: forceWrite ? false : data.dryRun ?? true,
    copyMode: data.copyMode ?? false,
    targetPath: data.targetPath,
    exportPath: data.outputPath || data.targetPath,
    exportFormat: "json",
  }
}

function parseIds(value = ""): string[] {
  return value.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean)
}

function WallpaperRow({ item, host }: { item: EngineVWallpaper; host: NodeComponentProps["host"] }) {
  const previewPath = resolvePreviewPath(item)
  const previewUrl = previewPath
    ? isRemoteUrl(previewPath) ? previewPath : host.localFiles?.getUrl?.(previewPath)
    : undefined
  const title = item.title || item.folderName

  return (
    <div className="flex min-w-0 gap-2 border-b border-border/40 py-1.5 last:border-b-0">
      <div className="h-14 w-24 shrink-0 overflow-hidden rounded border border-border/60 bg-muted/40">
        {previewUrl ? (
          <img
            data-enginev-preview="true"
            src={previewUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Image size={14} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{title}</div>
        <div className="truncate text-muted-foreground">{item.workshopId} / {item.wallpaperType || "unknown"} / {item.contentRating || "unrated"}</div>
        <div className="truncate text-muted-foreground/80">{item.path}</div>
      </div>
    </div>
  )
}

function resolvePreviewPath(item: EngineVWallpaper): string {
  const preview = item.preview.trim()
  if (!preview) return ""
  if (isRemoteUrl(preview)) return preview
  if (/^[A-Za-z]:[\\/]/.test(preview) || preview.startsWith("/") || preview.startsWith("\\\\")) return preview
  const separator = item.path.includes("\\") ? "\\" : "/"
  return `${item.path.replace(/[\\/]+$/, "")}${separator}${preview.replace(/^[\\/]+/, "")}`
}

function isRemoteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}
