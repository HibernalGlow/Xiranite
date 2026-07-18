/**
 * @migrated-from src/lib/components/panels/ViewSettingsPanel.svelte
 * @source-hash sha256:c8ab80f12c0fe4b677cb4f25f8cdf1f6733fc8d40a04ac160e37a9cc1d3dfeca
 * @features settings-import-export-backup,panels-toolbar-shell
 * @migration-status adapted
 */
import { Columns2, Eye, Square } from "lucide-react"
import { useState } from "react"
import type { ReaderFitMode } from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import type { ReaderRuntimeConfigDto, ReaderViewDefaultsPatch } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"

const FIT_MODES: Array<{ value: ReaderFitMode; label: string }> = [
  { value: "fit", label: "适应窗口" },
  { value: "fill", label: "填满窗口" },
  { value: "fit-width", label: "适应宽度" },
  { value: "fit-height", label: "适应高度" },
  { value: "original", label: "原始大小" },
]

export function ViewDefaultsSettingsCard({
  viewDefaults,
  onChange,
}: {
  viewDefaults: ReaderRuntimeConfigDto["viewDefaults"]
  onChange(patch: ReaderViewDefaultsPatch["viewDefaults"]): Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function commit(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onChange(patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-4" data-neoview-settings-card="view-defaults">
      <header className="flex items-center gap-2 border-b pb-3">
        <Eye className="size-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">视图默认值</h2>
      </header>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="neoview-default-fit-mode">默认缩放模式</label>
        <select
          id="neoview-default-fit-mode"
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={saving}
          value={viewDefaults.fitMode}
          onChange={(event) => void commit({ fitMode: event.currentTarget.value as ReaderFitMode })}
        >
          {FIT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
      <div className="grid gap-2">
        <span className="text-sm font-medium">默认页面模式</span>
        <div className="flex w-fit items-center rounded-md border border-border bg-muted/45 p-0.5" aria-label="默认页面模式">
          <Button
            type="button"
            size="sm"
            variant={viewDefaults.pageMode === "single" ? "default" : "ghost"}
            aria-pressed={viewDefaults.pageMode === "single"}
            disabled={saving}
            onClick={() => void commit({ pageMode: "single" })}
          ><Square />单页</Button>
          <Button
            type="button"
            size="sm"
            variant={viewDefaults.pageMode === "double" ? "default" : "ghost"}
            aria-pressed={viewDefaults.pageMode === "double"}
            disabled={saving}
            onClick={() => void commit({ pageMode: "double" })}
          ><Columns2 />双页</Button>
        </div>
      </div>
    </section>
  )
}

export default function DockedViewDefaultsSettingsCard({ viewDefaults, onViewDefaults }: ReaderPanelContext) {
  if (!viewDefaults || !onViewDefaults) return null
  return <ViewDefaultsSettingsCard viewDefaults={viewDefaults} onChange={onViewDefaults} />
}

export function SettingsViewDefaultsCard({ viewDefaults, onViewDefaults }: ReaderSettingsCardContext) {
  if (!viewDefaults || !onViewDefaults) return null
  return <ViewDefaultsSettingsCard viewDefaults={viewDefaults} onChange={onViewDefaults} />
}
