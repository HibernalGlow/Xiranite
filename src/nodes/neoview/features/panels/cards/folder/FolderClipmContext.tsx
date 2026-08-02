import { parseClipmFilenameScore } from "@xiranite/node-clipm/filename"
import { createContext, useContext, type MouseEvent, type ReactNode } from "react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { folderEntryExtension } from "./FolderEntryPresentation"

export interface FolderClipmContextValue {
  openWork(entry: ReaderDirectoryEntryDto): void
  pendingPath?: string
}

const FolderClipmContext = createContext<FolderClipmContextValue | undefined>(undefined)
const CLIPM_ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "cbz", "cbr"])

export function FolderClipmProvider({ value, children }: { value: FolderClipmContextValue; children: ReactNode }) {
  return <FolderClipmContext.Provider value={value}>{children}</FolderClipmContext.Provider>
}

export function FolderClipmBadge({ entry, className = "" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  const controller = useContext(FolderClipmContext)
  if (!controller || !folderEntrySupportsClipm(entry)) return null
  const rating = entry.clipmScore
    ? { label: entry.clipmScore.label, score: entry.clipmScore.score, version: BigInt(entry.clipmScore.bundleVersion), shortCode: entry.clipmScore.shortCode }
    : parseClipmFilenameScore(entry.name)
  const aggregate = entry.kind === "directory"
  const pending = controller.pendingPath === entry.path
  const label = rating ? `CM ${rating.label} ${rating.score}` : "CM --"
  const tooltip = rating
    ? `${aggregate ? "文件夹内最高 " : ""}ClipM ${rating.label} · ${rating.score.toString().padStart(4, "0")}/1000 · 模型 v${rating.version}${rating.shortCode ? ` · ${rating.shortCode}` : ""}`
    : aggregate ? "文件夹内尚无 ClipM 评分" : "尚未评分，点击使用 ClipM 评分"
  const tone = rating?.label === "P"
    ? "border-emerald-600/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : rating?.label === "N"
      ? "border-rose-600/50 bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : "border-border bg-background/90 text-muted-foreground"

  const stop = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const badgeClass = `inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold tabular-nums shadow-sm backdrop-blur-sm ${tone} ${className}`
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

export function folderEntrySupportsClipm(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "directoryEmpty">): boolean {
  if (entry.kind === "directory") return entry.directoryEmpty !== true
  return entry.kind === "file" && CLIPM_ARCHIVE_EXTENSIONS.has(folderEntryExtension(entry.name))
}
