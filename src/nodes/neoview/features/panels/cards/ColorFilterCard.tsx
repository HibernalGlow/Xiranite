/**
 * @migrated-from src/lib/cards/info/ColorFilterCard.svelte
 * @source-hash sha256:4417b1cd588927c5b35921af0e3cdc3c182b63a9681459085ae3643c78bfca91
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/ColorFilterCard.tsx
 * @source-ui-inventory migration/neoview/card-compatibility.json#color-filter
 * @migration-status adapted
 */
import { READER_COLOR_FILTER_PRESET_IDS, READER_COLOR_FILTER_PRESET_LABELS, type ReaderColorFilterPatch, type ReaderColorFilterSettings } from "@xiranite/node-neoview/color-filter"
import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ReaderColorFilterPort } from "../../color-filter/ReaderColorFilterStore"
import type { ReaderPanelContext } from "../registry"

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

export function ColorFilterCard({ store, disabled = false, dataPanelActive = true }: { store: ReaderColorFilterPort; disabled?: boolean; dataPanelActive?: boolean }) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [saveState, setSaveState] = useState<SaveState>({ phase: "idle" })
  const mountedRef = useRef(true)
  const scheduledCommitRef = useRef<ReturnType<typeof setTimeout>>()
  const retryRef = useRef<(() => Promise<void>)>()
  useEffect(() => () => {
    mountedRef.current = false
    if (scheduledCommitRef.current) clearTimeout(scheduledCommitRef.current)
  }, [])
  const runMutation = useCallback((operation: () => Promise<void>, retry = operation) => {
    retryRef.current = retry
    setSaveState({ phase: "saving" })
    void operation().then(() => { if (mountedRef.current) { retryRef.current = undefined; setSaveState({ phase: "saved" }) } }).catch((cause) => { if (mountedRef.current) setSaveState({ phase: "error", message: errorMessage(cause) }) })
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
    retryRef.current = () => store.update(patch)
    setSaveState((current) => current.phase === "saving" ? current : { phase: "idle" })
    if (scheduledCommitRef.current) clearTimeout(scheduledCommitRef.current)
    scheduledCommitRef.current = setTimeout(commit, COLOR_FILTER_COMMIT_DELAY_MS)
  }, [commit, store])
  const preview = useCallback((patch: ReaderColorFilterPatch) => { store.preview(patch); retryRef.current = undefined; setSaveState((current) => current.phase === "saving" ? current : { phase: "idle" }) }, [store])
  const reset = useCallback(() => runMutation(() => store.reset(), () => store.reset()), [runMutation, store])
  const retry = useCallback(() => { const operation = retryRef.current; if (operation) runMutation(operation, operation) }, [runMutation])
  // Store writes are serialized, so a new intent can safely replace the pending snapshot.
  const controlsDisabled = disabled
  return <section className="space-y-3 text-sm" data-neoview-card="color-filter" data-panel-active={dataPanelActive ? "true" : "false"}>
    <div className="flex items-center justify-between gap-2"><CheckboxRow label="着色" checked={settings.colorizeEnabled} disabled={controlsDisabled} onCheckedChange={(checked) => update({ colorizeEnabled: checked })} /><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={controlsDisabled} title="重置全部滤镜" aria-label="重置全部滤镜" onClick={reset}><RotateCcw className="size-3.5" /></Button></div>
    {settings.colorizeEnabled ? <div className="space-y-2"><select className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground" aria-label="着色预设" value={settings.colorizePreset} disabled={controlsDisabled} onChange={(event) => update({ colorizePreset: event.currentTarget.value as ReaderColorFilterSettings["colorizePreset"] })}>{READER_COLOR_FILTER_PRESET_IDS.map((preset) => <option key={preset} value={preset}>{READER_COLOR_FILTER_PRESET_LABELS[preset]}</option>)}</select><CheckboxRow label="仅黑白图像" checked={settings.onlyBlackAndWhite} disabled={controlsDisabled} onCheckedChange={(checked) => update({ onlyBlackAndWhite: checked })} /></div> : null}
    <div className="space-y-2.5">{SLIDERS.map((slider) => <FilterSlider key={slider.key} label={slider.label} value={settings[slider.key]} min={slider.min} max={slider.max} suffix={slider.suffix} disabled={controlsDisabled} onPreview={(value) => preview({ [slider.key]: value } as ReaderColorFilterPatch)} onCommit={commit} />)}</div>
    <div className="grid grid-cols-2 gap-3"><CheckboxRow label="反色" checked={settings.invert} disabled={controlsDisabled} onCheckedChange={(checked) => update({ invert: checked })} /><CheckboxRow label="负片" checked={settings.negative} disabled={controlsDisabled} onCheckedChange={(checked) => update({ negative: checked })} /></div>
    {saveState.phase === "saving" ? <p role="status" aria-live="polite" className="text-xs text-muted-foreground">正在保存...</p> : null}
    {saveState.phase === "saved" ? <p role="status" aria-live="polite" className="text-xs text-muted-foreground">已保存</p> : null}
    {saveState.phase === "error" ? <div role="alert" className="flex items-center justify-between gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"><span>保存失败：{saveState.message}</span><Button type="button" size="sm" variant="outline" onClick={retry} disabled={disabled}><RotateCcw />重试</Button></div> : null}
  </section>
}

type SaveState = { phase: "idle" | "saving" | "saved" } | { phase: "error"; message: string }
function CheckboxRow({ label, checked, disabled, onCheckedChange }: { label: string; checked: boolean; disabled: boolean; onCheckedChange(checked: boolean): void }) { const id = `neoview-color-filter-${label}`; return <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-xs"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} /><span className="truncate">{label}</span></label> }
function FilterSlider({ label, value, min, max, suffix, disabled, onPreview, onCommit }: { label: string; value: number; min: number; max: number; suffix: string; disabled: boolean; onPreview(value: number): void; onCommit(): void }) { const finishPointer = (event: PointerEvent<HTMLInputElement>) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); onCommit() }; const finishKey = (event: KeyboardEvent<HTMLInputElement>) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onCommit() }; return <label className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs"><span>{label}</span><input type="range" min={min} max={max} value={value} disabled={disabled} aria-label={label} className="h-5 min-w-0 accent-primary" onChange={(event) => onPreview(event.currentTarget.valueAsNumber)} onPointerUp={finishPointer} onPointerCancel={finishPointer} onKeyUp={finishKey} onBlur={onCommit} /><output className="tabular-nums text-right text-muted-foreground">{value}{suffix}</output></label> }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
