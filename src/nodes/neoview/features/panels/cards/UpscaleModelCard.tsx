import { FolderOpen, Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ReaderPanelContext } from "../registry"
import { useSuperResolutionPreferences } from "./useSuperResolutionPreferences"

const SCALES = [1, 2, 3, 4]
const TILES = [128, 256, 512, 768, 1024]
const NOISE = [-1, 0, 1, 2, 3]

export default function UpscaleModelCard({ client, session, disabled, superResolution, onSuperResolutionConfigChange, pickDirectory }: ReaderPanelContext) {
  const { config, preferences, feedback, commit, commitConfig } = useSuperResolutionPreferences(client, superResolution, onSuperResolutionConfigChange)
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<NonNullable<typeof client.upscaleCapabilities>>>>()
  const [refreshing, setRefreshing] = useState(false)
  const [directory, setDirectory] = useState(superResolution?.modelsDirectory ?? "")

  useEffect(() => setDirectory(config?.modelsDirectory ?? ""), [config?.modelsDirectory])
  useEffect(() => {
    if (!client.upscaleCapabilities || !session) return
    const controller = new AbortController()
    void client.upscaleCapabilities(session.sessionId, false, controller.signal).then(setCapabilities).catch(() => undefined)
    return () => controller.abort()
  }, [client, session])

  const models = capabilities?.available ? capabilities.models : []
  const selectedModel = preferences?.defaultModelId ?? models[0]?.id ?? ""
  const tileEnabled = preferences?.defaultTileEnabled ?? true
  const saveDirectory = () => {
    const value = directory.trim()
    if (value) commitConfig({ modelsDirectory: value })
  }
  const chooseDirectory = async () => {
    const value = await pickDirectory?.()
    if (value) { setDirectory(value); commitConfig({ modelsDirectory: value }) }
  }
  const refresh = () => {
    if (!client.upscaleCapabilities || !session) return
    setRefreshing(true)
    void client.upscaleCapabilities(session.sessionId, true).then(setCapabilities).catch(() => undefined).finally(() => setRefreshing(false))
  }

  return <div className="space-y-3 text-xs" data-neoview-upscale-model="true">
    {config?.provider === "disabled" ? <div className="py-4 text-center text-muted-foreground"><p>超分功能不可用</p><p className="mt-1 text-[10px]">请启用 OpenComic 超分 provider</p></div> : <>
      <div className="space-y-1"><Label htmlFor="neoview-upscale-model">模型</Label><div className="flex gap-1"><select id="neoview-upscale-model" className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs" value={selectedModel} disabled={disabled || models.length === 0} onChange={(event) => commit({ defaultModelId: event.currentTarget.value })}>{models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>) : <option value="">等待模型能力</option>}</select><Button type="button" variant="outline" size="icon" className="size-7" title="刷新模型" aria-label="刷新模型" disabled={disabled || refreshing} onClick={refresh}>{refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button></div></div>
      <div className="space-y-1"><div className="flex items-center justify-between gap-2"><Label htmlFor="neoview-upscale-model-directory">MangaJaNai 模型目录</Label><Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setDirectory(config?.modelsDirectory ?? "")} disabled={disabled}>恢复</Button></div><div className="flex gap-1"><Input id="neoview-upscale-model-directory" className="h-7 min-w-0 text-[10px]" value={directory} disabled={disabled} onChange={(event) => setDirectory(event.currentTarget.value)} onBlur={saveDirectory} onKeyDown={(event) => { if (event.key === "Enter") saveDirectory() }} /><Button type="button" variant="outline" size="icon" className="size-7" title="选择目录" aria-label="选择目录" disabled={disabled} onClick={() => void chooseDirectory()}><FolderOpen className="size-3.5" /></Button></div><p className="text-[10px] text-muted-foreground">目录持久化后，重启 Reader/provider 才会重新加载模型。</p></div>
      <div className="grid grid-cols-2 gap-2"><Field label="放大倍率"><select className="h-6 w-full rounded border border-input bg-background px-2 text-xs" value={preferences?.defaultScale ?? 2} disabled={disabled} onChange={(event) => commit({ defaultScale: Number(event.currentTarget.value) })}>{SCALES.map((value) => <option key={value} value={value}>{value}x</option>)}</select></Field><Field label="Tile Size"><div className="flex items-center gap-1"><Switch checked={tileEnabled} disabled={disabled} onCheckedChange={(value) => commit({ defaultTileEnabled: value })} /><select className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs" value={preferences?.defaultTileSize ?? 512} disabled={disabled || !tileEnabled} onChange={(event) => commit({ defaultTileSize: Number(event.currentTarget.value) })}>{TILES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div></Field><Field label="降噪等级"><select className="h-6 w-full rounded border border-input bg-background px-2 text-xs" value={preferences?.defaultNoise ?? 0} disabled={disabled} onChange={(event) => commit({ defaultNoise: Number(event.currentTarget.value) })}>{NOISE.map((value) => <option key={value} value={value}>{value < 0 ? "自动" : value}</option>)}</select></Field><Field label="GPU"><Input className="h-6 text-xs" value={preferences?.defaultGpuId ?? "0"} disabled={disabled} onChange={(event) => commit({ defaultGpuId: event.currentTarget.value })} /></Field></div>
      <div className="border-t pt-2 text-[10px] text-muted-foreground">当前：{(models.find((model) => model.id === selectedModel)?.displayName ?? selectedModel) || "未选择模型"} @ {preferences?.defaultScale ?? 2}x</div>
    </>}
    {feedback ? <p className="rounded bg-destructive/10 p-2 text-[10px] text-destructive" role="alert">{feedback}</p> : null}
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1"><span className="block text-[10px] text-muted-foreground">{label}</span>{children}</label> }
