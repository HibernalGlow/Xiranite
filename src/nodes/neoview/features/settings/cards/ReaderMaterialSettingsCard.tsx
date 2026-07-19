import { Droplets, Layers3, RotateCcw, Sparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ReaderShellConfigDto, ReaderShellMaterialPatch, ReaderShellSurface } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import {
  applyReaderShellMaterialPreview,
  readerShellMaterialDraft,
  readerShellMaterialPatch,
  READER_SHELL_MATERIAL_PRESETS,
  READER_SHELL_SURFACES,
  type ReaderShellMaterialDraft,
} from "../../material/ReaderShellMaterial"
import { SettingsCardShell } from "../SettingsCardShell"

const SURFACE_LABELS: Record<ReaderShellSurface, string> = { top: "顶栏", bottom: "底栏", sidebar: "侧栏" }
const PRESET_LABELS = { solid: "实色", soft: "轻透", frosted: "磨砂" } as const
const CONTROLS = [
  { key: "opacity", label: "不透明度", min: 0, max: 100, unit: "%" },
  { key: "blur", label: "背景模糊", min: 0, max: 20, unit: "px" },
  { key: "saturation", label: "色彩饱和度", min: 50, max: 180, unit: "%" },
  { key: "highlight", label: "边缘高光", min: 0, max: 100, unit: "%" },
  { key: "shadow", label: "阴影强度", min: 0, max: 100, unit: "%" },
] as const

type MaterialControl = typeof CONTROLS[number]["key"]

export function ReaderMaterialSettingsCard({ shell, onMaterial }: {
  shell: ReaderShellConfigDto
  onMaterial(patch: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto>
}) {
  const initial = readerShellMaterialDraft(shell)
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(initial)
  const confirmedRef = useRef(initial)
  const [surface, setSurface] = useState<ReaderShellSurface>("top")
  const [linked, setLinked] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const next = readerShellMaterialDraft(shell)
    confirmedRef.current = next
    draftRef.current = next
    setDraft(next)
    applyReaderShellMaterialPreview(next)
  }, [shell])

  useEffect(() => () => applyReaderShellMaterialPreview(confirmedRef.current), [])

  function preview(control: MaterialControl, value: number) {
    const surfaces = linked ? READER_SHELL_SURFACES : [surface]
    const next: ReaderShellMaterialDraft = {
      ...draftRef.current,
      preset: "custom",
      [control]: {
        ...draftRef.current[control],
        ...Object.fromEntries(surfaces.map((target) => [target, value])),
      },
    }
    draftRef.current = next
    setDraft(next)
    setError(undefined)
    applyReaderShellMaterialPreview(next)
  }

  async function persist(next = draftRef.current) {
    if (saving || sameMaterial(next, confirmedRef.current)) return
    setSaving(true)
    setError(undefined)
    try {
      const updated = await onMaterial(readerShellMaterialPatch(next))
      const confirmed = readerShellMaterialDraft(updated)
      confirmedRef.current = confirmed
      draftRef.current = confirmed
      setDraft(confirmed)
      applyReaderShellMaterialPreview(confirmed)
    } catch (cause) {
      const confirmed = confirmedRef.current
      draftRef.current = confirmed
      setDraft(confirmed)
      applyReaderShellMaterialPreview(confirmed)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function rollbackPreview() {
    const confirmed = confirmedRef.current
    draftRef.current = confirmed
    setDraft(confirmed)
    applyReaderShellMaterialPreview(confirmed)
  }

  function selectPreset(preset: keyof typeof READER_SHELL_MATERIAL_PRESETS) {
    const next = cloneMaterial(READER_SHELL_MATERIAL_PRESETS[preset])
    draftRef.current = next
    setDraft(next)
    setError(undefined)
    applyReaderShellMaterialPreview(next)
    void persist(next)
  }

  function selectCustom() {
    const next = { ...cloneMaterial(draftRef.current), preset: "custom" as const }
    draftRef.current = next
    setDraft(next)
    setError(undefined)
    applyReaderShellMaterialPreview(next)
    void persist(next)
  }

  return (
    <SettingsCardShell
      id="reader-material"
      title="界面材质"
      description="颜色继续继承项目主题，仅调整 NeoView 边栏的透明和磨砂质感。"
      icon={Sparkles}
    >
      <div className="grid gap-2">
        <span className="text-xs font-medium">材质预设</span>
        <div className="flex flex-wrap gap-1 rounded-md border bg-muted/15 p-1" aria-label="材质预设">
          {(Object.keys(READER_SHELL_MATERIAL_PRESETS) as Array<keyof typeof READER_SHELL_MATERIAL_PRESETS>).map((preset) => (
            <Button key={preset} type="button" size="sm" variant={draft.preset === preset ? "default" : "ghost"} aria-pressed={draft.preset === preset} disabled={saving} onClick={() => selectPreset(preset)}>{PRESET_LABELS[preset]}</Button>
          ))}
          <Button type="button" size="sm" variant={draft.preset === "custom" ? "default" : "ghost"} aria-pressed={draft.preset === "custom"} disabled={saving} onClick={selectCustom}>自定义</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border bg-muted/15 p-1" aria-label="材质表面">
          {READER_SHELL_SURFACES.map((item) => <Button key={item} type="button" size="sm" variant={surface === item ? "secondary" : "ghost"} aria-pressed={surface === item} onClick={() => setSurface(item)}>{SURFACE_LABELS[item]}</Button>)}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={linked} onChange={(event) => setLinked(event.currentTarget.checked)} />联动三处
        </label>
      </div>

      <div className="grid gap-4 rounded-md border bg-card/45 p-4">
        {CONTROLS.map((control) => {
          const value = draft[control.key][surface]
          return (
            <label key={control.key} className="grid gap-2" data-material-control={control.key}>
              <span className="flex items-center justify-between gap-3 text-xs"><span>{control.label}</span><output className="tabular-nums text-muted-foreground">{value}{control.unit}</output></span>
              <input
                type="range"
                aria-label={`${SURFACE_LABELS[surface]}${control.label}`}
                className={cn("h-2 w-full cursor-pointer accent-primary", saving && "cursor-wait")}
                min={control.min}
                max={control.max}
                step={1}
                value={value}
                disabled={saving}
                onChange={(event) => preview(control.key, Number(event.currentTarget.value))}
                onPointerUp={() => void persist()}
                onPointerCancel={rollbackPreview}
                onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) void persist() }}
                onBlur={() => void persist()}
              />
            </label>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{draft.blur[surface] > 0 ? <Droplets className="size-3.5" /> : <Layers3 className="size-3.5" />}{saving ? "正在保存..." : "拖动实时预览，释放后保存"}</div>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => selectPreset("frosted")}><RotateCcw />恢复磨砂默认值</Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">保存失败，已恢复上次设置：{error}</p> : null}
    </SettingsCardShell>
  )
}

export function SettingsReaderMaterialCard({ shell, onMaterial }: ReaderSettingsCardContext) {
  if (!onMaterial) return null
  return <ReaderMaterialSettingsCard shell={shell} onMaterial={onMaterial} />
}

function sameMaterial(left: ReaderShellMaterialDraft, right: ReaderShellMaterialDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function cloneMaterial(source: ReaderShellMaterialDraft): ReaderShellMaterialDraft {
  return {
    ...source,
    opacity: { ...source.opacity },
    blur: { ...source.blur },
    saturation: { ...source.saturation },
    highlight: { ...source.highlight },
    shadow: { ...source.shadow },
  }
}

export default function DockedReaderMaterialSettingsCard({ shell, onMaterial }: ReaderPanelContext) {
  if (!shell || !onMaterial) return null
  return <ReaderMaterialSettingsCard shell={shell} onMaterial={onMaterial} />
}
