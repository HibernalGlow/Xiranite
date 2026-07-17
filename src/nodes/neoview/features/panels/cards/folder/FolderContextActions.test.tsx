import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContextMenuProvider } from "@/components/context-menu"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderContextActions, { buildFolderContextMenuItems, folderContextEntry } from "./FolderContextActions"

afterEach(cleanup)

describe("FolderContextActions", () => {
  it("[neoview.folder.context-actions] exposes Explorer-style directory actions through one builder", async () => {
    const copyText = vi.fn(async () => undefined)
    const openSystemPath = vi.fn(async () => undefined)
    const revealSystemPath = vi.fn(async () => undefined)
    const onActivate = vi.fn()
    const onOpenInNewTab = vi.fn()
    const onOpenAsBook = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ openSystemPath, revealSystemPath })}
          disabled={false}
          copyText={copyText}
          onActivate={onActivate}
          onOpenInNewTab={onOpenInNewTab}
          onOpenAsBook={onOpenAsBook}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="4"
          data-folder-path="D:/library/series"
          data-folder-name="series"
          data-folder-kind="directory"
          data-folder-reader-supported="false"
        >series</button>
      </ContextMenuProvider>,
    )
    const target = screen.getByRole("button", { name: "series" })

    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 })
    expect(await screen.findByText("在新标签页中打开")).toBeTruthy()
    expect(screen.getByText("作为书籍打开")).toBeTruthy()
    await user.click(screen.getByText("在新标签页中打开"))
    expect(onOpenInNewTab).toHaveBeenCalledWith("D:/library/series")

    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 })
    await user.click(await screen.findByText("复制路径"))
    expect(copyText).toHaveBeenCalledWith("D:/library/series")
    expect((await screen.findByRole("status")).textContent).toContain("已复制 series 的路径")

    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 })
    await user.click(await screen.findByText("在资源管理器中显示"))
    expect(revealSystemPath).toHaveBeenCalledWith("D:/library/series", expect.any(AbortSignal))
  })

  it("[neoview.folder.context-system-open] routes unsupported files through the authenticated platform action", async () => {
    const openSystemPath = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ openSystemPath })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
          onOpenAsBook={vi.fn()}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="1"
          data-folder-path="D:/library/readme.txt"
          data-folder-name="readme.txt"
          data-folder-kind="file"
          data-folder-reader-supported="false"
        >readme.txt</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "readme.txt" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByText("打开", { exact: true }))
    await waitFor(() => expect(openSystemPath).toHaveBeenCalledWith("D:/library/readme.txt", expect.any(AbortSignal)))
  })

  it("[neoview.folder.context-data] rejects incomplete DOM payloads and preserves capability disabled states", () => {
    expect(folderContextEntry({ folderIndex: "x", folderPath: "D:/x", folderName: "x", folderKind: "file" })).toBeUndefined()
    const items = buildFolderContextMenuItems({ index: 0, path: "D:/x.cbz", name: "x.cbz", kind: "file", readerSupported: true }, {
      disabled: false,
      pending: false,
      canCopyText: false,
      canOpenSystem: false,
      canReveal: false,
      canOpenAsBook: false,
      canBookmark: false,
      canRename: false,
      canTrash: false,
      onAction: vi.fn(),
    })
    expect(items.find((item) => item.id === "neoview-folder-open")?.disabled).toBe(false)
    expect(items.find((item) => item.id === "neoview-folder-system-open")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-reveal")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-copy-path")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-add-bookmark")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-rename")?.disabled).toBe(true)
  })

  it("[neoview.folder.bookmark-context] adds the concrete context target with the correct bookmark kind", async () => {
    const saveBookmark = vi.fn(async (bookmark) => ({
      id: "bookmark-1",
      source: bookmark.source,
      name: bookmark.name,
      kind: bookmark.kind ?? "file",
      starred: false,
      createdAt: 1,
      updatedAt: 1,
      listIds: [],
    }))
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ saveBookmark })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="4"
          data-folder-path="D:/library/series"
          data-folder-name="series"
          data-folder-kind="directory"
          data-folder-reader-supported="false"
        >series</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "series" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "添加到书签" }))

    await waitFor(() => expect(saveBookmark).toHaveBeenCalledWith({
      source: { kind: "path", path: "D:/library/series" },
      name: "series",
      kind: "folder",
    }, expect.any(AbortSignal)))
    expect((await screen.findByRole("status")).textContent).toContain("已将 series 添加到书签")
  })

  it("[neoview.folder.bookmark-file-kind] maps files without using the current reader source", async () => {
    const saveBookmark = vi.fn(async (bookmark) => ({
      id: "bookmark-2",
      source: bookmark.source,
      name: bookmark.name,
      kind: bookmark.kind ?? "file",
      starred: false,
      createdAt: 1,
      updatedAt: 1,
      listIds: [],
    }))
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ saveBookmark })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="2"
          data-folder-path="D:/library/target.cbz"
          data-folder-name="target.cbz"
          data-folder-kind="file"
          data-folder-reader-supported="true"
        >target.cbz</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "target.cbz" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "添加到书签" }))
    await waitFor(() => expect(saveBookmark).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: "path", path: "D:/library/target.cbz" },
      kind: "file",
    }), expect.any(AbortSignal)))
  })

  it("[neoview.folder.trash-context] confirms recycle-bin deletion and refreshes the browser", async () => {
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "D:/library/old.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 0,
    }))
    const onTrashed = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ executeFileOperations })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
          onTrashed={onTrashed}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="0"
          data-folder-path="D:/library/old.cbz"
          data-folder-name="old.cbz"
          data-folder-kind="file"
          data-folder-reader-supported="true"
        >old.cbz</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "old.cbz" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "移到回收站" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    expect(screen.getByText(/NeoView 无法直接撤销/)).toBeTruthy()
    expect(executeFileOperations).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "移到回收站" }))

    await waitFor(() => expect(executeFileOperations).toHaveBeenCalledWith(
      [{ kind: "trash", sourcePath: "D:/library/old.cbz" }],
      true,
      expect.any(AbortSignal),
    ))
    expect(onTrashed).toHaveBeenCalledWith(expect.objectContaining({ path: "D:/library/old.cbz" }))
    expect((await screen.findByRole("status")).textContent).toContain("已将 old.cbz 移到回收站")
  })

  it("[neoview.folder.trash-failure] keeps the item and reports platform failures", async () => {
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "D:/library/locked.cbz" }, status: "failed" as const, errorCode: "EACCES" }],
      succeeded: 0, failed: 1, cancelled: 0, undoable: 0,
    }))
    const onTrashed = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ executeFileOperations })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
          onTrashed={onTrashed}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="0"
          data-folder-path="D:/library/locked.cbz"
          data-folder-name="locked.cbz"
          data-folder-kind="file"
          data-folder-reader-supported="true"
        >locked.cbz</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "locked.cbz" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "移到回收站" }))
    await user.click(screen.getByRole("button", { name: "移到回收站" }))
    expect((await screen.findByRole("alert")).textContent).toContain("没有权限")
    expect(onTrashed).not.toHaveBeenCalled()
  })

  it("[neoview.folder.trash-refresh-failure] reports that trash succeeded when only refresh fails", async () => {
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "trash" as const, sourcePath: "D:/library/old.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 0,
    }))
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ executeFileOperations })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
          onTrashed={vi.fn(async () => { throw new Error("目录会话已关闭") })}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="0"
          data-folder-path="D:/library/old.cbz"
          data-folder-name="old.cbz"
          data-folder-kind="file"
          data-folder-reader-supported="true"
        >old.cbz</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "old.cbz" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "移到回收站" }))
    await user.click(screen.getByRole("button", { name: "移到回收站" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("已将 old.cbz 移到回收站，但列表刷新失败")
    expect(alert.textContent).toContain("请手动刷新")
    expect(alert.textContent).toContain("目录会话已关闭")
  })

  it("[neoview.folder.rename-context] opens the lazy rename dialog from the shared entry menu", async () => {
    const executeFileOperations = vi.fn(async () => ({
      results: [{ index: 0, operation: { kind: "rename" as const, sourcePath: "D:/library/old.cbz", destinationPath: "D:/library/new.cbz" }, status: "succeeded" as const }],
      succeeded: 1, failed: 0, cancelled: 0, undoable: 1,
    }))
    const onRenamed = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <FolderContextActions
          client={clientWith({ executeFileOperations })}
          disabled={false}
          onActivate={vi.fn()}
          onOpenInNewTab={vi.fn()}
          onRenamed={onRenamed}
        />
        <button
          data-context-menu="neoview-folder-entry"
          data-folder-index="0"
          data-folder-path="D:/library/old.cbz"
          data-folder-name="old.cbz"
          data-folder-kind="file"
          data-folder-reader-supported="true"
        >old.cbz</button>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "old.cbz" }), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }))
    const input = await screen.findByRole("textbox", { name: "新名称" })
    await user.clear(input)
    await user.type(input, "new.cbz")
    await user.click(screen.getByRole("button", { name: "重命名", exact: true }))
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("D:/library/new.cbz"))
  })
})

function clientWith(actions: Partial<Pick<ReaderHttpClient, "openSystemPath" | "revealSystemPath" | "saveBookmark" | "executeFileOperations">>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(),
    ...actions,
  }
}
