/**
 * @migrated-from src/lib/cards/info/PageTransitionCard.svelte
 * @source-hash sha256:394878e16926095fe21609f72d4ba961f9c650dd2416fc724833b3dba3b21375
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/PageTransitionCard.tsx
 * @source-ui-inventory migration/neoview/card-compatibility.json#page-transition
 * @migration-status adapted
 */
import {
  READER_PAGE_TRANSITION_EASINGS,
  READER_PAGE_TRANSITION_EASING_LABELS,
  READER_PAGE_TRANSITION_TYPES,
  READER_PAGE_TRANSITION_TYPE_LABELS,
  projectReaderPageTransitionCss,
  type ReaderPageTransitionEasing,
  type ReaderPageTransitionType,
} from "@xiranite/node-neoview/page-transition"
import { Play, RotateCcw, Sparkles, Timer } from "lucide-react"
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react"

import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import type { ReaderPageTransitionPort } from "../../page-transition/ReaderPageTransitionStore"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardSaveFeedback, useReaderCardMutation } from "./shared/ReaderCardMutation"
import { ReaderSettingsSection, ReaderSettingsSlider, ReaderSettingsToggle } from "./shared/ReaderSettingsControls"

export default function DockedPageTransitionCard({ pageTransition, panelActive = true }: ReaderPanelContext) {
  if (!pageTransition) return <p className="text-xs text-muted-foreground">翻页动画尚未就绪。</p>
  return <PageTransitionCard store={pageTransition} dataPanelActive={panelActive} />
}

export function PageTransitionCard({ store, disabled = false, dataPanelActive = true }: {
  store: ReaderPageTransitionPort
  disabled?: boolean
  dataPanelActive?: boolean
}) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [previewing, setPreviewing] = useState(false)
  const { state: saveState, run: runMutation, markEdited, retry } = useReaderCardMutation()
  const preview = projectReaderPageTransitionCss(settings, "next")

  const update = useCallback((patch: Parameters<ReaderPageTransitionPort["update"]>[0]) => {
    runMutation(() => store.update(patch), () => store.update(patch))
  }, [runMutation, store])
  const previewDuration = useCallback((duration: number) => {
    store.preview({ duration })
    markEdited()
  }, [markEdited, store])
  const commitDuration = useCallback(() => {
    const target = store.getSnapshot()
    runMutation(() => store.commit(), () => store.update(target))
  }, [runMutation, store])
  const reset = useCallback(() => runMutation(() => store.reset(), () => store.reset()), [runMutation, store])

  return (
    <section
      className="@container space-y-3 text-xs text-muted-foreground"
      data-neoview-card="page-transition"
      data-panel-active={dataPanelActive ? "true" : "false"}
    >
      <ReaderSettingsSection
        title="翻页动画"
        description="设置翻页时的动画类型、速度和缓动方式。"
        icon={<Sparkles className="size-3 text-primary" />}
        action={(
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={disabled}
            title="重置设置"
            aria-label="重置设置"
            onClick={reset}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      >
        <ReaderSettingsToggle
          label="启用翻页动画"
          checked={settings.enabled}
          disabled={disabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </ReaderSettingsSection>

      {settings.enabled ? (
        <ReaderSettingsSection title="动画参数" icon={<Timer className="size-3 text-primary" />}>
          <div className="space-y-3" data-reader-card-control-group="transition-settings">
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              <span>动画类型</span>
              <NativeSelect
              size="sm"
              className="w-full text-xs"
              aria-label="动画类型"
              value={settings.type}
              disabled={disabled}
              onChange={(event) => update({ type: event.currentTarget.value as ReaderPageTransitionType })}
            >
              {READER_PAGE_TRANSITION_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>{READER_PAGE_TRANSITION_TYPE_LABELS[value]}</NativeSelectOption>
              ))}
              </NativeSelect>
            </label>

            <ReaderSettingsSlider
              label="动画时长"
              value={settings.duration}
              min={0}
              max={500}
              step={10}
              suffix="ms"
              disabled={disabled}
              minLabel="0ms"
              maxLabel="500ms"
              onPreview={previewDuration}
              onCommit={() => commitDuration()}
            />

            <label className="grid gap-1 text-[10px] text-muted-foreground">
              <span>缓动函数</span>
              <NativeSelect
              size="sm"
              className="w-full text-xs"
              aria-label="缓动函数"
              value={settings.easing}
              disabled={disabled}
              onChange={(event) => update({ easing: event.currentTarget.value as ReaderPageTransitionEasing })}
            >
              {READER_PAGE_TRANSITION_EASINGS.map((value) => (
                <NativeSelectOption key={value} value={value}>{READER_PAGE_TRANSITION_EASING_LABELS[value]}</NativeSelectOption>
              ))}
              </NativeSelect>
            </label>
          </div>
        </ReaderSettingsSection>
      ) : null}

      {settings.enabled ? (
        <ReaderSettingsSection title="即时预览" icon={<Play className="size-3 text-primary" />}>
          <div data-reader-card-control-group="transition-preview">
            <div className="relative h-16 overflow-hidden rounded-md bg-muted/30">
              <button
                type="button"
                className="absolute inset-2 flex items-center justify-center rounded-md bg-primary/20 text-xs text-muted-foreground"
                style={previewStyle(preview.transition, previewing)}
                disabled={disabled}
                aria-label="预览翻页动画"
                onPointerEnter={() => setPreviewing(true)}
                onPointerLeave={() => setPreviewing(false)}
                onFocus={() => setPreviewing(true)}
                onBlur={() => setPreviewing(false)}
              >
                {READER_PAGE_TRANSITION_TYPE_LABELS[settings.type]}
              </button>
            </div>
          </div>
        </ReaderSettingsSection>
      ) : null}

      <ReaderCardSaveFeedback state={saveState} disabled={disabled} onRetry={retry} />
    </section>
  )
}

function previewStyle(transition: string, active: boolean): CSSProperties {
  return {
    transition,
    transform: active ? "scale(0.95)" : "scale(1)",
    opacity: active ? 0.7 : 1,
  }
}
