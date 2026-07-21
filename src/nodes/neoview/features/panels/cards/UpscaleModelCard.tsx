import { ChevronDown, ChevronUp, FolderOpen, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ReaderUpscaleEngineCapabilityDto, ReaderUpscaleModelDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { useSuperResolutionPreferences } from "./useSuperResolutionPreferences"

const TILES = [128, 256, 512, 768, 1024]

export default function UpscaleModelCard({ client, session, disabled, superResolution, onSuperResolutionConfigChange, pickDirectory }: ReaderPanelContext) {
  const { config, preferences, feedback, commit, commitConfig } = useSuperResolutionPreferences(client, superResolution, onSuperResolutionConfigChange)
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<NonNullable<typeof client.upscaleCapabilities>>>>()
  const [refreshing, setRefreshing] = useState(false)
  const [directory, setDirectory] = useState(superResolution?.modelsDirectory ?? "")
  const [sourceDraft, setSourceDraft] = useState("")
  const [showUninstalled, setShowUninstalled] = useState(false)
  const [managementOpen, setManagementOpen] = useState(false)

  useEffect(() => setDirectory(config?.modelsDirectory ?? ""), [config?.modelsDirectory])
  useEffect(() => {
    if (!client.upscaleCapabilities) return
    const controller = new AbortController()
    void client.upscaleCapabilities(session?.sessionId, false, controller.signal).then(setCapabilities).catch(() => undefined)
    return () => controller.abort()
  }, [client, session])

  const allModels = useMemo(() => capabilities?.available ? capabilities.models : [], [capabilities])
  const models = useMemo(() => showUninstalled ? allModels : allModels.filter((model) => model.installed !== false), [allModels, showUninstalled])
  const configuredModel = preferences?.defaultModelId
  const selectedModel = models.some((model) => model.id === configuredModel) ? configuredModel! : models[0]?.id ?? ""
  const selected = models.find((model) => model.id === selectedModel)
  const selectedEngine = capabilities?.available
    ? capabilities.engines.find((engine) => engine.engine === selected?.engine)
    : undefined
  const selectedEngineWarning = engineWarningText(selectedEngine)
  const selectedScale = preferences?.defaultScale ?? selected?.scales[0] ?? 2
  const scales = selected?.scales.length ? selected.scales : [1, 2, 3, 4]
  const noise = noiseOptions(selected, selectedScale)
  const selectedNoise = noise.includes(preferences?.defaultNoise ?? Number.NaN)
    ? preferences!.defaultNoise
    : noise[0] ?? 0
  const tileEnabled = preferences?.defaultTileEnabled ?? true
  const sources = config?.modelSources ?? []

  useEffect(() => {
    if (!models.length || models.some((model) => model.id === preferences?.defaultModelId)) return
    const model = models.find((candidate) => candidate.id === "realesr-animevideov3") ?? models[0]!
    commit({ defaultModelId: model.id, defaultScale: preferredScale(model) })
  }, [commit, models, preferences?.defaultModelId])

  const selectModel = (model: ReaderUpscaleModelDto) => {
    commit({
      defaultModelId: model.id,
      defaultScale: preferredScale(model),
      ...(model.noise?.length ? { defaultNoise: model.noise.includes(0) ? 0 : model.noise[0] } : {}),
    })
  }
  const saveDirectory = () => {
    const value = directory.trim()
    if (value) commitConfig({ modelsDirectory: value })
  }
  const chooseCacheDirectory = async () => {
    const value = await pickDirectory?.()
    if (value) { setDirectory(value); commitConfig({ modelsDirectory: value }) }
  }
  const addSource = (source = sourceDraft) => {
    const value = source.trim()
    if (!value || sources.includes(value)) return
    commitConfig({ modelSources: [...sources, value] })
    setSourceDraft("")
  }
  const chooseSource = async () => {
    const value = await pickDirectory?.()
    if (value) addSource(value)
  }
  const refresh = () => {
    if (!client.upscaleCapabilities) return
    setRefreshing(true)
    void client.upscaleCapabilities(session?.sessionId, true).then(setCapabilities).catch(() => undefined).finally(() => setRefreshing(false))
  }

  return <div className="space-y-3 text-xs" data-neoview-upscale-model="true">
    {config?.provider === "disabled" ? <div className="py-4 text-center text-muted-foreground"><p>超分功能不可用</p><p className="mt-1 text-[10px]">请启用 OpenComic 超分 provider</p></div> : <>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2"><Label htmlFor="neoview-upscale-model">默认模型</Label><Button type="button" variant="outline" size="icon" className="size-7" title="刷新模型" aria-label="刷新模型" disabled={disabled || refreshing} onClick={refresh}>{refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button></div>
        <select id="neoview-upscale-model" className="h-7 w-full rounded border border-input bg-background px-2 text-xs" value={selectedModel} disabled={disabled || models.length === 0} onChange={(event) => { const model = models.find((candidate) => candidate.id === event.currentTarget.value); if (model) selectModel(model) }}>
          {models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {scaleLabel(model.scales)} · {formatBytes(model.sizeBytes)}</option>) : <option value="">未发现已安装模型</option>}
        </select>
        {capabilities && !capabilities.available ? <p className="text-[10px] text-destructive">模型探测失败：{capabilities.reason}</p> : null}
        {selectedEngine && !selectedEngine.available ? <p className="text-[10px] text-destructive" role="alert">超分引擎不可用：{selectedEngine.reason ?? "未找到可用的执行程序"}</p> : null}
        {selectedEngineWarning ? <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-300" role="alert">性能降级：{selectedEngineWarning}</p> : null}
      </div>

      {models.length ? <div className="max-h-44 overflow-y-auto rounded border border-border" aria-label="模型目录">
        {models.map((model) => <button key={model.id} type="button" className={`block w-full border-b border-border px-2 py-1.5 text-left last:border-b-0 hover:bg-muted/60 ${model.id === selectedModel ? "bg-muted" : ""}`} onClick={() => selectModel(model)} disabled={disabled}>
          <span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium" title={model.displayName}>{model.displayName}</span><span className={model.installed ? "shrink-0 text-emerald-600" : "shrink-0 text-muted-foreground"}>{model.installed ? "已安装" : "可下载"}</span></span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">{model.family ?? model.engine} / {categoryLabel(model.category)} / {model.engine}</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">倍率 {scaleLabel(model.scales)} · 降噪 {noiseLabel(model)} · {formatBytes(model.sizeBytes)}</span>
          {model.sourceDirectories?.length ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={model.sourceDirectories.join("\n")}>来源 {model.sourceDirectories.join("；")}</span> : null}
        </button>)}
      </div> : null}

      <Collapsible open={managementOpen} onOpenChange={setManagementOpen} className="border-t border-border pt-2">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-between px-2 text-xs" aria-label={managementOpen ? "收起模型管理" : "展开模型管理"}>{managementOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}<span className="flex-1 text-left">模型管理</span><span className="text-[10px] text-muted-foreground">{allModels.length - models.length} 个未下载</span></Button></CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {allModels.some((model) => model.installed === false) || showUninstalled ? <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>显示未下载模型</span><Switch checked={showUninstalled} disabled={disabled} aria-label="显示未下载模型" onCheckedChange={setShowUninstalled} /></label> : null}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="neoview-upscale-model-source">模型来源目录</Label><Button type="button" variant="outline" size="icon" className="size-7" title="选择模型来源目录" aria-label="选择模型来源目录" disabled={disabled} onClick={() => void chooseSource()}><FolderOpen className="size-3.5" /></Button></div>
            <div className="flex gap-1"><Input id="neoview-upscale-model-source" className="h-7 min-w-0 text-[10px]" value={sourceDraft} placeholder="添加包含 models 的目录" disabled={disabled} onChange={(event) => setSourceDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") addSource() }} /><Button type="button" variant="outline" size="icon" className="size-7" title="添加来源" aria-label="添加来源" disabled={disabled || !sourceDraft.trim()} onClick={() => addSource()}><Plus className="size-3.5" /></Button></div>
            {sources.map((source) => <div key={source} className="flex h-7 items-center gap-1 border-t border-border px-1"><span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={source}>{source}</span><Button type="button" variant="ghost" size="icon" className="size-6" title="移除来源" aria-label={`移除模型来源 ${source}`} disabled={disabled} onClick={() => commitConfig({ modelSources: sources.filter((candidate) => candidate !== source) })}><Trash2 className="size-3.5" /></Button></div>)}
          </div>
          <div className="space-y-1"><div className="flex items-center justify-between gap-2"><Label htmlFor="neoview-upscale-model-directory">聚合缓存目录</Label><Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setDirectory(config?.modelsDirectory ?? "")} disabled={disabled}>恢复</Button></div><div className="flex gap-1"><Input id="neoview-upscale-model-directory" className="h-7 min-w-0 text-[10px]" value={directory} disabled={disabled} onChange={(event) => setDirectory(event.currentTarget.value)} onBlur={saveDirectory} onKeyDown={(event) => { if (event.key === "Enter") saveDirectory() }} /><Button type="button" variant="outline" size="icon" className="size-7" title="选择聚合缓存目录" aria-label="选择聚合缓存目录" disabled={disabled} onClick={() => void chooseCacheDirectory()}><FolderOpen className="size-3.5" /></Button></div><p className="text-[10px] text-muted-foreground">来源目录保持原位；此目录只保存模型链接或可重建副本。</p></div>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid grid-cols-2 gap-2"><Field label="放大倍率"><select className="h-6 w-full rounded border border-input bg-background px-2 text-xs" value={selectedScale} disabled={disabled} onChange={(event) => commit({ defaultScale: Number(event.currentTarget.value) })}>{scales.map((value) => <option key={value} value={value}>{value}x</option>)}</select></Field><Field label="Tile Size"><div className="flex items-center gap-1"><Switch checked={tileEnabled} disabled={disabled} onCheckedChange={(value) => commit({ defaultTileEnabled: value })} /><select className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs" value={preferences?.defaultTileSize ?? 512} disabled={disabled || !tileEnabled} onChange={(event) => commit({ defaultTileSize: Number(event.currentTarget.value) })}>{TILES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div></Field><Field label="降噪等级"><select className="h-6 w-full rounded border border-input bg-background px-2 text-xs" value={selectedNoise} disabled={disabled || noise.length === 0} onChange={(event) => commit({ defaultNoise: Number(event.currentTarget.value) })}>{noise.length ? noise.map((value) => <option key={value} value={value}>{value === -1 ? "保守" : value}</option>) : <option value={0}>模型固定</option>}</select></Field><Field label="GPU"><Input className="h-6 text-xs" value={preferences?.defaultGpuId ?? "0"} disabled={disabled} onChange={(event) => commit({ defaultGpuId: event.currentTarget.value })} /></Field></div>
    </>}
    {feedback ? <p className="rounded bg-destructive/10 p-2 text-[10px] text-destructive" role="alert">{feedback}</p> : null}
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1"><span className="block text-[10px] text-muted-foreground">{label}</span>{children}</label> }
function preferredScale(model: ReaderUpscaleModelDto): number { return model.scales.includes(2) ? 2 : model.scales[0] ?? 2 }
function noiseOptions(model: ReaderUpscaleModelDto | undefined, scale: number): readonly number[] { return model?.noiseByScale?.[scale] ?? model?.noise ?? [] }
function scaleLabel(scales: readonly number[]): string { return scales.map((scale) => `${scale}x`).join("/") }
function noiseLabel(model: ReaderUpscaleModelDto): string { const levels = model.noise ?? []; return levels.length ? levels.map((value) => value === -1 ? "保守" : value).join("/") : "固定" }
function formatBytes(bytes?: number): string { if (bytes === undefined) return "未下载"; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`; return `${(bytes / 1024 / 1024).toFixed(1)} MiB` }
function categoryLabel(category?: string): string { return ({ anime: "动漫", "anime-pro": "动漫 Pro", photo: "照片", general: "通用", descreen: "去网纹", "artifact-removal": "去伪影" } as Record<string, string>)[category ?? ""] ?? category ?? "未分类" }
function engineWarningText(capability: ReaderUpscaleEngineCapabilityDto | undefined): string | undefined {
  if (!capability?.warning) return undefined
  if (capability.engine === "upscayl" && capability.performanceMode === "process-per-page" && capability.managed === false) {
    return "未检测到 Xiranite 托管的 Upscayl daemon，当前使用外部兼容模式；每页都会重启进程并重新加载模型，速度会明显变慢。"
  }
  if (capability.engine === "upscayl" && capability.daemonSupported && capability.managed === false) {
    return "未检测到 Xiranite 托管的 Upscayl daemon，当前使用外部 daemon 执行程序。"
  }
  return capability.warning
}
