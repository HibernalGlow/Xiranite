/**
 * Legacy NeoView settings import / inspect surface for the Data section.
 */
import { CheckCircle2, Database, FileUp } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { ReaderSettingsMigrationImportResult, ReaderSettingsMigrationInspection } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"

export function DataMigrationSettingsCard({
  onLegacySettingsInspect,
  onLegacySettingsImport,
}: {
  onLegacySettingsInspect(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection>
  onLegacySettingsImport(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult>
}) {
  const [content, setContent] = useState("")
  const [strategy, setStrategy] = useState<"merge" | "overwrite">("merge")
  const [inspection, setInspection] = useState<ReaderSettingsMigrationInspection>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<ReaderSettingsMigrationImportResult>()

  async function inspect() {
    if (!content.trim() || busy) return
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      setInspection(await onLegacySettingsInspect(content))
    } catch (cause) {
      setInspection(undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!inspection || busy) return
    setBusy(true)
    setError(undefined)
    try {
      setResult(await onLegacySettingsImport(content, strategy))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCardShell
      id="data-migration-settings"
      title="数据迁移"
      description="检查并导入旧版 NeoView 导出的设置 JSON。只写入 XR 已识别的模块，不会伪造未迁移能力。"
      icon={Database}
    >
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-sm">设置 JSON</span>
        <Textarea
          value={content}
          onChange={(event) => {
            setContent(event.currentTarget.value)
            setInspection(undefined)
            setResult(undefined)
          }}
          placeholder='{"keybindings": [...], "view": {...}}'
          aria-label="旧设置 JSON"
          className="min-h-28 font-mono text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted">
          <FileUp className="size-3.5" />
          选择 JSON
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0]
              if (!file) return
              setContent(await file.text())
              setInspection(undefined)
              setResult(undefined)
              event.currentTarget.value = ""
            }}
          />
        </label>
        <Button type="button" variant="outline" size="sm" disabled={busy || !content.trim()} onClick={() => void inspect()}>检查</Button>
        <select
          className="h-8 rounded border border-input bg-background px-2 text-xs"
          value={strategy}
          disabled={busy}
          onChange={(event) => setStrategy(event.currentTarget.value as typeof strategy)}
          aria-label="导入策略"
        >
          <option value="merge">合并</option>
          <option value="overwrite">覆盖</option>
        </select>
        <Button type="button" size="sm" disabled={busy || !inspection} onClick={() => void commit()}>
          <CheckCircle2 />
          导入
        </Button>
      </div>
      {inspection ? (
        <div role="status" className="grid gap-1 rounded-md bg-muted/35 p-3 text-xs">
          <strong>{inspection.report.fullyRecognized ? "已识别旧设置" : "旧设置需要复查"}</strong>
          <span>{Object.entries(inspection.report.summary).map(([key, count]) => `${key}: ${count}`).join(" | ") || "无条目"}</span>
          <span>{inspection.report.entries.length} 条报告项</span>
        </div>
      ) : null}
      {result ? <p role="status" className="text-xs text-emerald-600">导入成功（{result.strategy}）；运行时配置已刷新。</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </SettingsCardShell>
  )
}

export function SettingsDataMigrationCard({ onLegacySettingsInspect, onLegacySettingsImport }: ReaderSettingsCardContext) {
  if (!onLegacySettingsInspect || !onLegacySettingsImport) return null
  return <DataMigrationSettingsCard onLegacySettingsInspect={onLegacySettingsInspect} onLegacySettingsImport={onLegacySettingsImport} />
}

export default function DockedDataMigrationSettingsCard({ onLegacySettingsInspect, onLegacySettingsImport }: ReaderPanelContext) {
  if (!onLegacySettingsInspect || !onLegacySettingsImport) return null
  return <DataMigrationSettingsCard onLegacySettingsInspect={onLegacySettingsInspect} onLegacySettingsImport={onLegacySettingsImport} />
}
