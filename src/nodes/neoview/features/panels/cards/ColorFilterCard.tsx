/**
 * @migrated-from src/lib/cards/info/ColorFilterCard.svelte
 * @source-hash sha256:4417b1cd588927c5b35921af0e3cdc3c182b63a9681459085ae3643c78bfca91
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/ColorFilterCard.tsx
 * @source-ui-inventory migration/neoview/card-compatibility.json#color-filter
 * @migration-status adapted
 */
import { READER_COLOR_FILTER_PRESET_IDS, READER_COLOR_FILTER_PRESET_LABELS, type ReaderColorFilterPatch, type ReaderColorFilterSettings } from "@xiranite/node-neoview/color-filter"
import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import type { ReaderColorFilterPort } from "../../color-filter/ReaderColorFilterStore"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardSaveFeedback, useReaderCardMutation } from "./shared/ReaderCardMutation"

const SLIDERS = [
  { key: "brightness", label: "亮度", min: 50, max: 150, suffix: "%" },
  { key: "contrast", label: "对比度", min: 50, max: 150, suffix: "%" },
  { key: "saturation", label: "饱和度", min: 0, max: 200, suffix: "%" },
  { key: "sepia", label: "棕褐色", min: 0, max: 100, suffix: "%" },
  { key: "hueRotate", label: "色相旋转", min: 0, max: 360, suffix: "°" },
] as const
const COLOR_FILTER_COMMIT_DELAY_MS = 120

export default function DockedColorFilterCard({ colorFilter, panelActive = true }: ReaderPanelContext) {
  if (!colorFilter) return <p className="text-xs text-muted-foreground">颜色滤镜尚未就绪。</p>
  return <ColorFilterCard store={colorFilter} dataPanelActive={panelActive} />
}

export function ColorFilterCard({ store, disabled = false, dataPanelActive = true }: {
  store: ReaderColorFilterPort
  disabled?: boolean
  dataPanelActive?: boolean
}) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const scheduledCommitRef = useRef<ReturnType<typeof setTimeout>>()
  const { state: saveState, run: runMutation, markEdited, retry } = useReaderCardMutation()

  useEffect(() => {
    return () => {
      if (scheduledCommitRef.current) clearTimeout(scheduledCommitRef.current)
    }
  }, [])

  const commit = useCallback(() => {
    if (scheduledCommitRef.current) {
      clearTimeout(scheduledCommitRef.current)
      scheduledCommitRef.current = undefined
    }
    const target = store.getSnapshot()
    runMutation(() => store.commit(), () => store.update(target))
  }, [runMutation, store])

  const update = useCallback((patch: ReaderColorFilterPatch) => {
    store.preview(patch)
    markEdited(() => store.update(patch))
    if (scheduledCommitRef.current) clearTimeout(scheduledCommitRef.current)
    scheduledCommitRef.current = setTimeout(commit, COLOR_FILTER_COMMIT_DELAY_MS)
  }, [commit, markEdited, store])

  const preview = useCallback((patch: ReaderColorFilterPatch) => {
    store.preview(patch)
    markEdited()
  }, [markEdited, store])

  const reset = useCallback(() => runMutation(() => store.reset(), () => store.reset()), [runMutation, store])
  return (
    <section
      className="space-y-3 text-sm"
      data-neoview-card="color-filter"
      data-panel-active={dataPanelActive ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2">
        <ToggleRow
          label="着色"
          checked={settings.colorizeEnabled}
          disabled={disabled}
          onCheckedChange={(colorizeEnabled) => update({ colorizeEnabled })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={disabled}
          title="重置全部滤镜"
          aria-label="重置全部滤镜"
          onClick={reset}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      {settings.colorizeEnabled ? (
        <div className="space-y-2" data-reader-card-control-group="colorize">
          <Field label="着色预设">
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
              aria-label="着色预设"
              value={settings.colorizePreset}
              disabled={disabled}
              onChange={(event) => update({ colorizePreset: event.currentTarget.value as ReaderColorFilterSettings["colorizePreset"] })}
            >
              {READER_COLOR_FILTER_PRESET_IDS.map((preset) => (
                <option key={preset} value={preset}>{READER_COLOR_FILTER_PRESET_LABELS[preset]}</option>
              ))}
            </select>
          </Field>
          <ToggleRow
            label="仅黑白图像"
            description="只对黑白页面应用着色预设。"
            checked={settings.onlyBlackAndWhite}
            disabled={disabled}
            onCheckedChange={(onlyBlackAndWhite) => update({ onlyBlackAndWhite })}
          />
        </div>
      ) : null}

      <div className="space-y-2.5" data-reader-card-control-group="filters">
        {SLIDERS.map((slider) => (
          <FilterSlider
            key={slider.key}
            label={slider.label}
            value={settings[slider.key]}
            min={slider.min}
            max={slider.max}
            suffix={slider.suffix}
            disabled={disabled}
            onPreview={(value) => preview({ [slider.key]: value } as ReaderColorFilterPatch)}
            onCommit={commit}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-4 pt-1" data-reader-card-control-group="effects">
        <ToggleRow
          label="反色"
          checked={settings.invert}
          disabled={disabled}
          onCheckedChange={(invert) => update({ invert })}
        />
        <ToggleRow
          label="负片"
          checked={settings.negative}
          disabled={disabled}
          onCheckedChange={(negative) => update({ negative })}
        />
      </div>

      <ReaderCardSaveFeedback state={saveState} disabled={disabled} onRetry={retry} />
    </section>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <button
        type="button"
        className="min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      >
        <div className="text-xs text-foreground">{label}</div>
        {description ? <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </button>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function FilterSlider({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onPreview,
  onCommit,
}: {
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
    <label className="grid gap-1 text-xs">
      <span className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <output className="tabular-nums text-muted-foreground">{value}{suffix}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="h-2 min-w-0 w-full accent-primary"
        onChange={(event) => onPreview(event.currentTarget.valueAsNumber)}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyUp={finishKey}
        onBlur={onCommit}
      />
    </label>
  )
}
