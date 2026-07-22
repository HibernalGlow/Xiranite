/**
 * @migrated-from src/lib/cards/info/ColorFilterCard.svelte
 * @source-hash sha256:4417b1cd588927c5b35921af0e3cdc3c182b63a9681459085ae3643c78bfca91
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/ColorFilterCard.tsx
 * @source-ui-inventory migration/neoview/card-compatibility.json#color-filter
 * @migration-status adapted
 */
import { READER_COLOR_FILTER_PRESET_IDS, READER_COLOR_FILTER_PRESET_LABELS, type ReaderColorFilterPatch, type ReaderColorFilterSettings } from "@xiranite/node-neoview/ui-core"
import { Palette, RotateCcw, SlidersHorizontal, WandSparkles } from "lucide-react"
import { useCallback, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import type { ReaderColorFilterPort } from "../../color-filter/ReaderColorFilterStore"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { ReaderCardSaveFeedback, useReaderCardMutation } from "./shared/ReaderCardMutation"
import { ReaderSettingsSection, ReaderSettingsSlider, ReaderSettingsToggle } from "./shared/ReaderSettingsControls"

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

export function ColorFilterCard({ store, disabled = false }: {
  store: ReaderColorFilterPort
  disabled?: boolean
  dataPanelActive?: boolean
}) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const { state: saveState, run: runMutation, markEdited, retry } = useReaderCardMutation()

  const commit = useCallback(() => {
    const target = store.getSnapshot()
    runMutation(() => store.commit(), () => store.update(target))
  }, [runMutation, store])

  const update = useCallback((patch: ReaderColorFilterPatch) => {
    runMutation(() => store.update(patch), () => store.update(patch))
  }, [runMutation, store])

  const preview = useCallback((patch: ReaderColorFilterPatch) => {
    store.preview(patch)
    markEdited()
  }, [markEdited, store])

  const reset = useCallback(() => runMutation(() => store.reset(), () => store.reset()), [runMutation, store])
  return (
    <section
      className="@container space-y-3 text-xs text-muted-foreground"
      data-neoview-card="color-filter"
    >
      <ReaderSettingsSection
        title="着色"
        description="为页面叠加颜色预设，可限制为仅黑白图像。"
        icon={<Palette className="size-3 text-primary" />}
        action={(
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
        )}
      >
        <ReaderSettingsToggle
          label="着色"
          checked={settings.colorizeEnabled}
          disabled={disabled}
          onCheckedChange={(colorizeEnabled) => update({ colorizeEnabled })}
        />
        {settings.colorizeEnabled ? (
          <div className="space-y-2.5 border-t border-border/40 pt-2.5" data-reader-card-control-group="colorize">
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              <span>着色预设</span>
              <NativeSelect
              size="sm"
              className="w-full text-xs"
              aria-label="着色预设"
              value={settings.colorizePreset}
              disabled={disabled}
              onChange={(event) => update({ colorizePreset: event.currentTarget.value as ReaderColorFilterSettings["colorizePreset"] })}
            >
              {READER_COLOR_FILTER_PRESET_IDS.map((preset) => (
                <NativeSelectOption key={preset} value={preset}>{READER_COLOR_FILTER_PRESET_LABELS[preset]}</NativeSelectOption>
              ))}
              </NativeSelect>
            </label>
            <ReaderSettingsToggle
              label="仅黑白图像"
              description="只对黑白页面应用着色预设。"
              checked={settings.onlyBlackAndWhite}
              disabled={disabled}
              onCheckedChange={(onlyBlackAndWhite) => update({ onlyBlackAndWhite })}
            />
          </div>
        ) : null}
      </ReaderSettingsSection>

      <ReaderSettingsSection title="基础滤镜" icon={<SlidersHorizontal className="size-3 text-primary" />}>
        <div className="space-y-2.5" data-reader-card-control-group="filters">
        {SLIDERS.map((slider) => (
          <ReaderSettingsSlider
            key={slider.key}
            label={slider.label}
            value={settings[slider.key]}
            min={slider.min}
            max={slider.max}
            suffix={slider.suffix}
            disabled={disabled}
            onPreview={(value) => preview({ [slider.key]: value } as ReaderColorFilterPatch)}
            onCommit={() => commit()}
          />
        ))}
        </div>
      </ReaderSettingsSection>

      <ReaderSettingsSection title="色彩效果" icon={<WandSparkles className="size-3 text-primary" />}>
        <div className="grid grid-cols-2 gap-3" data-reader-card-control-group="effects">
        <ReaderSettingsToggle
          label="反色"
          checked={settings.invert}
          disabled={disabled}
          onCheckedChange={(invert) => update({ invert })}
        />
        <ReaderSettingsToggle
          label="负片"
          checked={settings.negative}
          disabled={disabled}
          onCheckedChange={(negative) => update({ negative })}
        />
        </div>
      </ReaderSettingsSection>

      <ReaderCardSaveFeedback state={saveState} disabled={disabled} onRetry={retry} />
    </section>
  )
}
