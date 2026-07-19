/**
 * @migrated-from src/lib/cards/info/PageTransitionCard.svelte
 * @source-hash sha256:394878e16926095fe21609f72d4ba961f9c650dd2416fc724833b3dba3b21375
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/PageTransitionCard.tsx
 * @source-ui-inventory migration/neoview/card-compatibility.json#page-transition
 * @migration-status adapted
 */
import { READER_PAGE_TRANSITION_EASINGS, READER_PAGE_TRANSITION_EASING_LABELS, READER_PAGE_TRANSITION_TYPES, READER_PAGE_TRANSITION_TYPE_LABELS, projectReaderPageTransitionCss, type ReaderPageTransitionEasing, type ReaderPageTransitionType } from "@xiranite/node-neoview/page-transition"
import { RotateCcw } from "lucide-react"
import { useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ReaderPageTransitionPort } from "../../page-transition/ReaderPageTransitionStore"
import type { ReaderPanelContext } from "../registry"

export default function DockedPageTransitionCard({ pageTransition, panelActive = true }: ReaderPanelContext) {
  if (!pageTransition) return <p className="text-xs text-muted-foreground">翻页动画尚未就绪。</p>
  return <PageTransitionCard store={pageTransition} dataPanelActive={panelActive} />
}

export function PageTransitionCard({ store, disabled = false, dataPanelActive = true }: { store: ReaderPageTransitionPort; disabled?: boolean; dataPanelActive?: boolean }) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [previewing, setPreviewing] = useState(false)
  const preview = projectReaderPageTransitionCss(settings, "next")
  const commitDuration = () => { void store.commit() }
  return (
    <section className="space-y-3 text-sm" data-neoview-card="page-transition" data-panel-active={dataPanelActive ? "true" : "false"}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs"><Checkbox checked={settings.enabled} disabled={disabled} onCheckedChange={(value) => void store.update({ enabled: value === true })} /><span className="truncate">启用翻页动画</span></label>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={disabled} title="重置设置" aria-label="重置设置" onClick={() => void store.reset()}><RotateCcw className="size-3.5" /></Button>
      </div>
      {settings.enabled ? <>
        <SelectField label="动画类型" value={settings.type} disabled={disabled} options={READER_PAGE_TRANSITION_TYPES.map((value) => ({ value, label: READER_PAGE_TRANSITION_TYPE_LABELS[value] }))} onChange={(value) => void store.update({ type: value as ReaderPageTransitionType })} />
        <div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-muted-foreground">动画时长</span><output className="tabular-nums">{settings.duration}ms</output></div><input type="range" min={0} max={500} step={10} value={settings.duration} disabled={disabled} aria-label="动画时长" className="h-5 w-full accent-primary" onChange={(event) => store.preview({ duration: event.currentTarget.valueAsNumber })} onPointerUp={(event) => finishPointer(event, commitDuration)} onPointerCancel={(event) => finishPointer(event, commitDuration)} onKeyUp={(event) => finishKey(event, commitDuration)} onBlur={commitDuration} /><div className="flex justify-between text-[10px] text-muted-foreground"><span>0ms</span><span>500ms</span></div></div>
        <SelectField label="缓动函数" value={settings.easing} disabled={disabled} options={READER_PAGE_TRANSITION_EASINGS.map((value) => ({ value, label: READER_PAGE_TRANSITION_EASING_LABELS[value] }))} onChange={(value) => void store.update({ easing: value as ReaderPageTransitionEasing })} />
        <div className="border-t border-border pt-2"><span className="text-xs text-muted-foreground">预览</span><div className="relative mt-2 h-16 overflow-hidden rounded bg-muted/30"><button type="button" className="absolute inset-2 flex items-center justify-center rounded bg-primary/20 text-xs text-muted-foreground" style={previewStyle(preview.transition, previewing)} disabled={disabled} aria-label="预览翻页动画" onPointerEnter={() => setPreviewing(true)} onPointerLeave={() => setPreviewing(false)} onFocus={() => setPreviewing(true)} onBlur={() => setPreviewing(false)}>{READER_PAGE_TRANSITION_TYPE_LABELS[settings.type]}</button></div></div>
      </> : null}
    </section>
  )
}

function SelectField({ label, value, disabled, options, onChange }: { label: string; value: string; disabled: boolean; options: readonly { value: string; label: string }[]; onChange(value: string): void }) {
  return <label className="block space-y-1 text-xs"><span className="text-muted-foreground">{label}</span><select className="h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}
function previewStyle(transition: string, active: boolean): CSSProperties { return { transition, transform: active ? "scale(0.95)" : "scale(1)", opacity: active ? 0.7 : 1 } }
function finishPointer(event: PointerEvent<HTMLInputElement>, commit: () => void): void { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); commit() }
function finishKey(event: KeyboardEvent<HTMLInputElement>, commit: () => void): void { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit() }
