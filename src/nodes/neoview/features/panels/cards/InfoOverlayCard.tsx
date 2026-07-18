/**
 * @migrated-from src/lib/cards/info/InfoOverlayCard.svelte
 * @source-hash sha256:47bbb9b8824b6effc99211d400b5ad1520315cb91e2a6559e6dc3aaae4e844f1
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/InfoOverlayCard.tsx
 * @features info-overlay
 * @migration-status adapted
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export interface InfoOverlaySettings {
  enabled: boolean
  opacity: number
  showBorder: boolean
  width?: number
  height?: number
}

export type InfoOverlayPatch = Partial<Omit<InfoOverlaySettings, "width" | "height">> & {
  width?: number | null
  height?: number | null
}

export interface InfoOverlayPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): InfoOverlaySettings | undefined
  preview(patch: InfoOverlayPatch): void
  commit(): Promise<void>
  update(patch: InfoOverlayPatch): Promise<void>
}

export interface InfoOverlayCardProps {
  port?: InfoOverlayPort
  infoOverlay?: InfoOverlayPort
  panelActive?: boolean
  disabled?: boolean
}

export function InfoOverlayCard({ port, infoOverlay, panelActive = true, disabled = false }: InfoOverlayCardProps) {
  const activePort = port ?? infoOverlay
  const subscribe = panelActive ? activePort?.subscribe ?? subscribeNoop : subscribeNoop
  const getSnapshot = panelActive ? activePort?.getSnapshot ?? getUndefinedSnapshot : getUndefinedSnapshot
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )

  if (!panelActive) return <ReaderCardEmptyState />

  if (!settings || !activePort) {
    return (
      <section
        className="grid min-h-20 place-items-center text-xs text-muted-foreground"
        data-neoview-card="info-overlay"
        data-info-overlay-state="loading"
        role="status"
        aria-live="polite"
      >
        信息悬浮窗配置加载中...
      </section>
    )
  }

  return (
    <section
      className="space-y-2 text-xs text-muted-foreground"
      data-neoview-card="info-overlay"
      data-info-overlay-state="ready"
    >
      <SwitchRow label="启用悬浮窗" checked={settings.enabled} disabled={disabled} onCheckedChange={(enabled) => void activePort!.update({ enabled })} />

      <div className="flex items-center justify-between gap-2">
        <span>透明度</span>
        <div className="flex items-center gap-2">
          <OpacityInput value={settings.opacity} disabled={disabled} onCommit={(opacity) => void activePort!.update({ opacity })} />
          <span className="text-[11px] tabular-nums">{Math.round(settings.opacity * 100)}%</span>
        </div>
      </div>

      <DimensionSlider
        label="宽度"
        value={settings.width}
        automaticValue={480}
        min={120}
        max={1600}
        step={20}
        onPreview={(width) => activePort!.preview({ width })}
        onCommit={() => void activePort!.commit()}
        disabled={disabled}
        onReset={() => { activePort!.preview({ width: null }); void activePort!.commit() }}
      />

      <DimensionSlider
        label="高度"
        value={settings.height}
        automaticValue={56}
        min={32}
        max={600}
        step={8}
        onPreview={(height) => activePort!.preview({ height })}
        onCommit={() => void activePort!.commit()}
        disabled={disabled}
        onReset={() => { activePort!.preview({ height: null }); void activePort!.commit() }}
      />

      <SwitchRow label="显示边框" checked={settings.showBorder} disabled={disabled} onCheckedChange={(showBorder) => void activePort!.update({ showBorder })} />
      <p className="text-[10px]">调节悬浮信息窗的背景透明度（0% - 100%，0% 为仅文字无底色）。</p>
    </section>
  )
}

export default InfoOverlayCard

function SwitchRow({ label, checked, disabled, onCheckedChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <Switch size="sm" checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function OpacityInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit(value: number): void }) {
  const percentage = Math.round(value * 100)
  const [draft, setDraft] = useState(String(percentage))
  const editingRef = useRef(false)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(String(percentage))
  }, [percentage])

  const finish = () => {
    editingRef.current = false
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(String(percentage))
      return
    }
    const parsed = Number.parseFloat(draft)
    const nextPercentage = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : percentage
    setDraft(String(nextPercentage))
    const next = nextPercentage / 100
    if (next !== value) onCommit(next)
  }

  return (
    <input
      type="number"
      min={0}
      max={100}
      step={5}
      className="h-7 w-20 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      value={draft}
      disabled={disabled}
      aria-label="透明度百分比"
      onFocus={() => { editingRef.current = true }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          cancelRef.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function DimensionSlider({ label, value, automaticValue, min, max, step, disabled, onPreview, onCommit, onReset }: {
  label: string
  value?: number
  automaticValue: number
  min: number
  max: number
  step: number
  disabled: boolean
  onPreview(value: number): void
  onCommit(): void
  onReset?(): void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <div className="flex items-center gap-1">
          <output className="text-[11px] text-muted-foreground">{value === undefined ? "自动" : `${value} px`}</output>
          {value !== undefined && onReset ? (
            <Button type="button" variant="ghost" size="icon" className="size-5" disabled={disabled} aria-label={`${label}恢复自动`} title={`${label}恢复自动`} onClick={onReset}>
              <RotateCcw className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value ?? automaticValue]}
        disabled={disabled}
        onValueChange={([next]) => onPreview(next ?? automaticValue)}
        onValueCommit={onCommit}
      />
    </div>
  )
}

function subscribeNoop(): () => void {
  return () => undefined
}

function getUndefinedSnapshot(): undefined {
  return undefined
}
