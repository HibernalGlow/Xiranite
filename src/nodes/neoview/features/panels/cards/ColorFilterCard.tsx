/**
 * @migrated-from src/lib/cards/info/ColorFilterCard.svelte
 * @features color-filter
 * @migration-status adapted
 */
import {
  READER_COLOR_FILTER_PRESET_IDS,
  READER_COLOR_FILTER_PRESET_LABELS,
  type ReaderColorFilterPatch,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/color-filter"
import { RotateCcw } from "lucide-react"
import { useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

import type { ReaderColorFilterPort } from "../../color-filter/ReaderColorFilterStore"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

const SLIDERS = [
  { key: "brightness", label: "亮度", min: 50, max: 150, suffix: "%" },
  { key: "contrast", label: "对比度", min: 50, max: 150, suffix: "%" },
  { key: "saturation", label: "饱和度", min: 0, max: 200, suffix: "%" },
  { key: "sepia", label: "棕褐色", min: 0, max: 100, suffix: "%" },
  { key: "hueRotate", label: "色相旋转", min: 0, max: 360, suffix: "°" },
] as const

export default function DockedColorFilterCard({ colorFilter, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!colorFilter) return <p className="text-xs text-muted-foreground">颜色滤镜尚未就绪。</p>
  return <ColorFilterCard store={colorFilter} />
}

export function ColorFilterCard({ store, disabled = false }: { store: ReaderColorFilterPort; disabled?: boolean }) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const commit = () => { void store.commit() }

  return (
    <section className="space-y-3 text-sm" data-neoview-card="color-filter">
      <div className="flex items-center justify-between gap-2">
        <CheckboxRow
          label="上色"
          checked={settings.colorizeEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => void store.update({ colorizeEnabled: checked })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={disabled}
          title="重置所有滤镜"
          aria-label="重置所有滤镜"
          onClick={() => void store.reset()}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      {settings.colorizeEnabled ? (
        <div className="space-y-2">
          <select
            className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground"
            aria-label="上色预设"
            value={settings.colorizePreset}
            disabled={disabled}
            onChange={(event) => void store.update({ colorizePreset: event.currentTarget.value as ReaderColorFilterSettings["colorizePreset"] })}
          >
            {READER_COLOR_FILTER_PRESET_IDS.map((preset) => (
              <option key={preset} value={preset}>{READER_COLOR_FILTER_PRESET_LABELS[preset]}</option>
            ))}
          </select>
          <CheckboxRow
            label="仅黑白图像"
            checked={settings.onlyBlackAndWhite}
            disabled={disabled}
            onCheckedChange={(checked) => void store.update({ onlyBlackAndWhite: checked })}
          />
        </div>
      ) : null}

      <div className="space-y-2.5">
        {SLIDERS.map((slider) => (
          <FilterSlider
            key={slider.key}
            label={slider.label}
            value={settings[slider.key]}
            min={slider.min}
            max={slider.max}
            suffix={slider.suffix}
            disabled={disabled}
            onPreview={(value) => store.preview({ [slider.key]: value } as ReaderColorFilterPatch)}
            onCommit={commit}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <CheckboxRow label="反色" checked={settings.invert} disabled={disabled} onCheckedChange={(checked) => void store.update({ invert: checked })} />
        <CheckboxRow label="负片" checked={settings.negative} disabled={disabled} onCheckedChange={(checked) => void store.update({ negative: checked })} />
      </div>
    </section>
  )
}

function CheckboxRow({ label, checked, disabled, onCheckedChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onCheckedChange(checked: boolean): void
}) {
  const id = `neoview-color-filter-${label}`
  return (
    <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-xs">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span className="truncate">{label}</span>
    </label>
  )
}

function FilterSlider({ label, value, min, max, suffix, disabled, onPreview, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  disabled: boolean
  onPreview(value: number): void
  onCommit(): void
}) {
  const finishPointer = (event: PointerEvent<HTMLInputElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onCommit()
  }
  const finishKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onCommit()
  }
  return (
    <label className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="h-5 min-w-0 accent-primary"
        onChange={(event) => onPreview(event.currentTarget.valueAsNumber)}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyUp={finishKey}
        onBlur={onCommit}
      />
      <output className="tabular-nums text-right text-muted-foreground">{value}{suffix}</output>
    </label>
  )
}
