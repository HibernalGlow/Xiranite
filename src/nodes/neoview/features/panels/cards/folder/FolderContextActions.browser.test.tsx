import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useRef } from "react"

import { ContextMenuProvider } from "@/components/context-menu"
import type {
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import FolderContextActions from "./FolderContextActions"
import FolderDeleteButton from "./FolderDeleteButton"
import FolderSelectionBar from "./FolderSelectionBar"
import { createDirectoryCatalog, type DirectoryCatalog } from "./DirectoryCatalog"
import { publishFolderEntryRemoved, publishFolderEntryRestored } from "./FolderNavigationEvents"
import { useFolderExternalDeletion } from "./useFolderExternalDeletion"

test("[neoview.folder.current-delete-binding-gui] routes every File Card deletion through bindings", async () => {
  const executeFileOperations = vi.fn(async () => ({
    results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "D:/library/other.cbz" }, status: "succeeded" as const }],
    succeeded: 1,
    failed: 0,
    cancelled: 0,
    undoable: 1,
  }))
  const onDeleteThroughBinding = vi.fn(async () => sequenceResult())
  const entry = { index: 0, path: "D:/library/current.cbz", name: "current.cbz", kind: "file" as const, readerSupported: true }
  const other = { ...entry, index: 1, path: "D:/library/other.cbz", name: "other.cbz" }

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{ executeFileOperations } as unknown as ReaderHttpClient}
        disabled={false}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onDeleteThroughBinding={onDeleteThroughBinding}
      />
      <FolderDeleteButton entry={entry} strategy="trash" confirm />
      <FolderDeleteButton entry={entry} strategy="permanent" confirm />
      <FolderDeleteButton entry={other} strategy="trash" />
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "移到回收站：current.cbz" }).click()
  await page.getByRole("button", { name: "移到回收站", exact: true }).click()
  await expect.poll(() => onDeleteThroughBinding).toHaveBeenNthCalledWith(1, entry.path, "trash")

  await page.getByRole("button", { name: "永久删除：current.cbz" }).click()
  await page.getByRole("button", { name: "永久删除", exact: true }).click()
  await expect.poll(() => onDeleteThroughBinding).toHaveBeenNthCalledWith(2, entry.path, "delete")
  expect(executeFileOperations).not.toHaveBeenCalled()

  await page.getByRole("button", { name: "移到回收站：other.cbz" }).click()
  await expect.poll(() => onDeleteThroughBinding).toHaveBeenNthCalledWith(3, other.path, "trash")
  expect(executeFileOperations).not.toHaveBeenCalled()
})

test("[neoview.folder.optimistic-bound-delete-gui] removes the entry before a delayed binding settles", async () => {
  let resolveBinding!: (value: ReturnType<typeof sequenceResult>) => void
  const binding = new Promise<ReturnType<typeof sequenceResult>>((resolve) => { resolveBinding = resolve })
  const entry = { index: 0, path: "D:/library/current.cbz", name: "current.cbz", kind: "file" as const, readerSupported: true }
  const onDeleteStarted = vi.fn()
  const executeFileOperations = vi.fn(async () => successfulTrash(entry.path))
  const onDeleteThroughBinding = vi.fn(() => binding)

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{ executeFileOperations } as unknown as ReaderHttpClient}
        disabled={false}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onDeleteThroughBinding={onDeleteThroughBinding}
        onDeleteStarted={onDeleteStarted}
      />
      <FolderDeleteButton entry={entry} strategy="trash" />
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "移到回收站：current.cbz" }).click()
  await expect.poll(() => onDeleteStarted).toHaveBeenCalledWith(expect.objectContaining(entry))
  expect(onDeleteThroughBinding).toHaveBeenCalledWith(entry.path, "trash")
  expect(executeFileOperations).not.toHaveBeenCalled()

  resolveBinding(sequenceResult())
  await expect.poll(() => onDeleteThroughBinding).toHaveBeenCalledOnce()
  expect(executeFileOperations).not.toHaveBeenCalled()
})

test("[neoview.folder.missing-delete-binding-result-gui] restores the entry without falling back to direct deletion", async () => {
  const entry = { index: 0, path: "D:/library/direct.cbz", name: "direct.cbz", kind: "file" as const, readerSupported: true }
  const onDeleteStarted = vi.fn()
  const onDeleteFailed = vi.fn(async () => undefined)
  const executeFileOperations = vi.fn(async () => successfulTrash(entry.path))

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{ executeFileOperations } as unknown as ReaderHttpClient}
        disabled={false}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onDeleteThroughBinding={async () => undefined}
        onDeleteStarted={onDeleteStarted}
        onDeleteFailed={onDeleteFailed}
      />
      <FolderDeleteButton entry={entry} strategy="trash" />
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "移到回收站：direct.cbz" }).click()
  await expect.poll(() => onDeleteStarted).toHaveBeenCalledWith(expect.objectContaining(entry))
  await expect.poll(() => onDeleteFailed).toHaveBeenCalledWith(expect.objectContaining(entry))
  expect(executeFileOperations).not.toHaveBeenCalled()
})

test("[neoview.folder.optimistic-bound-delete-failure-gui] refreshes the optimistic removal when the binding fails", async () => {
  const entry = { index: 0, path: "D:/library/broken.cbz", name: "broken.cbz", kind: "file" as const, readerSupported: true }
  const onDeleteStarted = vi.fn()
  const onDeleteFailed = vi.fn(async () => undefined)
  const executeFileOperations = vi.fn()

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{ executeFileOperations } as unknown as ReaderHttpClient}
        disabled={false}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onDeleteThroughBinding={async () => failedSequenceResult(new Error("backend unavailable"))}
        onDeleteStarted={onDeleteStarted}
        onDeleteFailed={onDeleteFailed}
      />
      <FolderDeleteButton entry={entry} strategy="trash" />
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "移到回收站：broken.cbz" }).click()
  await expect.poll(() => onDeleteStarted).toHaveBeenCalledWith(expect.objectContaining(entry))
  await expect.poll(() => onDeleteFailed).toHaveBeenCalledWith(expect.objectContaining(entry))
  await expect.element(page.getByRole("alert")).toHaveTextContent("backend unavailable")
  expect(executeFileOperations).not.toHaveBeenCalled()
})

test("[neoview.folder.deletion-events-gui] removes a deleted entry locally and refreshes its restored path", async () => {
  const events = new EventTarget()
  const catalog = createDirectoryCatalog(directoryPage())
  const commitCatalog = vi.fn()
  const navigate = vi.fn(async () => undefined)

  await render(
    <ExternalDeletionHarness
      events={events}
      catalog={catalog}
      commitCatalog={commitCatalog}
      navigate={navigate}
    />,
  )

  publishFolderEntryRemoved(events, "D:/library/current.cbz")
  await expect.poll(() => commitCatalog).toHaveBeenCalledOnce()
  expect(commitCatalog.mock.calls[0]?.[0]).toMatchObject({ total: 1 })
  await expect.poll(() => navigate).toHaveBeenNthCalledWith(
    1,
    { action: "refresh" },
    { keepTree: true, focusPath: "D:/library/other.cbz", preserveThumbnailCache: true },
  )

  publishFolderEntryRestored(events, "D:/library/current.cbz")
  await expect.poll(() => navigate).toHaveBeenNthCalledWith(
    2,
    { action: "refresh" },
    { keepTree: true, focusPath: "D:/library/current.cbz", preserveThumbnailCache: true },
  )
})

test("[neoview.folder.undo-coordinator-gui] routes selection-bar undo through the shared transaction coordinator", async () => {
  const running = selectionOperation({ status: "running" })
  const completed = selectionOperation({ status: "completed", processed: 1, succeeded: 1 })
  const client = {
    startDirectorySelectionOperation: vi.fn(async () => running),
    directorySelectionOperation: vi.fn(async () => completed),
    fileUndoState: vi.fn(async () => ({
      available: true,
      count: 1,
      latestId: "undo-1",
      supportedKinds: ["trash" as const],
      trashRestore: true,
      persistent: true,
    })),
  } as unknown as ReaderHttpClient
  const onUndoFileDeletion = vi.fn(async () => ({
    undoId: "undo-1",
    results: [],
    succeeded: 1,
    failed: 0,
    remaining: 0,
  }))

  await render(
    <ContextMenuProvider>
      <FolderSelectionBar
        client={client}
        sessionId="browser-1"
        selection={{ generation: 7, allSelected: false, ranges: [], explicit: [{ path: "D:/library/current.cbz", index: 0 }] }}
        selectedCount={1}
        total={1}
        currentPath="D:/library"
        disabled={false}
        chainSelectMode={false}
        clickBehavior="select"
        confirmations={{ trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true }}
        onSelectAll={vi.fn()}
        onInvert={vi.fn()}
        onToggleChain={vi.fn()}
        onToggleClickBehavior={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onTrashCompleted={vi.fn()}
        onUndoFileDeletion={onUndoFileDeletion}
      />
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "将所选项目移到回收站" }).click()
  const undo = page.getByRole("button", { name: "撤销上次移到回收站" })
  await expect.element(undo).toBeVisible()
  await undo.click()
  await expect.poll(() => onUndoFileDeletion).toHaveBeenCalledOnce()
})

function ExternalDeletionHarness({
  events,
  catalog,
  commitCatalog,
  navigate,
}: {
  events: EventTarget
  catalog: DirectoryCatalog
  commitCatalog(catalog: DirectoryCatalog): void
  navigate(navigation: ReaderDirectoryNavigationDto, options?: { keepTree?: boolean; focusPath?: string; preserveThumbnailCache?: boolean }): Promise<void>
}) {
  const catalogRef = useRef<DirectoryCatalog | undefined>(catalog)
  const focusedIndexRef = useRef<number | undefined>(0)
  useFolderExternalDeletion({
    events,
    enabled: true,
    catalogRef,
    sourcePath: "D:/library/current.cbz",
    focusedPath: "D:/library/current.cbz",
    focusedIndexRef,
    commitCatalog,
    setFocusedIndex: () => undefined,
    setFocusedPath: () => undefined,
    setSelection: () => undefined,
    navigate,
  })
  return null
}

function directoryPage(): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-directory-1",
    navigationEntryId: 1,
    path: "D:/library",
    entries: [
      { index: 0, path: "D:/library/current.cbz", name: "current.cbz", kind: "file", readerSupported: true },
      { index: 1, path: "D:/library/other.cbz", name: "other.cbz", kind: "file", readerSupported: true },
    ],
    cursor: 0,
    total: 2,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "date", "size", "type", "random", "path"],
    metadataFields: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    watching: false,
  }
}

function selectionOperation(
  overrides: Partial<ReaderDirectorySelectionOperationSnapshotDto>,
): ReaderDirectorySelectionOperationSnapshotDto {
  return {
    id: "operation-1",
    kind: "trash",
    status: "running",
    generation: 7,
    total: 1,
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    failureSamples: [],
    failureSamplesTruncated: false,
    startedAt: 1,
    ...overrides,
  }
}

function sequenceResult() {
  return {
    bindingId: "system-file-card",
    status: "succeeded" as const,
    completedActions: 1,
    action: "file.delete-current" as const,
    outcome: { status: "succeeded" as const },
  }
}

function failedSequenceResult(error: Error) {
  return {
    bindingId: "system-file-card",
    status: "failed" as const,
    completedActions: 0,
    action: "file.delete-current" as const,
    outcome: { status: "failed" as const, error },
  }
}

function successfulTrash(sourcePath: string) {
  return {
    results: [{ index: 0, operation: { kind: "trash" as const, sourcePath }, status: "succeeded" as const }],
    succeeded: 1,
    failed: 0,
    cancelled: 0,
    undoable: 1,
  }
}
