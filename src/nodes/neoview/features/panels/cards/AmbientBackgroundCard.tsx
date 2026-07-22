/**
 * @migrated-from src/lib/cards/info/AmbientBackgroundCard.svelte
 * @source-hash sha256:e7ed31ea4c7feca500574dcfb3f1c82d3f6cd41fecb1845fb1da4bf014fe106c
 * @migration-status adapted
 */
import { Blend, Flashlight, Image, Paintbrush, RotateCcw, Sparkles, Waves } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { ReaderBackgroundConfigDto, ReaderBackgroundPatchDto } from "../../../adapters/reader-http-client"
import { SettingsCardShell } from "../../settings/SettingsCardShell"
import type { ReaderPanelContext } from "../registry"
import "./AmbientBackgroundCard.css"

const MODES = [
  { value: "solid", label: "固定颜色", description: "使用设置的背景颜色", icon: Paintbrush },
  { value: "auto", label: "自动匹配", description: "从当前图片提取主色调", icon: Image },
  { value: "edge", label: "边缘匹配", description: "从页面四边采样，生成可贴边变化的无缝背景", icon: Blend },
  { value: "ambient", label: "流光溢彩", description: "从当前图片生成流动渐变", icon: Sparkles },
  { value: "aurora", label: "极光", description: "缓慢波动的极光效果", icon: Waves },
  { value: "spotlight", label: "聚光灯", description: "舞台聚光灯效果", icon: Flashlight },
] as const

const STYLES = [
  { value: "gentle", label: "柔和" },
  { value: "vibrant", label: "鲜艳" },
  { value: "dynamic", label: "动感" },
] as const

const SPOTLIGHT_COLORS = ["white", "#3b82f6", "#8b5cf6", "#ec4899", "#22c55e", "#f97316"] as const

const DEFAULT_BACKGROUND: ReaderBackgroundConfigDto = {
  color: "#000000",
  mode: "solid",
  ambient: { style: "vibrant", speed: 8, blur: 80, opacity: 0.8 },
  aurora: { showRadialGradient: true },
  spotlight: { color: "white" },
}

export function AmbientBackgroundCard({
  background,
  onChange,
}: {
  background: ReaderBackgroundConfigDto
  onChange(patch: ReaderBackgroundPatchDto): Promise<void>
}) {
  const [draft, setDraft] = useState(background)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setDraft(background), [background])

  async function commit(patch: ReaderBackgroundPatchDto) {
    const previous = draft
    setDraft(mergeBackground(draft, patch))
    setSaving(true)
    setError(undefined)
    try {
      await onChange(patch)
    } catch (cause) {
      setDraft(previous)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const selected = MODES.find((mode) => mode.value === draft.mode) ?? MODES[0]
  const effectEnabled = draft.mode === "ambient" || draft.mode === "aurora" || draft.mode === "spotlight"

  return <SettingsCardShell
    id="ambient-background"
    title="动态背景"
    description="配置阅读画布底层效果；自动取色仅在当前页面变化时运行。"
    icon={Sparkles}
    actions={<Button aria-label="重置设置" title="重置设置" size="icon-sm" variant="ghost" disabled={saving} onClick={() => void commit({ mode: "solid", ambient: DEFAULT_BACKGROUND.ambient, aurora: DEFAULT_BACKGROUND.aurora, spotlight: DEFAULT_BACKGROUND.spotlight })}><RotateCcw /></Button>}
  >
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm font-medium" htmlFor="neoview-dynamic-background-enabled">启用动态背景</label>
      <Switch id="neoview-dynamic-background-enabled" checked={effectEnabled} disabled={saving} onCheckedChange={() => void commit({ mode: effectEnabled ? "solid" : "ambient" })} />
    </div>

    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">背景模式</span>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="背景模式">
        {MODES.map((mode) => {
          const Icon = mode.icon
          return <button
            type="button"
            key={mode.value}
            title={mode.description}
            data-background-mode={mode.value}
            aria-pressed={draft.mode === mode.value}
            disabled={saving}
            className={cn("flex h-8 min-w-0 items-center gap-1.5 rounded border px-2 text-left text-xs hover:bg-muted disabled:opacity-50", draft.mode === mode.value && "border-primary bg-primary text-primary-foreground hover:bg-primary")}
            onClick={() => void commit({ mode: mode.value })}
          ><Icon className="size-3.5 shrink-0" /><span className="truncate">{mode.label}</span></button>
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">{selected.description}</p>
    </div>

    {draft.mode === "ambient" ? <section className="grid gap-3 border-t pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles className="size-3.5" />流光溢彩设置</h3>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="动画样式">
        {STYLES.map((style) => <Button key={style.value} type="button" size="sm" variant={draft.ambient.style === style.value ? "default" : "outline"} disabled={saving} onClick={() => void commit({ ambient: { style: style.value } })}>{style.label}</Button>)}
      </div>
      <RangeRow label="动画速度" value={draft.ambient.speed} min={2} max={20} step={1} suffix="s" disabled={saving} onChange={(speed) => void commit({ ambient: { speed } })} />
      <RangeRow label="模糊程度" value={draft.ambient.blur} min={20} max={150} step={10} suffix="px" disabled={saving} onChange={(blur) => void commit({ ambient: { blur } })} />
      <RangeRow label="效果强度" value={draft.ambient.opacity} min={0.3} max={1} step={0.05} format={(value) => `${Math.round(value * 100)}%`} disabled={saving} onChange={(opacity) => void commit({ ambient: { opacity } })} />
      <AmbientPreview config={draft} />
    </section> : null}

    {draft.mode === "aurora" ? <section className="grid gap-3 border-t pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Waves className="size-3.5" />极光设置</h3>
      <div className="flex items-center justify-between gap-3"><span className="text-xs">显示径向渐变遮罩</span><Switch checked={draft.aurora.showRadialGradient} disabled={saving} onCheckedChange={(showRadialGradient) => void commit({ aurora: { showRadialGradient } })} /></div>
      <div className={cn("ambient-background-aurora-preview", draft.aurora.showRadialGradient && "is-masked")} data-testid="ambient-background-aurora-preview" />
    </section> : null}

    {draft.mode === "spotlight" ? <section className="grid gap-3 border-t pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Flashlight className="size-3.5" />聚光灯设置</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="光束颜色">{SPOTLIGHT_COLORS.map((color) => <button key={color} type="button" aria-label={`光束颜色 ${color}`} aria-pressed={draft.spotlight.color === color} disabled={saving} className={cn("size-6 rounded-full border-2", draft.spotlight.color === color ? "border-primary ring-2 ring-primary/30" : "border-border")} style={{ backgroundColor: color }} onClick={() => void commit({ spotlight: { color } })} />)}</div>
      <div className="ambient-background-spotlight-preview" data-testid="ambient-background-spotlight-preview" style={{ "--spotlight-color": draft.spotlight.color } as React.CSSProperties} />
    </section> : null}

    {error ? <p role="alert" className="text-xs text-destructive">保存失败：{error}</p> : null}
  </SettingsCardShell>
}

function RangeRow({ label, value, min, max, step, suffix, format, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; format?: (value: number) => string; disabled: boolean; onChange(value: number): void }) {
  return <div className="grid gap-1.5"><div className="flex justify-between text-xs"><label htmlFor={`ambient-${label}`}>{label}</label><span className="tabular-nums">{format?.(value) ?? `${value}${suffix ?? ""}`}</span></div><Slider id={`ambient-${label}`} aria-label={label} min={min} max={max} step={step} value={[value]} disabled={disabled} onValueCommit={([next]) => { if (next !== undefined) onChange(next) }} /></div>
}

function AmbientPreview({ config }: { config: ReaderBackgroundConfigDto }) {
  return <div className="ambient-background-preview" data-testid="ambient-background-preview" data-style={config.ambient.style} style={{ "--ambient-speed": `${config.ambient.speed}s`, "--ambient-blur": `${Math.min(config.ambient.blur / 4, 20)}px`, "--ambient-opacity": config.ambient.opacity } as React.CSSProperties}><span /><span /><span /></div>
}

function mergeBackground(current: ReaderBackgroundConfigDto, patch: ReaderBackgroundPatchDto): ReaderBackgroundConfigDto {
  return { ...current, ...patch, ambient: { ...current.ambient, ...patch.ambient }, aurora: { ...current.aurora, ...patch.aurora }, spotlight: { ...current.spotlight, ...patch.spotlight } }
}

export default function DockedAmbientBackgroundCard({ viewDefaults, onViewDefaults }: ReaderPanelContext) {
  if (!viewDefaults || !onViewDefaults) return null
  return <AmbientBackgroundCard background={viewDefaults.background ?? DEFAULT_BACKGROUND} onChange={(background) => onViewDefaults({ background })} />
}
