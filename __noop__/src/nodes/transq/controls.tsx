import type { LucideIcon } from "lucide-react"
import type { TransqQueueItem, TransqQueueStatus } from "@xiranite/node-transq/core"
import { Clipboard, Copy, FileCheck2, FileClock, FileWarning, FolderOutput, Languages, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TransqCardState } from "./types"

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string

export function ActionIconButton(props: {
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant="outline" onClick={props.onClick}>
          <Icon />
          <span className="sr-only">{props.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

export function PathsInput(props: {
  compact?: boolean
  data: TransqCardState
  disabled?: boolean
  t: Translate
  onClear: () => void
  onPaste: () => void
  onPatch: (patch: Partial<TransqCardState>) => void
}) {
  return (
    <Field className="min-h-0 min-w-0 gap-1.5">
      {!props.compact && (
        <FieldTitle className="text-sm">{props.t("input.title", "Translation workspace queue")}</FieldTitle>
      )}
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <Textarea
          id="transq-paths"
          aria-label={props.t("aria.paths", "transq translation workspaces")}
          className={cn("resize-none font-mono text-xs", props.compact ? "h-14" : "min-h-24")}
          disabled={props.disabled}
          placeholder={props.t("input.placeholder", "One root path per line\nD:/translation/project")}
          value={props.data.pathsText ?? ""}
          onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
        />
        <div className="grid content-start gap-1.5">
          <ActionIconButton disabled={props.disabled} icon={Clipboard} label={props.t("actions.pastePaths", "Paste paths")} onClick={props.onPaste} />
          <ActionIconButton disabled={props.disabled || !props.data.pathsText} icon={RotateCcw} label={props.t("actions.clearPaths", "Clear paths")} onClick={props.onClear} />
        </div>
      </div>
      {!props.compact && <FieldDescription>{props.t("input.description", "Scans original_images/manga_translator_work/result folders beneath each root.")}</FieldDescription>}
    </Field>
  )
}

export function QueueBoard(props: {
  compact?: boolean
  items: TransqQueueItem[]
  t: Translate
}) {
  const lanes: Array<{ status: TransqQueueStatus; title: string; icon: LucideIcon }> = [
    { status: "pending", title: props.t("lanes.pending", "Needs copy"), icon: FileClock },
    { status: "ready", title: props.t("lanes.ready", "Ready"), icon: FileCheck2 },
    { status: "output", title: props.t("lanes.output", "Output"), icon: FolderOutput },
    { status: "conflict", title: props.t("lanes.conflict", "Conflict"), icon: FileWarning },
  ]
  const missing = props.items.filter((item) => item.status === "missing")
  const conflictItems = props.items.filter((item) => item.status === "conflict").concat(missing)

  return (
    <section data-testid="transq-queue-board" className={cn("grid min-h-0 gap-2", props.compact ? "grid-cols-2" : "grid-cols-2 @4xl/transq:grid-cols-4")}>
      {lanes.map((lane) => {
        const items = lane.status === "conflict" ? conflictItems : props.items.filter((item) => item.status === lane.status)
        return <QueueLane key={lane.status} compact={props.compact} icon={lane.icon} items={items} title={lane.title} t={props.t} tone={lane.status} />
      })}
    </section>
  )
}

function QueueLane(props: {
  compact?: boolean
  icon: LucideIcon
  items: TransqQueueItem[]
  title: string
  tone: TransqQueueStatus
  t: Translate
}) {
  const Icon = props.icon
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card", props.tone === "conflict" && "border-destructive/50")}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <Icon className={cn("shrink-0 text-muted-foreground", props.tone === "conflict" && "text-destructive")} />
          <span className="truncate">{props.title}</span>
        </div>
        <Badge variant={props.tone === "conflict" ? "destructive" : props.tone === "output" ? "default" : "outline"}>{props.items.length}</Badge>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.items.length ? (
          <div className="grid gap-1.5 p-2">
            {props.items.map((item) => <QueueCard key={item.id} compact={props.compact} item={item} t={props.t} />)}
          </div>
        ) : (
          <div className="flex min-h-24 items-center justify-center p-3 text-center text-xs text-muted-foreground">
            {props.t("lanes.empty", "No queue items")}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function QueueCard(props: { compact?: boolean; item: TransqQueueItem; t: Translate }) {
  const issueCount = props.item.errors.length + props.item.missingFiles.length
  return (
    <div className={cn("grid gap-1 rounded-md border px-2 py-1.5", props.item.status === "conflict" || props.item.status === "missing" ? "border-destructive/40" : "bg-muted/25")}>
      <div className="truncate text-xs font-medium" title={props.item.originalImagesPath}>{baseName(props.item.originalImagesPath)}</div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span>{props.t("item.original", "Original")} {props.item.originalCount}</span>
        <span>{props.t("item.result", "Result")} {props.item.resultCount}</span>
      </div>
      {props.item.missingFiles.length > 0 && <div className="truncate text-[11px] text-muted-foreground">{props.t("item.copy", "Copy")} {props.item.missingFiles.length}</div>}
      {issueCount > 0 && <div className="truncate text-[11px] text-destructive">{props.item.errors[0] ?? props.t("item.missing", "Missing mapped files")}</div>}
      {!props.compact && <div className="truncate font-mono text-[10px] text-muted-foreground">{props.item.outputPath}</div>}
    </div>
  )
}

export function QueueEmptyState({ t }: { t: Translate }) {
  return (
    <Empty className="min-h-48 border-0 p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Languages /></EmptyMedia>
        <EmptyTitle className="text-sm">{t("empty.title", "Awaiting translation queues")}</EmptyTitle>
        <EmptyDescription className="text-xs">{t("empty.description", "Add a workspace path, then preview its result queues.")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function LogStrip(props: { logs: string[]; t: Translate; onCopy: () => void }) {
  if (!props.logs.length) return null
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5">
      <ScrollArea className="min-w-0 flex-1">
        <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
          {props.logs.slice(-4).map((line, index) => <span key={`${line}:${index}`} className="whitespace-nowrap">{line}</span>)}
        </div>
      </ScrollArea>
      <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
        <Copy data-icon="inline-start" />
        {props.t("actions.copyLogs", "Copy logs")}
      </Button>
    </div>
  )
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
