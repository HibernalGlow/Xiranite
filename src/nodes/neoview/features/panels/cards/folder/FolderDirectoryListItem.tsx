import { type MouseEvent as ReactMouseEvent } from "react"
import { type ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../../thumbnails/ReaderThumbnailSurface"
import { FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata } from "./FolderEntryPresentation"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { FolderPenetrationFileNames, type FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import FolderDeleteButton, { type FolderDeleteStrategy } from "./FolderDeleteButton"
import { type FolderViewMode } from "./FolderBrowserState"
import { folderThumbnailIsLoading, type FolderThumbnailStore } from "./FolderThumbnailStore"
import { useFolderThumbnail } from "./useFolderThumbnail"
import { folderTitleClassName } from "./FolderViewPresentation"

export function DirectoryListItem({
  itemId,
  entry,
  index,
  disabled,
  selected,
  focused,
  showRating,
  showCollectTagCount,
  visualMode,
  thumbnailStore,
  thumbnailUrl,
  thumbnailUrls,
  contentWidthPercent,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  wrapTitle = false,
  penetrationFiles,
  deleteMode,
  deleteStrategy,
  confirmDelete,
  onSelect,
}: DirectoryItemProps & {
  visualMode: FolderViewMode
  thumbnailStore?: FolderThumbnailStore
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  contentWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  wrapTitle?: boolean
  penetrationFiles?: readonly FolderPenetrationFileName[]
  deleteMode: boolean
  deleteStrategy: FolderDeleteStrategy
  confirmDelete: boolean
}) {
  const rich = visualMode !== "compact"
  const thumbnailEligible = Boolean(rich && entry && (entry.kind === "directory" || entry.readerSupported))
  const storedThumbnail = useFolderThumbnail(thumbnailStore, entry?.path, thumbnailEligible)
  const resolvedThumbnailUrl = thumbnailStore ? storedThumbnail.thumbnailUrl : thumbnailUrl
  const resolvedThumbnailUrls = thumbnailStore ? storedThumbnail.thumbnailUrls : thumbnailUrls
  const thumbnailLoading = Boolean(thumbnailStore && folderThumbnailIsLoading(storedThumbnail.availability))
  if (!entry) return <div className={`${rich ? "h-[76px]" : "h-[34px]"} animate-pulse border-b bg-muted/30`} aria-hidden="true" />
  return (
    <FolderHoverPreview thumbnailUrl={resolvedThumbnailUrl} enabled={hoverPreviewEnabled && rich} delayMs={hoverPreviewDelayMs} label={entry.name}>
      <div className="relative">
        {deleteMode ? (
          <FolderDeleteButton entry={{ index, ...entry }} strategy={deleteStrategy} disabled={disabled} placement="leading" confirm={confirmDelete} />
        ) : null}
        <button
          id={itemId}
          type="button"
          className={`flex w-full items-center gap-2 border-b pr-2 text-left text-xs hover:bg-muted aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary ${deleteMode ? "pl-9" : "pl-2"} ${rich ? "min-h-[76px] py-1.5" : wrapTitle || penetrationFiles?.length ? "min-h-[34px] py-1" : "h-[34px]"}`}
          aria-selected={selected}
          data-focused={focused || undefined}
          disabled={disabled}
          title={entry.path}
          onClick={(event) => onSelect(entry, index, event)}
          tabIndex={-1}
          data-preview-mode={visualMode}
          data-folder-entry="true"
          data-context-menu="neoview-folder-entry"
          data-folder-index={index}
          data-folder-path={entry.path}
          data-folder-name={entry.name}
          data-folder-kind={entry.kind}
          data-folder-reader-supported={entry.readerSupported}
        >
          {rich ? (
            <span
              className="grid h-16 shrink-0 place-items-center overflow-hidden rounded bg-muted/30"
              style={{ width: `${contentWidthPercent}%`, maxWidth: "70%" }}
            >
              {resolvedThumbnailUrl || thumbnailLoading ? (
                <ReaderThumbnailSurface
                  url={resolvedThumbnailUrl}
                  urls={resolvedThumbnailUrls}
                  kind={entry.kind === "directory" ? "folder" : "file"}
                  fit="contain"
                  imageLoading="eager"
                  loading={thumbnailLoading}
                  className="size-full rounded-none bg-transparent"
                />
              ) : entry.kind === "directory" ? null : (
                <FolderEntryIcon entry={entry} className="size-7" />
              )}
            </span>
          ) : (
            <FolderEntryIcon entry={entry} />
          )}
          <span className="grid min-w-0 flex-1 gap-1">
            <span className={folderTitleClassName(wrapTitle)} data-folder-entry-title-wrap={wrapTitle || undefined}>{entry.name}</span>
            {rich ? <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span> : null}
            {rich ? <FolderEntryFileMetadata entry={entry} /> : null}
            <FolderPenetrationFileNames files={penetrationFiles} />
          </span>
          <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
        </button>
      </div>
    </FolderHoverPreview>
  )
}
export interface DirectoryItemProps {
  itemId: string
  entry?: ReaderDirectoryEntryDto
  index: number
  disabled: boolean
  selected: boolean
  focused: boolean
  showRating: boolean
  showCollectTagCount: boolean
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}
export function folderEntryName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).at(-1) || normalized || path
}
