/**
 * @migrated-from src/lib/cards/properties/EmmConfigCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmConfigCard.tsx
 * @migration-status adapted
 */
import { Database, PlugZap, RotateCcw, Save } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ReaderEmmConfigDto, ReaderEmmConnectionProbeDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

const DEFAULT_EMM_CONFIG: ReaderEmmConfigDto = { enabled: true, databasePaths: [], defaultRating: 4.2 }
const PROBE_STATUS_LABELS: Record<ReaderEmmConnectionProbeDto["sources"][number]["status"], string> = {
  compatible: "兼容",
  missing: "不存在",
  incompatible: "不兼容",
  unreadable: "无法读取",
}

export default function EmmConfigCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState />
  return <EmmConfigContent {...props} />
}

function EmmConfigContent({ client, disabled }: ReaderPanelContext) {
  const [value, setValue] = useState<ReaderEmmConfigDto>(DEFAULT_EMM_CONFIG)
  const [databasePaths, setDatabasePaths] = useState("")
  const [settingPath, setSettingPath] = useState("")
  const [translationDatabasePath, setTranslationDatabasePath] = useState("")
  const [translationPath, setTranslationPath] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ReaderEmmConnectionProbeDto>()
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void client.config(controller.signal).then((runtime) => {
      if (controller.signal.aborted) return
      apply(runtime.emm ?? DEFAULT_EMM_CONFIG)
      setError(undefined)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [client])

  function apply(next: ReaderEmmConfigDto) {
    setValue(next)
    setDatabasePaths(next.databasePaths.join("\n"))
    setSettingPath(next.settingPath ?? "")
    setTranslationDatabasePath(next.translationDatabasePath ?? "")
    setTranslationPath(next.translationPath ?? "")
  }

  async function save(next: ReaderEmmConfigDto) {
    if (!client.updateEmm) {
      setError("当前 Reader 后端不支持 EMM 配置写入。")
      return
    }
    setSaving(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const updated = await client.updateEmm({ emm: next })
      apply(updated)
      setProbe(undefined)
      setMessage("已保存并立即切换当前 Reader 的只读 EMM 数据源。")
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  function draft(): ReaderEmmConfigDto {
    return {
      enabled: value.enabled,
      databasePaths: uniquePaths(databasePaths),
      settingPath: settingPath.trim() || undefined,
      translationDatabasePath: translationDatabasePath.trim() || undefined,
      translationPath: translationPath.trim() || undefined,
      defaultRating: value.defaultRating,
    }
  }

  async function testConnection() {
    if (!client.probeEmm) {
      setError("当前 Reader 后端不支持 EMM 连接测试。")
      return
    }
    setProbing(true)
    setError(undefined)
    setMessage(undefined)
    try {
      setProbe(await client.probeEmm({ emm: draft() }))
    } catch (cause) {
      setProbe(undefined)
      setError(errorMessage(cause))
    } finally {
      setProbing(false)
    }
  }

  if (loading) return <div className="h-44 animate-pulse rounded bg-muted" aria-label="正在加载 EMM 配置" />
  const locked = disabled || saving || probing
  return (
    <div className="grid gap-3 text-[11px]" data-emm-config-card="true" aria-busy={saving}>
      <div className="flex items-start gap-2 rounded border bg-muted/30 p-2.5">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="font-medium">外部 EMM 数据源</p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">留空时自动使用 %APPDATA%/exhentai-manga-manager；外部数据库始终只读。</p>
        </div>
        <Switch className="ml-auto" size="sm" aria-label="启用外部 EMM" checked={value.enabled} disabled={locked} onCheckedChange={(enabled) => setValue((current) => ({ ...current, enabled }))} />
      </div>

      <label className="grid gap-1">
        <span className="font-medium">数据库路径</span>
        <textarea
          className="min-h-16 resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="EMM 数据库路径"
          placeholder="每行一个 database.sqlite 路径；留空为自动发现"
          value={databasePaths}
          disabled={locked}
          onChange={(event) => setDatabasePaths(event.currentTarget.value)}
        />
      </label>
      <PathInput label="setting.json 路径" value={settingPath} disabled={locked} onChange={setSettingPath} />
      <PathInput label="translations.db 路径" value={translationDatabasePath} disabled={locked} onChange={setTranslationDatabasePath} />
      <PathInput label="标签翻译字典路径" value={translationPath} disabled={locked} onChange={setTranslationPath} />
      <label className="grid gap-1">
        <span className="font-medium">默认评分</span>
        <Input className="h-7 font-mono text-[10px]" type="number" min={0} max={5} step={0.1} aria-label="默认评分" value={value.defaultRating} disabled={locked} onChange={(event) => setValue((current) => ({ ...current, defaultRating: Number(event.currentTarget.value) }))} />
      </label>

      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" className="h-7 text-[10px]" disabled={locked} onClick={() => void save(draft())}><Save data-icon="inline-start" />{saving ? "保存中…" : "保存"}</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={locked} onClick={() => void testConnection()}><PlugZap data-icon="inline-start" />{probing ? "测试中…" : "测试连接"}</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={locked} onClick={() => void save(DEFAULT_EMM_CONFIG)}><RotateCcw data-icon="inline-start" />恢复自动发现</Button>
      </div>
      {probe ? <ConnectionProbeResult value={probe} /> : null}
      {message ? <p role="status" className="text-[10px] text-muted-foreground">{message}</p> : null}
      {error ? <p role="alert" className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  )
}

function ConnectionProbeResult({ value }: { value: ReaderEmmConnectionProbeDto }) {
  return <div className="grid gap-1 rounded border bg-muted/20 p-2" role="status">
    <p className="font-medium">{value.connected ? "连接可用，保存后立即切换" : value.enabled ? "未找到可用数据源" : "数据源已禁用"}</p>
    <p className="text-[10px] text-muted-foreground">{value.automatic ? "自动发现" : "手动路径"} · 只读</p>
    {value.sources.map((source) => <div key={source.path} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[10px]">
      <span className="truncate font-mono" title={source.path}>{source.path}</span>
      <span>{PROBE_STATUS_LABELS[source.status]}</span>
      {source.error ? <span className="col-span-2 text-destructive">{source.error}</span> : null}
    </div>)}
  </div>
}

function PathInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange(value: string): void }) {
  return <label className="grid gap-1"><span className="font-medium">{label}</span><Input className="h-7 font-mono text-[10px]" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} /></label>
}

function uniquePaths(value: string): string[] {
  const paths = value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = path.replaceAll("\\", "/").toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
