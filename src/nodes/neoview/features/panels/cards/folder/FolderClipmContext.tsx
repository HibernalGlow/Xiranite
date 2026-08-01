import { parseReaderCmRating } from "@xiranite/node-neoview/ui-core"
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
  const rating = parseReaderCmRating(entry.name)
  const pending = controller.pendingPath === entry.path
  const label = rating ? `CM ${rating.label} ${rating.score}` : "CM --"
  const tooltip = rating
    ? `ClipM ${rating.label} · ${rating.score.toString().padStart(4, "0")}/1000 · 模型 v${rating.version}${rating.shortCode ? ` · ${rating.shortCode}` : ""}`
    : "尚未评分，点击使用 ClipM 评分"
  const tone = rating?.label === "P"
    ? "border-emerald-600/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : rating?.label === "N"
      ? "border-rose-600/50 bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : "border-border bg-background/90 text-muted-foreground"

  const stop = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <button
      type="button"
      className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold tabular-nums shadow-sm backdrop-blur-sm hover:brightness-95 disabled:cursor-wait disabled:opacity-70 ${tone} ${className}`}
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
