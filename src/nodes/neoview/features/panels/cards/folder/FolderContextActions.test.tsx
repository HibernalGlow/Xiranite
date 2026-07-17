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
      onAction: vi.fn(),
    })
    expect(items.find((item) => item.id === "neoview-folder-open")?.disabled).toBe(false)
    expect(items.find((item) => item.id === "neoview-folder-system-open")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-reveal")?.disabled).toBe(true)
    expect(items.find((item) => item.id === "neoview-folder-copy-path")?.disabled).toBe(true)
  })
})

function clientWith(actions: Pick<ReaderHttpClient, "openSystemPath" | "revealSystemPath">): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(),
    ...actions,
  }
}
