/**
 * @migrated-from src/lib/cards/info/ImageTrimCard.svelte
 * @source-hash sha256:413b50582f039de6e0c563176543242b699c7e1c181322a54130bca578bc06ca
 * @features image-effects-transitions
 * @migration-status adapted
 */
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"
import { Link, Minus, RotateCcw, Square, Unlink, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

export type ImageTrimTarget = "auto" | "black" | "white"

export interface ImageTrimSettings {
  enabled: boolean
  top: number
  bottom: number
  left: number
  right: number
  linkVertical: boolean
  linkHorizontal: boolean
  autoTrimThreshold: number
  autoTrimTarget: ImageTrimTarget
}

export type ImageTrimPatch = Partial<ImageTrimSettings>

export interface ImageTrimPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ImageTrimSettings | undefined
  preview(patch: ImageTrimPatch): void
  commit(): Promise<void>
  update(patch: ImageTrimPatch): Promise<void>
  reset?(): Promise<void> | void
  autoDetect?(): Promise<void> | void
  presetBlack?(): Promise<void> | void
  presetWhite?(): Promise<void> | void
}

export interface ImageTrimCardProps {
  port?: ImageTrimPort
  imageTrim?: ImageTrimPort
  panelActive?: boolean
}

const DEFAULTS: ImageTrimSettings = {
  enabled: false,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  linkVertical: false,
  linkHorizontal: false,
  autoTrimThreshold: 30,
  autoTrimTarget: "auto",
}

/** The resident card keeps its shell mounted while the runtime port hydrates. */
export default function ImageTrimCard({ port, imageTrim, panelActive = true }: ImageTrimCardProps) {
  const activePort = port ?? imageTrim
  const subscribe = panelActive ? activePort?.subscribe ?? subscribeNoop : subscribeNoop
  const getSnapshot = panelActive ? activePort?.getSnapshot ?? getUndefinedSnapshot : getUndefinedSnapshot
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )
  const [busyAction, setBusyAction] = useState<string>()

  if (!settings || !activePort) {
    return (
      <section
        className="grid min-h-20 place-items-center text-xs text-muted-foreground"
        data-neoview-card="image-trim"
        data-image-trim-state="loading"
      >
        图像裁剪配置加载中...
      </section>
    )
  }

  const hasValues = settings.top > 0 || settings.bottom > 0 || settings.left > 0 || settings.right > 0
  const runAction = (name: string, action: (() => Promise<void> | void) | undefined) => {
    if (!action || busyAction) return
    setBusyAction(name)
    Promise.resolve(action()).finally(() => setBusyAction(undefined))
  }

  const reset = () => {
    if (activePort.reset) {
      void activePort.reset()
      return
    }
    activePort.preview({ ...DEFAULTS })
    void activePort.commit()
  }

  return (
    <section
      className="space-y-3 text-sm"
      data-neoview-card="image-trim"
      data-image-trim-state="ready"
    >
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs">
          <Switch
            size="sm"
            checked={settings.enabled}
            aria-label="启用图像裁剪"
            onCheckedChange={(enabled) => void activePort.update({ enabled })}
          />
          <span className="truncate">图像裁剪</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title="重置所有裁剪"
          aria-label="重置所有裁剪"
          data-image-trim-action="reset"
          onClick={reset}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {settings.enabled ? (
        <>
          <TrimSlider
            label="上"
            value={settings.top}
            onPreview={(top) => activePort.preview({ top })}
            onCommit={() => void activePort.commit()}
            link={settings.linkVertical}
            onToggleLink={() => void activePort.update({ linkVertical: !settings.linkVertical })}
          />
          <TrimSlider
            label="下"
            value={settings.bottom}
            onPreview={(bottom) => activePort.preview({ bottom })}
            onCommit={() => void activePort.commit()}
          />
          <TrimSlider
            label="左"
            value={settings.left}
            onPreview={(left) => activePort.preview({ left })}
            onCommit={() => void activePort.commit()}
            link={settings.linkHorizontal}
            onToggleLink={() => void activePort.update({ linkHorizontal: !settings.linkHorizontal })}
          />
          <TrimSlider
            label="右"
            value={settings.right}
            onPreview={(right) => activePort.preview({ right })}
            onCommit={() => void activePort.commit()}
          />

          {hasValues ? (
            <div
              className="relative aspect-[3/4] w-full overflow-hidden rounded border border-border bg-muted/30"
              data-image-trim-preview="true"
              data-testid="image-trim-preview"
              aria-label="裁剪预览"
            >
              <div className="absolute inset-0 bg-muted/20" aria-hidden="true" />
              <div
                className="absolute rounded-sm border border-primary/30 bg-primary/10"
                style={{ top: `${settings.top}%`, bottom: `${settings.bottom}%`, left: `${settings.left}%`, right: `${settings.right}%` }}
                aria-hidden="true"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground/60">
                  {(100 - settings.top - settings.bottom).toFixed(1)}% × {(100 - settings.left - settings.right).toFixed(1)}%
                </span>
              </div>
            </div>
          ) : null}

          <div className="border-t border-border" />

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">自动裁剪</span>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-center gap-1.5 bg-primary/10 px-2 text-xs text-primary hover:bg-primary/20"
              disabled={busyAction !== undefined || !activePort.autoDetect}
              data-image-trim-action="auto-detect"
              onClick={() => runAction("auto-detect", activePort.autoDetect)}
            >
              <Wand2 className="size-3.5" aria-hidden="true" />
              {busyAction === "auto-detect" ? "检测中..." : "自动检测"}
            </Button>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-7 min-w-0 flex-1 gap-1 bg-muted px-2 text-xs hover:bg-accent"
                disabled={busyAction !== undefined || !activePort.presetBlack}
                data-image-trim-action="preset-black"
                onClick={() => runAction("preset-black", activePort.presetBlack)}
              >
                <Square className="size-3 fill-current" aria-hidden="true" />
                去黑边
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-7 min-w-0 flex-1 gap-1 bg-muted px-2 text-xs hover:bg-accent"
                disabled={busyAction !== undefined || !activePort.presetWhite}
                data-image-trim-action="preset-white"
                onClick={() => runAction("preset-white", activePort.presetWhite)}
              >
                <Minus className="size-3" aria-hidden="true" />
                去白边
              </Button>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">容差</span>
                <output className="tabular-nums">{settings.autoTrimThreshold}</output>
              </div>
              <TrimRange
                label="容差"
                value={settings.autoTrimThreshold}
                min={5}
                max={100}
                step={5}
                onPreview={(autoTrimThreshold) => activePort.preview({ autoTrimThreshold })}
                onCommit={() => void activePort.commit()}
              />
            </div>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">目标颜色</span>
              <select
                className="h-7 rounded border border-input bg-background px-2 text-xs text-foreground"
                aria-label="目标颜色"
                value={settings.autoTrimTarget}
                onChange={(event) => void activePort.update({ autoTrimTarget: event.currentTarget.value as ImageTrimTarget })}
              >
                <option value="auto">自动</option>
                <option value="black">黑色</option>
                <option value="white">白色</option>
              </select>
            </label>
          </div>
        </>
      ) : null}
    </section>
  )
}

function TrimSlider({ label, value, onPreview, onCommit, link, onToggleLink }: {
  label: string
  value: number
  onPreview(value: number): void
  onCommit(): void
  link?: boolean
  onToggleLink?(): void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">{label}</span>
          {onToggleLink ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 p-0.5"
              aria-label={link ? `${label}取消联动` : `${label}联动`}
              title={link ? `${label}取消联动` : `${label}联动`}
              data-image-trim-action={link ? `unlink-${label}` : `link-${label}`}
              onClick={onToggleLink}
            >
              {link ? <Link className="size-3 text-primary" aria-hidden="true" /> : <Unlink className="size-3 text-muted-foreground" aria-hidden="true" />}
            </Button>
          ) : null}
        </div>
        <output className="tabular-nums">{value}%</output>
      </div>
      <TrimRange label={label} value={value} min={0} max={45} step={0.5} onPreview={onPreview} onCommit={onCommit} />
    </div>
  )
}

function TrimRange({ label, value, min, max, step, onPreview, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onPreview(value: number): void
  onCommit(): void
}) {
  const dirty = useRef(false)
  const finish = () => {
    if (!dirty.current) return
    dirty.current = false
    onCommit()
  }
  const finishPointer = (event: PointerEvent<HTMLInputElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    finish()
  }
  const finishKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) finish()
  }
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      className="h-5 w-full accent-primary"
      onChange={(event) => {
        dirty.current = true
        onPreview(event.currentTarget.valueAsNumber)
      }}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyUp={finishKey}
      onBlur={finish}
    />
  )
}

function subscribeNoop(): () => void {
  return () => undefined
}

function getUndefinedSnapshot(): undefined {
  return undefined
}
