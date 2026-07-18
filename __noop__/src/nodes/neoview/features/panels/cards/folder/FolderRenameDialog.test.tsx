import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderRenameDialog, {
  renameEditableRange,
  siblingPath,
  validateFolderEntryName,
} from "./FolderRenameDialog"

afterEach(cleanup)

describe("FolderRenameDialog", () => {
  it("[neoview.folder.rename-validation] preserves the extension edit range and validates Windows names", () => {
    expect(renameEditableRange("archive.part.cbz", "file")).toEqual([0, 12])
    expect(renameEditableRange("folder.name", "directory")).toEqual([0, 11])
    expect(siblingPath("D:\\library\\old.cbz", "new.cbz")).toBe("D:\\library\\new.cbz")
    expect(siblingPath("/library/old.cbz", "new.cbz")).toBe("/library/new.cbz")
    expect(validateFolderEntryName("CON.txt", "D:/library/old.txt")).toContain("保留名称")
    expect(validateFolderEntryName("bad?.txt", "D:/library/old.txt")).toContain("不允许的字符")
    expect(validateFolderEntryName("valid?.txt", "/library/old.txt")).toBeUndefined()
  })

  it("[neoview.folder.rename-ui] submits one non-overwriting transaction and returns the destination path", async () => {
    const executeFileOperations = vi.fn(async () => successfulRename())
    const onRenamed = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <FolderRenameDialog
        client={clientWith(executeFileOperations)}
        entry={{ path: "D:/library/old.cbz", name: "old.cbz", kind: "file" }}
        onClose={onClose}
        onRenamed={onRenamed}
      />,
    )

    const input = await screen.findByRole("textbox", { name: "新名称" }) as HTMLInputElement
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]))
    await user.clear(input)
    await user.type(input, "renamed.cbz")
    await user.click(screen.getByRole("button", { name: "重命名", exact: true }))

    await waitFor(() => expect(executeFileOperations).toHaveBeenCalledOnce())
    expect(executeFileOperations).toHaveBeenCalledWith([{
      kind: "rename",
      sourcePath: "D:/library/old.cbz",
      destinationPath: "D:/library/renamed.cbz",
      overwrite: false,
    }], false, expect.any(AbortSignal))
    expect(onRenamed).toHaveBeenCalledWith("D:/library/renamed.cbz")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.rename-conflict] keeps the dialog open and explains an EEXIST result", async () => {
    const executeFileOperations = vi.fn(async () => ({
      ...successfulRename(),
      results: [{
        index: 0,
        operation: { kind: "rename" as const, sourcePath: "D:/library/old.cbz", destinationPath: "D:/library/taken.cbz" },
        status: "failed" as const,
        errorCode: "EEXIST",
        error: "destination exists",
      }],
      succeeded: 0,
      failed: 1,
      undoable: 0,
    }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <FolderRenameDialog
        client={clientWith(executeFileOperations)}
        entry={{ path: "D:/library/old.cbz", name: "old.cbz", kind: "file" }}
        onClose={onClose}
        onRenamed={vi.fn()}
      />,
    )

    const input = await screen.findByRole("textbox", { name: "新名称" })
    await user.clear(input)
    await user.type(input, "taken.cbz")
    await user.click(screen.getByRole("button", { name: "重命名", exact: true }))

    expect((await screen.findByRole("alert")).textContent).toContain("已经存在同名项目")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("[neoview.folder.rename-cancel] aborts an in-flight rename when cancelled", async () => {
    let signal: AbortSignal | undefined
    const executeFileOperations = vi.fn((_operations, _confirmed, operationSignal) => {
      signal = operationSignal
      return new Promise<ReturnType<typeof successfulRename>>(() => undefined)
    })
    const user = userEvent.setup()
    render(
      <FolderRenameDialog
        client={clientWith(executeFileOperations)}
        entry={{ path: "D:/library/old.cbz", name: "old.cbz", kind: "file" }}
        onClose={vi.fn()}
        onRenamed={vi.fn()}
      />,
    )

    const input = await screen.findByRole("textbox", { name: "新名称" })
    await user.clear(input)
    await user.type(input, "renamed.cbz")
    await user.click(screen.getByRole("button", { name: "重命名", exact: true }))
    await waitFor(() => expect(signal).toBeDefined())
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(signal?.aborted).toBe(true)
  })
})

function successfulRename() {
  const operation = { kind: "rename" as const, sourcePath: "D:/library/old.cbz", destinationPath: "D:/library/renamed.cbz" }
  return {
    results: [{ index: 0, operation, status: "succeeded" as const }],
    succeeded: 1,
    failed: 0,
    cancelled: 0,
    undoable: 1,
  }
}

function clientWith(executeFileOperations: NonNullable<ReaderHttpClient["executeFileOperations"]>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(),
    executeFileOperations,
  }
}
