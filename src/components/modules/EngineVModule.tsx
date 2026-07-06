import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useBackend } from "@/hooks/useBackend"
import { useComponentData } from "@/hooks/useComponentData"
import type { ModuleProps } from "@/components/modules/ModuleRenderer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FolderOpen, Play, Filter, Trash2, Download, Loader2 } from "lucide-react"
import type {
  WallpaperDTO,
  EngineVScanResult,
} from "@/backend/shared/types"

/**
 * 持久化到 comp.data 的状态结构。
 * 切换 viewMode 时模块卸载，但 comp.data 一直在 store 中；
 * 切回来重新挂载时从这里恢复。
 */
interface EngineVState {
  workshopPath?: string
  result?: EngineVScanResult | null
  log?: string[]
  scanning?: boolean
}

/**
 * EngineVModule — 端到端示例。
 *
 * 验证：
 * 1. 三种 viewMode（cards / dockview / flow）下挂载同一个 EngineVModule 实例，
 *    访问同一份 backend.enginev —— 数据完全共享。
 * 2. 切换 viewMode 不丢失当前扫描结果（状态持久到 comp.data，不在 useState）。
 * 3. backend 在 web runtime 下走 mock 数据；切到 wails 时自动走真实文件系统。
 */
export default function EngineVModule({ compId }: ModuleProps) {
  const { t } = useTranslation()
  const { backend, ready } = useBackend()
  // 关键：状态持久到 store，切换 viewMode 时不丢
  const [data, setData] = useComponentData<EngineVState>(compId)

  // 仅 scanning 标志用 useState（瞬态 UI 状态，不需要跨 viewMode 持久）
  const [scanning, setScanning] = useState(false)

  const workshopPath = data.workshopPath ?? "/mock/workshop"
  const result = data.result ?? null
  const log = data.log ?? []

  function pushLog(msg: string) {
    setData({ log: [...log.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`] })
  }

  async function onScan() {
    if (!backend) return
    setScanning(true)
    pushLog(t("module:enginev.log.scan", { path: workshopPath }))
    const r = await backend.enginev.scan({ workshopPath })
    if (r.success && r.data) {
      setData({ result: r.data })
      pushLog(t("module:enginev.log.scannedOk", { count: r.data.totalCount }))
    } else {
      pushLog(t("module:enginev.log.fail", { message: `${r.message}${r.error ? ` — ${r.error}` : ""}` }))
    }
    setScanning(false)
  }

  async function onRenameAll() {
    if (!backend || !result) return
    setScanning(true)
    pushLog(t("module:enginev.log.renameStart", { count: result.wallpapers.length }))
    const r = await backend.enginev.rename(
      {
        wallpapers: result.wallpapers,
        template: "[#{id}]{original_name}+{title}",
        dryRun: true,
      },
      workshopPath,
    )
    if (r.success && r.data) {
      pushLog(t("module:enginev.log.renameOk", { success: r.data.successCount, failed: r.data.failedCount }))
    } else {
      pushLog(t("module:enginev.log.fail", { message: r.message }))
    }
    setScanning(false)
  }

  async function onExport() {
    if (!backend || !result) return
    const r = await backend.enginev.export({
      wallpapers: result.wallpapers,
      format: "json",
      exportPath: "/tmp/xiranite-export.json",
    })
    pushLog(r.success
      ? t("module:enginev.log.exportOk", { path: r.data?.path ?? "" })
      : t("module:enginev.log.fail", { message: r.message }))
  }

  function onClear() {
    setData({ result: null, log: [] })
  }

  if (!ready) {
    return <div className="p-4 text-xs font-mono text-muted-foreground">{t("module:enginev.backendLoading")}</div>
  }
  if (!backend) {
    return <div className="p-4 text-xs font-mono text-destructive">{t("module:enginev.backendFailed")}</div>
  }

  return (
    <div className="h-full flex flex-col gap-3 p-3 text-xs font-mono overflow-hidden">
      {/* ── Path ── */}
      <div className="flex items-center gap-2">
        <FolderOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <Input
          value={workshopPath}
          onChange={e => setData({ workshopPath: e.target.value })}
          className="h-7 text-xs font-mono"
          placeholder={t("module:enginev.pathPlaceholder")}
        />
        <Button size="sm" onClick={onScan} disabled={scanning} className="h-7 text-xs">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {t("module:enginev.scan")}
        </Button>
      </div>

      {/* ── Stats ── */}
      {result && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("module:enginev.stats.total")} value={result.totalCount} />
          <Stat label={t("module:enginev.stats.types")} value={Object.keys(result.typeStats).length} />
          <Stat label={t("module:enginev.stats.ratings")} value={Object.keys(result.ratingStats).length} />
        </div>
      )}

      {/* ── Actions ── */}
      {result && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" onClick={onRenameAll} disabled={scanning} className="h-7 text-xs">
            <Filter className="h-3 w-3" /> {t("module:enginev.renameDry")}
          </Button>
          <Button size="sm" variant="outline" onClick={onExport} className="h-7 text-xs">
            <Download className="h-3 w-3" /> {t("module:enginev.export")}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear} className="h-7 text-xs">
            <Trash2 className="h-3 w-3" /> {t("module:enginev.clear")}
          </Button>
        </div>
      )}

      {/* ── Wallpaper list ── */}
      {result && (
        <div className="flex-1 overflow-auto border border-border rounded-md">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="p-1.5 font-medium">{t("module:enginev.tableHeaders.id")}</th>
                <th className="p-1.5 font-medium">{t("module:enginev.tableHeaders.title")}</th>
                <th className="p-1.5 font-medium">{t("module:enginev.tableHeaders.type")}</th>
                <th className="p-1.5 font-medium text-right">{t("module:enginev.tableHeaders.size")}</th>
              </tr>
            </thead>
            <tbody>
              {result.wallpapers.map((w: WallpaperDTO) => (
                <tr key={w.workshopId} className="border-t border-border/40 hover:bg-muted/30">
                  <td className="p-1.5">{w.workshopId}</td>
                  <td className="p-1.5 truncate max-w-[200px]">{w.title}</td>
                  <td className="p-1.5"><span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded">{w.type}</span></td>
                  <td className="p-1.5 text-right text-muted-foreground">{(w.sizeBytes / 1_000_000).toFixed(1)}M</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Log ── */}
      {log.length > 0 && (
        <div className="h-24 overflow-auto border border-border rounded-md bg-muted/30 p-2">
          {log.map((line, i) => (
            <div key={i} className="text-[10px] text-muted-foreground">{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-md p-2">
      <div className="text-[9px] text-muted-foreground tracking-widest">{label}</div>
      <div className="text-base font-semibold text-primary">{value}</div>
    </div>
  )
}
