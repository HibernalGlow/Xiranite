import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { useRef } from "react"

import { ContextMenuProvider } from "@/components/context-menu"
import { getNodeConfigFromBackend, saveNodeConfigToBackend } from "@/backend/configRpcClient"
import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import type {
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import FolderContextActions from "./FolderContextActions"
import { FolderClipboardProvider } from "./FolderClipboard"
import FolderDeleteButton from "./FolderDeleteButton"
import FolderSelectionBar from "./FolderSelectionBar"
import { createDirectoryCatalog, type DirectoryCatalog } from "./DirectoryCatalog"
import { publishFolderEntryRemoved, publishFolderEntryRestored } from "./FolderNavigationEvents"
import { useFolderExternalDeletion } from "./useFolderExternalDeletion"

vi.mock("@/backend/nodeRpcClient", () => ({ runNodeOnLocalBackend: vi.fn() }))
vi.mock("@/backend/configRpcClient", () => ({ getNodeConfigFromBackend: vi.fn(), saveNodeConfigToBackend: vi.fn() }))

test("[neoview.folder.external-system-clipboard-gui] pastes files copied outside Xiranite into the current Neo directory", async () => {
  const entry = { index: 1, path: "D:\\Neo\\existing.cbz", name: "existing.cbz", kind: "file" as const, readerSupported: true }
  const executeFileOperations = vi.fn(async () => ({
    results: [], succeeded: 1, failed: 0, cancelled: 0, undoable: 1,
  }))
  const client = { executeFileOperations } as unknown as ReaderHttpClient
  const systemClipboard = {
    readFiles: vi.fn(async () => ({
      available: true,
      paths: ["E:\\Downloads\\outside.cbz"],
      effect: "move" as const,
    })),
    clearFiles: vi.fn(async () => true),
  }

  await render(
    <ContextMenuProvider>
      <FolderClipboardProvider client={client} systemClipboard={systemClipboard}>
        <FolderContextActions
          client={client}
          disabled={false}
          currentPath={"D:\\Neo"}
          currentSourceKind="directory"
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
        <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">{entry.name}</button>
      </FolderClipboardProvider>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: entry.name }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "粘贴到当前文件夹", exact: true }).click()
  await expect.poll(() => executeFileOperations).toHaveBeenCalledWith([{
    kind: "move",
    sourcePath: "E:\\Downloads\\outside.cbz",
    destinationPath: "D:\\Neo\\outside.cbz",
  }], false)
  await expect.poll(() => systemClipboard.clearFiles).toHaveBeenCalledOnce()
})

test("[neoview.folder.system-file-clipboard-gui] writes right-click copy and cut to the host file clipboard", async () => {
  const entry = { index: 7, path: "D:/library/book.cbz", name: "book.cbz", kind: "file" as const, readerSupported: true }
  const prepareDirectoryClipboard = vi.fn(async (_sessionId, _selection, mode: "copy" | "move") => ({
    available: true as const,
    mode,
    generation: 3,
    total: 1,
    createdAt: 1,
  }))
  const copyFiles = vi.fn(async () => undefined)
  const client = { prepareDirectoryClipboard } as unknown as ReaderHttpClient

  await render(
    <ContextMenuProvider>
      <FolderClipboardProvider client={client}>
        <FolderContextActions
          client={client}
          disabled={false}
          copyFiles={copyFiles}
          sessionId="browser-1"
          generation={3}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
        <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">{entry.name}</button>
      </FolderClipboardProvider>
    </ContextMenuProvider>,
  )

  const target = page.getByRole("button", { name: entry.name })
  await target.click({ button: "right" })
  await page.getByRole("menuitem", { name: "复制", exact: true }).click()
  await expect.poll(() => copyFiles).toHaveBeenNthCalledWith(1, [entry.path], { effect: "copy" })
  await expect.poll(() => prepareDirectoryClipboard).toHaveBeenNthCalledWith(1, "browser-1", expect.objectContaining({
    explicit: [{ path: entry.path, index: entry.index }],
  }), "copy")

  await target.click({ button: "right" })
  await page.getByRole("menuitem", { name: "剪切", exact: true }).click()
  await expect.poll(() => copyFiles).toHaveBeenNthCalledWith(2, [entry.path], { effect: "move" })
  await expect.poll(() => prepareDirectoryClipboard).toHaveBeenNthCalledWith(2, "browser-1", expect.objectContaining({
    explicit: [{ path: entry.path, index: entry.index }],
  }), "move")
})

test("[neoview.folder.classf-blacklist-gui] pre-fills a SameA label and persists the approved quick edit to ClassF", async () => {
  const entry = { index: 0, path: "D:/library/[きゅうりのふかづめ (しぐれに)] review.cbz", name: "[きゅうりのふかづめ (しぐれに)] review.cbz", kind: "file" as const, readerSupported: true }
  const copyText = vi.fn(async () => undefined)
  vi.mocked(getNodeConfigFromBackend).mockResolvedValueOnce({ config: { blacklistKeywords: ["[OgoG]"] }, path: "D:/config/xiranite.config.toml" })

  await render(
    <ContextMenuProvider>
      <FolderContextActions client={{} as ReaderHttpClient} copyText={copyText} disabled={false} onActivate={vi.fn()} onOpenInNewTab={vi.fn()} />
      <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">{entry.name}</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: entry.name }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "加入 ClassF 黑名单" }).click()
  await expect.element(page.getByText(entry.name, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "复制文件名" }).click()
  await expect.poll(() => copyText).toHaveBeenCalledWith(entry.name)
  const draft = page.getByRole("textbox", { name: "classf blacklist quick add" })
  await expect.element(draft).toHaveValue("[きゅうりのふかづめ (しぐれに)]")
  await page.getByRole("button", { name: "拆分社团与作者" }).click()
  await expect.element(draft).toHaveValue("[きゅうりのふかづめ]\n[しぐれに]")
  await page.getByRole("button", { name: "保存到 ClassF 黑名单" }).click()

  await expect.poll(() => saveNodeConfigToBackend).toHaveBeenCalledWith("classf", {
    blacklistKeywords: ["[OgoG]", "[きゅうりのふかづめ]", "[しぐれに]"],
  })
})

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

test("[neoview.folder.dissolve-directory-gui] confirms and runs the dissolve action for the selected folder", async () => {
  const onRefreshDirectory = vi.fn(async () => undefined)
  const entry = { index: 0, path: "D:/library/series", name: "series", kind: "directory" as const, readerSupported: true }
  vi.mocked(runNodeOnLocalBackend).mockResolvedValueOnce({ success: true, message: "Dissolved." })

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{} as ReaderHttpClient}
        disabled={false}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onRefreshDirectory={onRefreshDirectory}
      />
      <button
        data-context-menu="neoview-folder-entry"
        data-folder-index={entry.index}
        data-folder-path={entry.path}
        data-folder-name={entry.name}
        data-folder-kind={entry.kind}
        data-folder-reader-supported="true"
      >series</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "series" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "解散当前文件夹" }).click()
  await page.getByRole("button", { name: "解散当前文件夹", exact: true }).click()

  await expect.poll(() => runNodeOnLocalBackend).toHaveBeenCalledWith("dissolvef", {
    action: "direct",
    path: entry.path,
    preview: false,
  })
  await expect.poll(() => onRefreshDirectory).toHaveBeenCalledOnce()
  await expect.element(page.getByRole("status")).toHaveTextContent("已解散 series")
})

test("[neoview.folder.migratef-gui] picks a destination and delegates the entry move to MigrateF", async () => {
  const pickDirectory = vi.fn(async () => "E:/archive")
  const onRefreshDirectory = vi.fn(async () => undefined)
  const entry = { index: 0, path: "D:/library/book.cbz", name: "book.cbz", kind: "file" as const, readerSupported: true }
  vi.mocked(runNodeOnLocalBackend).mockResolvedValueOnce({
    success: true,
    message: "Moved.",
    data: { migratedCount: 1 },
  })

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{} as ReaderHttpClient}
        disabled={false}
        pickDirectory={pickDirectory}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onRefreshDirectory={onRefreshDirectory}
      />
      <button
        data-context-menu="neoview-folder-entry"
        data-folder-index={entry.index}
        data-folder-path={entry.path}
        data-folder-name={entry.name}
        data-folder-kind={entry.kind}
        data-folder-reader-supported="true"
      >book.cbz</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "book.cbz" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "迁移到指定目录" }).hover()
  await page.getByRole("menuitem", { name: "选择其他目录…" }).click()

  await expect.poll(() => pickDirectory).toHaveBeenCalledOnce()
  await expect.poll(() => runNodeOnLocalBackend).toHaveBeenCalledWith("migratef", {
    action: "move",
    mode: "direct",
    sourcePaths: [entry.path],
    targetPath: "E:/archive",
    dryRun: false,
  })
  await expect.poll(() => onRefreshDirectory).toHaveBeenCalledOnce()
  await expect.element(page.getByRole("status")).toHaveTextContent("已将 book.cbz 迁移到 E:/archive")
})

test("[neoview.folder.migratef-quick-target-gui] moves directly to a saved migration target", async () => {
  const onRefreshDirectory = vi.fn(async () => undefined)
  const entry = { index: 0, path: "D:/library/book.cbz", name: "book.cbz", kind: "file" as const, readerSupported: true }
  vi.mocked(runNodeOnLocalBackend).mockResolvedValueOnce({ success: true, message: "Moved.", data: { migratedCount: 1 } })

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{} as ReaderHttpClient}
        disabled={false}
        migrationTargets={[{ id: "archive", name: "归档", path: "E:/archive" }]}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
        onRefreshDirectory={onRefreshDirectory}
      />
      <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">book.cbz</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "book.cbz" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "迁移到指定目录" }).hover()
  await page.getByRole("menuitem", { name: "归档" }).click()

  await expect.poll(() => runNodeOnLocalBackend).toHaveBeenCalledWith("migratef", {
    action: "move",
    mode: "direct",
    sourcePaths: [entry.path],
    targetPath: "E:/archive",
    dryRun: false,
  })
  await expect.poll(() => onRefreshDirectory).toHaveBeenCalledOnce()
})

test("[neoview.folder.migration-targets-gui] adds, renames, and persists ordered quick targets", async () => {
  const pickDirectory = vi.fn(async () => "F:/Finished")
  const onMigrationTargetsChange = vi.fn(async () => undefined)
  const entry = { index: 0, path: "D:/library/book.cbz", name: "book.cbz", kind: "file" as const, readerSupported: true }

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{} as ReaderHttpClient}
        disabled={false}
        pickDirectory={pickDirectory}
        migrationTargets={[{ id: "archive", name: "归档", path: "E:/archive" }]}
        onMigrationTargetsChange={onMigrationTargetsChange}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
      />
      <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">book.cbz</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "book.cbz" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "迁移到指定目录" }).hover()
  await page.getByRole("menuitem", { name: "管理常用目录…" }).click()
  await page.getByRole("textbox", { name: "目录名称 1" }).fill("已归档")
  await page.getByRole("button", { name: "添加目录" }).click()
  await expect.element(page.getByRole("textbox", { name: "目录名称 2" })).toHaveValue("Finished")
  await page.getByRole("button", { name: "保存", exact: true }).click()

  await expect.poll(() => onMigrationTargetsChange).toHaveBeenCalledWith([
    { id: "archive", name: "已归档", path: "E:/archive" },
    { id: expect.any(String), name: "Finished", path: "F:/Finished" },
  ])
})

test("[neoview.folder.migration-cancel-gui] leaves files and target settings untouched when selection or editing is cancelled", async () => {
  vi.mocked(runNodeOnLocalBackend).mockClear()
  const pickDirectory = vi.fn(async () => undefined)
  const onMigrationTargetsChange = vi.fn(async () => undefined)
  const entry = { index: 0, path: "D:/library/book.cbz", name: "book.cbz", kind: "file" as const, readerSupported: true }

  await render(
    <ContextMenuProvider>
      <FolderContextActions
        client={{} as ReaderHttpClient}
        disabled={false}
        pickDirectory={pickDirectory}
        migrationTargets={[{ id: "archive", name: "归档", path: "E:/archive" }]}
        onMigrationTargetsChange={onMigrationTargetsChange}
        onActivate={vi.fn()}
        onOpenInNewTab={vi.fn()}
      />
      <button data-context-menu="neoview-folder-entry" data-folder-index={entry.index} data-folder-path={entry.path} data-folder-name={entry.name} data-folder-kind={entry.kind} data-folder-reader-supported="true">book.cbz</button>
    </ContextMenuProvider>,
  )

  await page.getByRole("button", { name: "book.cbz" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "迁移到指定目录" }).hover()
  await page.getByRole("menuitem", { name: "选择其他目录…" }).click()
  await expect.poll(() => pickDirectory).toHaveBeenCalledOnce()
  expect(runNodeOnLocalBackend).not.toHaveBeenCalled()

  await page.getByRole("button", { name: "book.cbz" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "迁移到指定目录" }).hover()
  await page.getByRole("menuitem", { name: "管理常用目录…" }).click()
  await page.getByRole("textbox", { name: "目录名称 1" }).fill("未保存")
  await page.getByRole("button", { name: "取消", exact: true }).click()
  expect(onMigrationTargetsChange).not.toHaveBeenCalled()
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
