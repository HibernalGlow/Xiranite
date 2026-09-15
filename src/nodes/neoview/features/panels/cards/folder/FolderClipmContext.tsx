import { parseClipmFilenameScore } from "@xiranite/node-clipm/filename"
import { Pencil } from "lucide-react"
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { folderEntryExtension } from "./FolderEntryPresentation"
import { FOLDER_CLIPM_ENABLED } from "./folderClipmFeature"

export interface FolderClipmContextValue {
  openWork(entry: ReaderDirectoryEntryDto): void
  applyInlineFeedback?(entry: ReaderDirectoryEntryDto, label: "P" | "N", score: number): Promise<void>
  inlineEditEnabled?: boolean
  pendingPath?: string
  pendingPaths?: ReadonlySet<string>
}

const FolderClipmContext = createContext<FolderClipmContextValue | undefined>(undefined)
const CLIPM_ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "cbz", "cbr"])

export function FolderClipmProvider({ value, children }: { value: FolderClipmContextValue; children: ReactNode }) {
  return <FolderClipmContext.Provider value={value}>{children}</FolderClipmContext.Provider>
}

export function FolderClipmBadge({ entry, className = "" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  const controller = useContext(FolderClipmContext)
  // ClipM 临时屏蔽：徽标、内联评分器与评分入口一起下线，恢复开关见 folderClipmFeature.ts。
  if (!FOLDER_CLIPM_ENABLED || !controller || !folderEntrySupportsClipm(entry)) return null
  const rating = entry.clipmScore
    ? { label: entry.clipmScore.label, score: entry.clipmScore.score, version: BigInt(entry.clipmScore.bundleVersion), shortCode: entry.clipmScore.shortCode }
    : parseClipmFilenameScore(entry.name)
  const aggregate = entry.kind === "directory"
  const pending = controller.pendingPath === entry.path
    || controller.pendingPaths?.has(entry.path) === true
  const label = rating ? `CM ${rating.label} ${rating.score}` : "CM --"
  const tooltip = rating
    ? `${aggregate ? "文件夹内最高 " : ""}ClipM ${rating.label} · ${rating.score.toString().padStart(4, "0")}/1000 · 模型 v${rating.version}${rating.shortCode ? ` · ${rating.shortCode}` : ""}`
    : aggregate ? "文件夹内尚无 ClipM 评分" : "尚未评分，点击使用 ClipM 评分"
  const tone = rating?.label === "P"
    ? "border-emerald-800/40 bg-emerald-600 text-white dark:border-emerald-200/35 dark:bg-emerald-400 dark:text-emerald-950"
    : rating?.label === "N"
      ? "border-rose-800/40 bg-rose-600 text-white dark:border-rose-200/35 dark:bg-rose-400 dark:text-rose-950"
      : "border-border bg-background text-muted-foreground"

  const stop = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const badgeClass = `inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold tabular-nums shadow-sm backdrop-blur-sm ${tone} ${className}`
  if (rating && entry.kind === "file" && controller.inlineEditEnabled && controller.applyInlineFeedback) {
    return <FolderClipmInlineEditor entry={entry} label={rating.label} score={rating.score} pending={pending} className={className} onOpen={() => controller.openWork(entry)} onSave={controller.applyInlineFeedback} />
  }
  if (aggregate) {
    return (
      <span
        className={badgeClass}
        title={tooltip}
        aria-label={tooltip}
        data-folder-clipm-badge={rating?.label ?? "unrated"}
      >
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${badgeClass} hover:brightness-95 disabled:cursor-wait disabled:opacity-70`}
      title={tooltip}
      aria-label={`${tooltip}，编辑`}
      data-folder-clipm-badge={rating?.label ?? "unrated"}
      disabled={pending}
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={(event) => {
        stop(event)
        controller.openWork(entry)
      }}
    >
      {pending ? "CM …" : label}
    </button>
  )
}

function FolderClipmInlineEditor({
  entry,
  label,
  score,
  pending,
  className,
  onOpen,
  onSave,
}: {
  entry: ReaderDirectoryEntryDto
  label: "P" | "N"
  score: number
  pending: boolean
  className: string
  onOpen(): void
  onSave(entry: ReaderDirectoryEntryDto, label: "P" | "N", score: number): Promise<void>
}) {
  const [draftLabel, setDraftLabel] = useState(label)
  const [draftScore, setDraftScore] = useState(score)
  useEffect(() => setDraftLabel(label), [label])
  useEffect(() => setDraftScore(score), [score])
  const commit = async (nextLabel: "P" | "N", nextScore: number) => {
    if (pending) return
    setDraftLabel(nextLabel)
    setDraftScore(nextScore)
    try {
      await onSave(entry, nextLabel, nextScore)
    } catch {
      setDraftLabel(label)
      setDraftScore(score)
    }
  }
  const stopBubbling = (event: MouseEvent) => event.stopPropagation()
  return (
    <div
      className={`flex h-6 w-[min(13rem,calc(100%-0.5rem))] items-center gap-1 rounded border border-background/70 bg-background/95 px-1 shadow-sm backdrop-blur-sm ${className}`}
      data-folder-clipm-inline-editor="true"
      data-testid="folder-clipm-inline-editor"
      onClick={stopBubbling}
      onDoubleClick={stopBubbling}
      onPointerDown={stopBubbling}
    >
      <ToggleGroup
        type="single"
        value={draftLabel}
        disabled={pending}
        className="grid shrink-0 grid-cols-2 gap-0"
        aria-label="ClipM 喜好分类"
        onValueChange={(value) => {
          if (value === "P" || value === "N") void commit(value, draftScore)
        }}
      >
        <ToggleGroupItem value="P" className="h-5 min-w-5 px-1 text-[9px] data-[state=on]:bg-emerald-600 data-[state=on]:text-white">P</ToggleGroupItem>
        <ToggleGroupItem value="N" className="h-5 min-w-5 px-1 text-[9px] data-[state=on]:bg-rose-600 data-[state=on]:text-white">N</ToggleGroupItem>
      </ToggleGroup>
      <Slider
        aria-label={`ClipM 直接评分：${entry.name}`}
        disabled={pending}
        min={0}
        max={1000}
        step={1}
        value={[draftScore]}
        className="min-w-0 flex-1"
        onValueChange={(values) => setDraftScore(values[0] ?? draftScore)}
        onValueCommit={(values) => void commit(draftLabel, values[0] ?? draftScore)}
      />
      <output className="w-7 shrink-0 text-right font-mono text-[9px] tabular-nums" aria-label="ClipM 直接评分数值">{draftScore}</output>
      <button
        type="button"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-50"
        aria-label={`打开 ${entry.name} 的完整 ClipM 评分编辑`}
        title="打开完整评分编辑"
        disabled={pending}
        onClick={onOpen}
      >
        <Pencil className="size-3" />
      </button>
    </div>
  )
}

export function folderEntrySupportsClipm(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "directoryEmpty">): boolean {
  if (entry.kind === "directory") return entry.directoryEmpty !== true
  return entry.kind === "file" && CLIPM_ARCHIVE_EXTENSIONS.has(folderEntryExtension(entry.name))
}
