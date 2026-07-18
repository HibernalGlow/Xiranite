import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContextMenuBuilderContext, type ContextMenuAPI } from "@/components/context-menu/context"
import type { ReaderDirectorySelectionOperationSnapshotDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
import FolderSelectionBar from "./FolderSelectionBar"
import { FolderClipboardProvider } from "./FolderClipboard"

afterEach(cleanup)

describe("FolderSelectionBar", () => {
  it("[neoview.folder.delete-batch-ui] confirms, polls and publishes bounded batch progress", async () => {
    const running = operation({ status: "running", processed: 0 })
    const completed = operation({ status: "completed", processed: 100_000, succeeded: 100_000 })
    const startDirectorySelectionOperation = vi.fn(async () => running)
    const directorySelectionOperation = vi.fn(async () => completed)
    const onTrashCompleted = vi.fn(async () => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    const contextMenu: ContextMenuAPI = {
      register: () => () => undefined,
      show: () => undefined,
      confirm: (item) => { void item.onSelect?.() },
    }
    const client = {
      startDirectorySelectionOperation,
      directorySelectionOperation,
      cancelDirectorySelectionOperation: vi.fn(),
    } as unknown as ReaderHttpClient

    render(
      <ContextMenuBuilderContext.Provider value={contextMenu}>
        <FolderSelectionBar
          client={client}
          sessionId="browser-1"
          selection={{ generation: 7, allSelected: true, ranges: [], explicit: [] }}
          selectedCount={100_000}
          total={100_000}
          currentPath="D:/library"
          disabled={false}
          chainSelectMode={false}
          clickBehavior="select"
          onSelectAll={vi.fn()}
          onInvert={vi.fn()}
          onToggleChain={vi.fn()}
          onToggleClickBehavior={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onTrashCompleted={onTrashCompleted}
        />
      </ContextMenuBuilderContext.Provider>,
    )

    fireEvent.click(screen.getByLabelText("将所选项目移到回收站"))
    await waitFor(() => expect(startDirectorySelectionOperation).toHaveBeenCalledWith(
      "browser-1",
      { generation: 7, allSelected: true, ranges: [], explicit: [] },
      "trash",
    ))
    await waitFor(() => expect(directorySelectionOperation).toHaveBeenCalledWith(running.id, expect.any(AbortSignal)))
    await waitFor(() => expect(onTrashCompleted).toHaveBeenCalledWith(completed))
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已将 100000 项移到回收站"))
  })

  it("[neoview.folder.permanent-delete-batch-ui] sends delete without materializing the sparse selection", async () => {
    const running = operation({ kind: "delete", status: "running", processed: 0 })
    const completed = operation({ kind: "delete", status: "completed", processed: 100_000, succeeded: 100_000 })
    const startDirectorySelectionOperation = vi.fn(async () => running)
    const directorySelectionOperation = vi.fn(async () => completed)
    const onDeleteCompleted = vi.fn(async () => undefined)
    const switchToast = { show: vi.fn() }
    const contextMenu: ContextMenuAPI = {
      register: () => () => undefined,
      show: () => undefined,
      confirm: (item) => { void item.onSelect?.() },
    }
    const client = {
      startDirectorySelectionOperation,
      directorySelectionOperation,
      cancelDirectorySelectionOperation: vi.fn(),
    } as unknown as ReaderHttpClient

    render(
      <ContextMenuBuilderContext.Provider value={contextMenu}>
        <FolderSelectionBar
          client={client}
          sessionId="browser-1"
          selection={{ generation: 7, allSelected: true, ranges: [], explicit: [] }}
          selectedCount={100_000}
          total={100_000}
          currentPath="D:/library"
          disabled={false}
          chainSelectMode={false}
          clickBehavior="select"
          switchToast={switchToast as unknown as ReaderSwitchToastPort}
          onSelectAll={vi.fn()}
          onInvert={vi.fn()}
          onToggleChain={vi.fn()}
          onToggleClickBehavior={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onTrashCompleted={vi.fn()}
          onDeleteCompleted={onDeleteCompleted}
        />
      </ContextMenuBuilderContext.Provider>,
    )

    fireEvent.click(screen.getByLabelText("永久删除所选项目"))
    await waitFor(() => expect(startDirectorySelectionOperation).toHaveBeenCalledWith(
      "browser-1",
      { generation: 7, allSelected: true, ranges: [], explicit: [] },
      "delete",
    ))
    await waitFor(() => expect(directorySelectionOperation).toHaveBeenCalledWith(running.id, expect.any(AbortSignal)))
    await waitFor(() => expect(onDeleteCompleted).toHaveBeenCalledWith(completed))
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已永久删除 100000 项"))
    expect(switchToast.show).toHaveBeenCalledWith({ title: "已永久删除 100000 项。" })
  })

  it("[neoview.folder.clipboard-ui] prepares a sparse copy and pastes it without materializing paths", async () => {
    const prepared = { available: true as const, mode: "copy" as const, generation: 7, total: 100_000, createdAt: 1 }
    const running = operation({ id: "copy-1", kind: "copy", destinationPath: "D:/target", total: 100_000 })
    const completed = operation({ ...running, status: "completed", processed: 100_000, succeeded: 100_000 })
    const prepareDirectoryClipboard = vi.fn(async () => prepared)
    const pasteDirectoryClipboard = vi.fn(async () => running)
    const directorySelectionOperation = vi.fn(async () => completed)
    const client = {
      directoryClipboard: vi.fn(async () => ({ available: false as const })),
      prepareDirectoryClipboard,
      pasteDirectoryClipboard,
      directorySelectionOperation,
      cancelDirectorySelectionOperation: vi.fn(),
    } as unknown as ReaderHttpClient

    render(
      <FolderClipboardProvider client={client}>
        <FolderSelectionBar
          client={client}
          sessionId="browser-1"
          selection={{ generation: 7, allSelected: true, ranges: [], explicit: [] }}
          selectedCount={100_000}
          total={100_000}
          currentPath="D:/target"
          disabled={false}
          chainSelectMode={false}
          clickBehavior="select"
          onSelectAll={vi.fn()}
          onInvert={vi.fn()}
          onToggleChain={vi.fn()}
          onToggleClickBehavior={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onTrashCompleted={vi.fn()}
        />
      </FolderClipboardProvider>,
    )

    fireEvent.click(screen.getByLabelText("复制所选项目"))
    await waitFor(() => expect(prepareDirectoryClipboard).toHaveBeenCalledWith(
      "browser-1",
      { generation: 7, allSelected: true, ranges: [], explicit: [] },
      "copy",
    ))
    await waitFor(() => expect((screen.getByLabelText("粘贴到当前目录") as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByLabelText("粘贴到当前目录"))
    await waitFor(() => expect(pasteDirectoryClipboard).toHaveBeenCalledWith("D:/target"))
    await waitFor(() => expect(directorySelectionOperation).toHaveBeenCalledWith("copy-1", expect.any(AbortSignal)))
  })
})

function operation(overrides: Partial<ReaderDirectorySelectionOperationSnapshotDto>): ReaderDirectorySelectionOperationSnapshotDto {
  return {
    id: "operation-1",
    kind: "trash",
    status: "running",
    generation: 7,
    total: 100_000,
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
