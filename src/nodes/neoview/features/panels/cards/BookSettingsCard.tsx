/**
 * @migrated-from src/lib/cards/properties/BookSettingsCard.svelte
 * @source-hash sha256:7034b5cf6da4a88be90a5cfd1d7b0bd1e4cf296429a5aad9bb30fec9379a9e22
 * @migration-status adapted
 */
import { type ReactNode } from "react"
import { ArrowLeft, ArrowRight, Columns2, Heart, RotateCcw, Square, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type {
  ReaderBookSettingsKeyDto,
  ReaderBookSettingsPatchDto,
  ReaderBookSettingsSnapshotDto,
} from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { useReaderBookSettings } from "./useReaderBookSettings"

export interface BookSettingsCardProps {
  bookName: string
  settings: ReaderBookSettingsSnapshotDto
  disabled?: boolean
  saving?: boolean
  error?: string
  onRetry?(): void
  onUpdate(patch: ReaderBookSettingsPatchDto): void | Promise<void>
}

export const BOOK_SETTINGS_CAPABILITY_AUDIT = [
  { id: "favorite", status: "supported-persistent", blocker: undefined },
  { id: "rating", status: "supported-persistent", blocker: undefined },
  { id: "reading-direction", status: "supported-persistent", blocker: undefined },
  { id: "page-mode", status: "supported-persistent", blocker: undefined },
  { id: "horizontal-book", status: "supported-persistent", blocker: undefined },
] as const

export default function BookSettingsPanelCard(context: ReaderPanelContext) {
  if (!context.session) return null
  return <ConnectedBookSettingsCard key={context.session.sessionId} context={context} sessionId={context.session.sessionId} />
}

function ConnectedBookSettingsCard({ context, sessionId }: { context: ReaderPanelContext; sessionId: string }) {
  const state = useReaderBookSettings(context.client, sessionId, context.onBookSettingsUpdated)
  if (state.loading) return <div className="h-48 animate-pulse rounded bg-muted" aria-label="正在加载本书设置" />
  if (!state.value) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
        <span>{state.error ?? "本书设置不可用"}</span>
        <Button type="button" size="sm" variant="outline" onClick={state.retry}>重试</Button>
      </div>
    )
  }
  return (
    <BookSettingsCard
      bookName={context.session?.book.displayName ?? state.value.bookId}
      settings={state.value}
      disabled={context.disabled}
      saving={state.saving}
      error={state.error}
      onRetry={state.retry}
      onUpdate={state.update}
    />
  )
}

export function BookSettingsCard({
  bookName,
  settings,
  disabled = false,
  saving = false,
  error,
  onRetry,
  onUpdate,
}: BookSettingsCardProps) {
  const locked = disabled || saving
  const { effective } = settings

  return (
    <section className="grid gap-2 text-xs" aria-busy={saving} data-neoview-book-settings-card="true">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-muted-foreground" title={bookName}>{bookName}</p>
        {saving ? <span className="shrink-0 text-[10px] text-muted-foreground">保存中…</span> : null}
      </div>

      <SettingRow label="收藏" settingKey="favorite" settings={settings} disabled={locked} onUpdate={onUpdate}>
        <Button
          type="button"
          size="sm"
          variant={effective.favorite ? "default" : "outline"}
          aria-label={effective.favorite ? "取消收藏本书" : "收藏本书"}
          aria-pressed={effective.favorite}
          disabled={locked}
          onClick={() => void onUpdate({ favorite: !effective.favorite })}
        >
          <Heart className={cn(effective.favorite && "fill-current")} />
          {effective.favorite ? "已收藏" : "收藏"}
        </Button>
      </SettingRow>

      <SettingRow label="评分" settingKey="rating" settings={settings} disabled={locked} onUpdate={onUpdate}>
        <div className="flex shrink-0 items-center" role="group" aria-label="本书评分">
          {[1, 2, 3, 4, 5].map((rating) => (
            <Button
              key={rating}
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-6"
              title={`评分 ${rating} 星`}
              aria-label={`评分 ${rating} 星`}
              aria-pressed={effective.rating === rating}
              disabled={locked}
              onClick={() => void onUpdate({ rating })}
            >
              <Star className={cn("size-3.5", rating <= effective.rating && "fill-amber-400 text-amber-400")} />
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="阅读方向" settingKey="direction" settings={settings} disabled={locked} onUpdate={onUpdate}>
        <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/45 p-0.5" role="group" aria-label="阅读方向">
          <Button type="button" size="sm" variant={effective.direction === "left-to-right" ? "default" : "ghost"} aria-pressed={effective.direction === "left-to-right"} disabled={locked} onClick={() => void onUpdate({ direction: "left-to-right" })}>
            <ArrowRight />左→右
          </Button>
          <Button type="button" size="sm" variant={effective.direction === "right-to-left" ? "default" : "ghost"} aria-pressed={effective.direction === "right-to-left"} disabled={locked} onClick={() => void onUpdate({ direction: "right-to-left" })}>
            <ArrowLeft />右→左
          </Button>
        </div>
      </SettingRow>

      <SettingRow label="显示模式" settingKey="pageMode" settings={settings} disabled={locked} onUpdate={onUpdate}>
        <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/45 p-0.5" role="group" aria-label="显示模式">
          <Button type="button" size="sm" variant={effective.pageMode === "single" ? "default" : "ghost"} aria-pressed={effective.pageMode === "single"} disabled={locked} onClick={() => void onUpdate({ pageMode: "single" })}>
            <Square />单页
          </Button>
          <Button type="button" size="sm" variant={effective.pageMode === "double" ? "default" : "ghost"} aria-pressed={effective.pageMode === "double"} disabled={locked} onClick={() => void onUpdate({ pageMode: "double" })}>
            <Columns2 />双页
          </Button>
        </div>
      </SettingRow>

      <SettingRow label="横版本子" settingKey="horizontalBook" settings={settings} disabled={locked} onUpdate={onUpdate}>
        <Switch size="sm" checked={effective.horizontalBook} disabled={locked} aria-label="横版本子" onCheckedChange={(horizontalBook) => void onUpdate({ horizontalBook })} />
      </SettingRow>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-[10px] text-destructive">
          <span>{error}</span>
          {onRetry ? <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={onRetry}>重试</button> : null}
        </div>
      ) : null}
    </section>
  )
}

function SettingRow({
  label,
  settingKey,
  settings,
  disabled,
  onUpdate,
  children,
}: {
  label: string
  settingKey: ReaderBookSettingsKeyDto
  settings: ReaderBookSettingsSnapshotDto
  disabled: boolean
  onUpdate(patch: ReaderBookSettingsPatchDto): void | Promise<void>
  children: ReactNode
}) {
  const inherited = settings.inherited.includes(settingKey)
  return (
    <div className="grid grid-cols-[minmax(4.5rem,1fr)_auto] items-center gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <span className="font-medium">{label}</span>
        <span className="text-[9px] text-muted-foreground">{inherited ? "继承" : "本书"}</span>
        {!inherited ? (
          <Button type="button" size="icon-sm" variant="ghost" className="size-5" title={`恢复继承${label}`} aria-label={`恢复继承${label}`} disabled={disabled} onClick={() => void onUpdate({ [settingKey]: null })}>
            <RotateCcw className="size-3" />
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  )
}
